export interface UnitSummary {
  id: string;
  resname: string;
  group?: string;
  source: string;
  target: string;
  translatedTarget?: string;
  status: string;
  skipReason?: string | null;
  warnings: string[];
}

export interface FileSummary {
  fileName: string;
  sourceLanguage: string;
  targetLanguage: string;
  referenceUrl?: string;
  postType?: string;
  wordCount?: number;
  unitCount: number;
  units: UnitSummary[];
}

export interface ProjectStats {
  total: number;
  pending: number;
  translated: number;
  skipped: number;
  needsReview: number;
  errors: number;
}

export interface UploadResponse {
  sessionId: string;
  files: FileSummary[];
  stats: ProjectStats;
}

export interface TranslationProgress {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  currentFile?: string;
  lastError?: string;
}

export interface TranslateCompletePayload {
  stats: ProjectStats;
  files: Array<{
    fileName: string;
    units: Array<{
      id: string;
      translatedTarget?: string;
      status: string;
      warnings: string[];
    }>;
  }>;
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:3847' : '';

export async function uploadFiles(files: File[]): Promise<UploadResponse> {
  const form = new FormData();
  for (const file of files) {
    form.append('files', file);
  }
  const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Upload failed');
  }
  return res.json();
}

export async function translateSession(
  sessionId: string,
  options: {
    provider: 'openai' | 'claude';
    apiKey: string;
    model?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    batchSize?: number;
    onProgress?: (progress: TranslationProgress) => void;
  }
): Promise<TranslateCompletePayload> {
  const res = await fetch(`${API_BASE}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      provider: options.provider,
      apiKey: options.apiKey,
      model: options.model,
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      batchSize: options.batchSize,
    }),
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Translation request failed');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete: TranslateCompletePayload | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const lines = part.split('\n');
      let event = 'message';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7);
        if (line.startsWith('data: ')) data = line.slice(6);
      }
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (event === 'progress') options.onProgress?.(parsed);
      if (event === 'complete') complete = parsed as TranslateCompletePayload;
      if (event === 'error') throw new Error(parsed.message);
    }
  }

  if (!complete) {
    throw new Error('Translation finished without a completion payload');
  }
  return complete;
}

export async function updateUnit(
  sessionId: string,
  fileName: string,
  unitId: string,
  target: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/session/${sessionId}/unit`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, unitId, target }),
  });
  if (!res.ok) throw new Error('Failed to update unit');
}

export async function diagnoseProvider(
  provider: 'openai' | 'claude',
  apiKey: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/api/diagnose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKey: apiKey.trim() }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      errText.includes('Cannot GET') || errText.includes('Cannot POST')
        ? 'Server is outdated. Restart with Ctrl+C then npm run dev'
        : `Diagnose request failed (${res.status})${errText ? `: ${errText.slice(0, 120)}` : ''}`
    );
  }
  return res.json();
}

export async function exportSession(sessionId: string): Promise<Array<{ fileName: string; content: string }>> {
  const res = await fetch(`${API_BASE}/api/session/${sessionId}/export`);
  if (!res.ok) throw new Error('Export failed');
  const data = await res.json();
  return data.files;
}
