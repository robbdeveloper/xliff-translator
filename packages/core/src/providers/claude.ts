import type {
  TranslateBatchItem,
  TranslateBatchResult,
  TranslationProvider,
} from '../types.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
  fetchWithTimeout,
  parseApiHttpError,
  parseTranslationResponse,
  ProviderError,
  translateWithBatchFallback,
  withRetry,
} from './base.js';

export interface ClaudeProviderOptions {
  apiKey: string;
  model?: string;
}

async function callClaude(
  options: ClaudeProviderOptions,
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string,
  instructions?: string
): Promise<TranslateBatchResult[]> {
  const model = options.model ?? 'claude-sonnet-4-20250514';
  const systemPrompt = buildSystemPrompt(sourceLang, targetLang, instructions);

  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': options.apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      temperature: 0.2,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `${buildUserPrompt(items)}\n\nRespond with JSON only.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw parseApiHttpError(response.status, errText, 'Claude');
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const content = data.content?.find((entry) => entry.type === 'text')?.text ?? '';
  if (!content.trim()) {
    throw new ProviderError('Claude returned an empty response');
  }

  return parseTranslationResponse(content, items);
}

export function createClaudeProvider(options: ClaudeProviderOptions): TranslationProvider {
  return {
    name: 'claude',
    async translateBatch(items, sourceLang, targetLang, onProgress, instructions) {
      return translateWithBatchFallback(
        items,
        (chunk) =>
          withRetry(() => callClaude(options, chunk, sourceLang, targetLang, instructions)),
        onProgress
      );
    },
  };
}

export async function translateBatchClaude(
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string,
  apiKey: string,
  model?: string,
  onProgress?: (done: number, total: number) => void
): Promise<TranslateBatchResult[]> {
  const provider = createClaudeProvider({ apiKey, model });
  return provider.translateBatch(items, sourceLang, targetLang, onProgress);
}
