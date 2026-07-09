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

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
}

async function callOpenAI(
  options: OpenAIProviderOptions,
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string,
  instructions?: string
): Promise<TranslateBatchResult[]> {
  const model = options.model ?? 'gpt-4o-mini';
  const systemPrompt = buildSystemPrompt(sourceLang, targetLang, instructions);

  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildUserPrompt(items) },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw parseApiHttpError(response.status, errText, 'OpenAI');
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) {
    throw new ProviderError('OpenAI returned an empty response');
  }

  return parseTranslationResponse(content, items);
}

export function createOpenAIProvider(options: OpenAIProviderOptions): TranslationProvider {
  return {
    name: 'openai',
    async translateBatch(items, sourceLang, targetLang, onProgress, instructions) {
      return translateWithBatchFallback(
        items,
        (chunk) =>
          withRetry(() => callOpenAI(options, chunk, sourceLang, targetLang, instructions)),
        onProgress
      );
    },
  };
}

export async function translateBatchOpenAI(
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string,
  apiKey: string,
  model?: string,
  onProgress?: (done: number, total: number) => void
): Promise<TranslateBatchResult[]> {
  const provider = createOpenAIProvider({ apiKey, model });
  return provider.translateBatch(items, sourceLang, targetLang, onProgress);
}
