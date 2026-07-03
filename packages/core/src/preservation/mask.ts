import type { MaskResult, ProtectedContentCheck } from '../types.js';

const TOKEN_PREFIX = '⟦XL';
const TOKEN_SUFFIX = '⟧';

let tokenCounter = 0;

function nextToken(): string {
  tokenCounter += 1;
  return `${TOKEN_PREFIX}${tokenCounter}${TOKEN_SUFFIX}`;
}

function resetCounter(): void {
  tokenCounter = 0;
}

function maskPattern(
  text: string,
  tokens: Map<string, string>,
  pattern: RegExp
): string {
  return text.replace(pattern, (match) => {
    const token = nextToken();
    tokens.set(token, match);
    return token;
  });
}

const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const HTML_ENTITY = /&(?:#\d+|#x[\da-fA-F]+|[a-zA-Z]+);/g;
const SHORTCODE = /\[[^\]]+\]/g;
const URL = /https?:\/\/[^\s<>"']+/g;
const WHATSAPP = /https:\/\/wa\.me\/\d+/g;

export function maskProtectedContent(text: string): MaskResult {
  resetCounter();
  const tokens = new Map<string, string>();
  let masked = text;

  masked = maskPattern(masked, tokens, WHATSAPP);
  masked = maskPattern(masked, tokens, URL);
  masked = maskPattern(masked, tokens, SHORTCODE);
  masked = maskPattern(masked, tokens, HTML_TAG);
  masked = maskPattern(masked, tokens, HTML_ENTITY);

  return { masked, tokens };
}

export function unmaskProtectedContent(
  text: string,
  tokens: Map<string, string>
): string {
  let result = text;
  for (const [token, original] of tokens) {
    result = result.split(token).join(original);
  }
  return result;
}

export function verifyProtectedContent(
  original: string,
  translated: string
): ProtectedContentCheck {
  const originalMask = maskProtectedContent(original);
  const missing: string[] = [];

  for (const value of originalMask.tokens.values()) {
    if (!translated.includes(value)) {
      missing.push(value);
    }
  }

  return { valid: missing.length === 0, missing };
}

export function extractTranslatableSegments(text: string): string[] {
  const { masked } = maskProtectedContent(text);
  if (!masked.trim()) return [];
  return [masked];
}
