import type {
  TranslateBatchItem,
  TranslateBatchResult,
  TranslationProvider,
} from '../types.js';

const LANGUAGE_NAMES: Record<string, string> = {
  it: 'Italian',
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  ro: 'Romanian',
};

export class ProviderError extends Error {
  fatal: boolean;

  constructor(message: string, fatal = false) {
    super(message);
    this.name = 'ProviderError';
    this.fatal = fatal;
  }
}

export function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code;
}

export function formatFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    return `${error.message}: ${cause.message}`;
  }
  return error.message;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 120_000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError(`Request timed out after ${timeoutMs / 1000}s`, false);
    }
    throw new ProviderError(formatFetchError(error), false);
  } finally {
    clearTimeout(timeout);
  }
}

export function parseApiHttpError(status: number, body: string, provider: string): ProviderError {
  const fatal = status === 401 || status === 403 || status === 404;
  let message = `${provider} API error ${status}`;

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string };
    };
    if (parsed.error?.message) {
      message = `${provider} API error: ${parsed.error.message}`;
    }
  } catch {
    if (body.trim()) message = `${provider} API error ${status}: ${body.slice(0, 300)}`;
  }

  return new ProviderError(message, fatal);
}

export function buildSystemPrompt(
  sourceLang: string,
  targetLang: string,
  instructions?: string
): string {
  const source = getLanguageName(sourceLang);
  const target = getLanguageName(targetLang);

  const base = `You are a professional translator for WordPress/WPML XLIFF content exported from websites using Elementor, ACF, and custom post types.

Translate from ${source} to ${target}.

Rules:
1. Preserve ALL placeholder tokens exactly as written. Placeholders look like ⟦XL1⟧, ⟦XL2⟧, etc. Do not translate, remove, or modify them.
2. Preserve HTML tags, attributes, classes, and structure exactly.
3. Preserve WordPress shortcodes exactly (content inside [brackets]).
4. Preserve URLs, email addresses, phone numbers, and domain names exactly.
5. Preserve HTML entities (&amp;, &#039;, etc.) in the same encoding style when possible.
6. Preserve trailing/leading whitespace and newlines exactly.
7. Translate only human-readable text. Do not translate slug names, field names, CSS classes, or technical identifiers.
8. Keep brand names like "Florence2Book" unless a natural localized form is standard.
9. For tourism/hospitality content, use natural, professional ${target}.
10. Return ONLY valid JSON. Include one entry per input item, using the exact same id values.

Output format:
{"translations":[{"id":"u1","text":"translated text"},{"id":"u2","text":"..."}]}`;

  const trimmed = instructions?.trim();
  if (!trimmed) return base;

  return `${base}

Additional user translation instructions:
${trimmed}

Important: Follow these user instructions when compatible with the rules above. If a user instruction conflicts with placeholder, HTML, shortcode, or URL preservation rules, the preservation rules take priority.`;
}

export function buildUserPrompt(items: TranslateBatchItem[]): string {
  const payload = items.map((item) => ({
    id: item.id,
    text: item.text,
    context: item.context ?? '',
  }));
  return JSON.stringify({ items: payload });
}

function extractTranslationEntries(
  parsed: unknown
): Array<{ id: string; text: string }> {
  if (!parsed || typeof parsed !== 'object') return [];

  const record = parsed as Record<string, unknown>;
  const candidates = [record.translations, record.items, record.results];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const entries = candidate
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const id = item.id ?? item.key;
        const text = item.text ?? item.translation ?? item.target ?? item.value;
        if (typeof id !== 'string' || typeof text !== 'string') return null;
        return { id, text };
      })
      .filter((entry): entry is { id: string; text: string } => entry !== null);
    if (entries.length > 0) return entries;
  }

  return [];
}

export function assignSimpleIds(items: TranslateBatchItem[]): {
  apiItems: TranslateBatchItem[];
  idMap: Map<string, string>;
} {
  const idMap = new Map<string, string>();
  const apiItems = items.map((item, index) => {
    const simpleId = `u${index + 1}`;
    idMap.set(simpleId, item.id);
    return { ...item, id: simpleId };
  });
  return { apiItems, idMap };
}

export function remapResults(
  results: TranslateBatchResult[],
  idMap: Map<string, string>
): TranslateBatchResult[] {
  return results.map((result) => ({
    ...result,
    id: idMap.get(result.id) ?? result.id,
  }));
}

export function parseTranslationResponse(
  content: string,
  items: TranslateBatchItem[]
): TranslateBatchResult[] {
  const cleaned = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return items.map((item) => ({
      id: item.id,
      text: item.text,
      error: 'Failed to parse AI response as JSON',
    }));
  }

  const entries = extractTranslationEntries(parsed);
  const map = new Map(entries.map((entry) => [entry.id, entry.text] as const));

  return items.map((item, index) => {
    let translated = map.get(item.id);
    if (translated === undefined) {
      translated = entries[index]?.text;
    }
    if (translated === undefined) {
      return {
        id: item.id,
        text: item.text,
        error: 'Missing translation in response',
      };
    }
    return { id: item.id, text: translated };
  });
}

export function hasTranslationErrors(results: TranslateBatchResult[]): boolean {
  return results.some((result) => Boolean(result.error));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderError && error.fatal) {
        throw error;
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
      }
    }
  }
  throw lastError;
}

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export async function translateWithBatchFallback(
  items: TranslateBatchItem[],
  translateChunk: (chunk: TranslateBatchItem[]) => Promise<TranslateBatchResult[]>,
  onProgress?: (done: number, total: number) => void
): Promise<TranslateBatchResult[]> {
  if (items.length === 0) return [];

  if (items.length === 1) {
    const results = await translateChunk(items);
    onProgress?.(1, 1);
    return results;
  }

  const { apiItems, idMap } = assignSimpleIds(items);

  try {
    const batchResults = remapResults(await translateChunk(apiItems), idMap);
    if (!hasTranslationErrors(batchResults)) {
      onProgress?.(items.length, items.length);
      return batchResults;
    }
  } catch (error) {
    if (error instanceof ProviderError && error.fatal) {
      throw error;
    }
  }

  const results: TranslateBatchResult[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    try {
      const single = await translateChunk([item]);
      results.push(
        single[0] ?? {
          id: item.id,
          text: item.text,
          error: 'Missing translation in response',
        }
      );
    } catch (error) {
      if (error instanceof ProviderError && error.fatal) {
        throw error;
      }
      results.push({
        id: item.id,
        text: item.text,
        error: formatFetchError(error),
      });
    }
    onProgress?.(i + 1, items.length);
  }

  return results;
}

export interface ProviderFactoryOptions {
  apiKey: string;
  model?: string;
}

export type ProviderFactory = (options: ProviderFactoryOptions) => TranslationProvider;
