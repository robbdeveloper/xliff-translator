export type TransUnitStatus =
  | 'pending'
  | 'translated'
  | 'skipped'
  | 'error'
  | 'needs_review';

export type SkipReason =
  | 'shortcode'
  | 'url_only'
  | 'copy_as_is'
  | 'already_translated'
  | null;

export interface TransUnitMeta {
  id: string;
  resname: string;
  group?: string;
  groupId?: string;
  unit?: string;
  type?: string;
  note?: string;
}

export interface TransUnit {
  fileIndex: number;
  unitIndex: number;
  meta: TransUnitMeta;
  source: string;
  target: string;
  translatedTarget?: string;
  status: TransUnitStatus;
  skipReason: SkipReason;
  warnings: string[];
}

export interface XliffFileInfo {
  fileName: string;
  original?: string;
  sourceLanguage: string;
  targetLanguage: string;
  referenceUrl?: string;
  postType?: string;
  wordCount?: number;
  transUnits: TransUnit[];
  rawContent: string;
}

export interface TranslationProgress {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  currentFile?: string;
  lastError?: string;
}

export interface TranslationProviderConfig {
  provider: 'openai' | 'claude';
  apiKey: string;
  model?: string;
}

export interface TranslateBatchItem {
  id: string;
  text: string;
  context?: string;
}

export interface TranslateBatchResult {
  id: string;
  text: string;
  error?: string;
}

export interface TranslationProvider {
  name: string;
  translateBatch(
    items: TranslateBatchItem[],
    sourceLang: string,
    targetLang: string,
    onProgress?: (done: number, total: number) => void,
    instructions?: string
  ): Promise<TranslateBatchResult[]>;
}

export interface TranslateOptions {
  provider: TranslationProvider;
  sourceLanguage: string;
  targetLanguage: string;
  batchSize?: number;
  instructions?: string;
  onProgress?: (progress: TranslationProgress) => void;
}

export interface ValidationIssue {
  unitId: string;
  fileName: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface MaskResult {
  masked: string;
  tokens: Map<string, string>;
}

export interface ProtectedContentCheck {
  valid: boolean;
  missing: string[];
}
