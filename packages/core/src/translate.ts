import type {
  TranslateOptions,
  TranslationProgress,
  TransUnit,
  XliffFileInfo,
} from './types.js';
import {
  mergeTranslatedPipeAttribute,
  prepareForTranslation,
} from './preservation/classify.js';
import {
  maskProtectedContent,
  unmaskProtectedContent,
  verifyProtectedContent,
} from './preservation/mask.js';
import { createClaudeProvider } from './providers/claude.js';
import { createOpenAIProvider } from './providers/openai.js';
import { chunkArray, formatFetchError, ProviderError } from './providers/base.js';
import {
  buildXliffFileInfo,
  parseXliff,
  serializeXliff,
  type ParsedXliffDocument,
} from './xliff/parser.js';

export interface LoadedProject {
  files: Array<{
    parsed: ParsedXliffDocument;
    info: XliffFileInfo;
  }>;
}

export function loadXliffFiles(
  files: Array<{ fileName: string; content: string }>
): LoadedProject {
  return {
    files: files.map(({ fileName, content }) => {
      const parsed = parseXliff(fileName, content);
      return {
        parsed,
        info: buildXliffFileInfo(parsed, content),
      };
    }),
  };
}

export function createProvider(
  providerName: 'openai' | 'claude',
  apiKey: string,
  model?: string
) {
  if (providerName === 'claude') {
    return createClaudeProvider({ apiKey, model });
  }
  return createOpenAIProvider({ apiKey, model });
}

function buildContext(unit: TransUnit): string {
  const parts = [
    unit.meta.resname && `Field: ${unit.meta.resname}`,
    unit.meta.group && `Group: ${unit.meta.group}`,
    unit.meta.note && `Note: ${unit.meta.note}`,
  ].filter(Boolean);
  return parts.join(' | ');
}

export async function translateProject(
  project: LoadedProject,
  options: TranslateOptions
): Promise<LoadedProject> {
  const batchSize = Math.max(1, options.batchSize ?? 1);
  const allUnits: Array<{ fileIndex: number; unit: TransUnit }> = [];

  project.files.forEach((file, fileIndex) => {
    for (const unit of file.parsed.transUnits) {
      if (unit.skipReason) {
        unit.translatedTarget = unit.source;
        unit.status = 'skipped';
      } else {
        allUnits.push({ fileIndex, unit });
      }
    }
  });

  const progress: TranslationProgress = {
    total: allUnits.length,
    completed: 0,
    skipped: project.files.reduce(
      (acc, f) => acc + f.parsed.transUnits.filter((u) => u.skipReason).length,
      0
    ),
    failed: 0,
  };

  options.onProgress?.({ ...progress });

  const chunks = chunkArray(allUnits, batchSize);

  for (const chunk of chunks) {
    const batchItems = chunk.map(({ fileIndex, unit }) => {
      const sourceText = prepareForTranslation(unit.source, unit.meta);
      const masked = maskProtectedContent(sourceText);
      return {
        id: `${fileIndex}:${unit.meta.id}`,
        text: masked.masked,
        context: buildContext(unit),
        unit,
        fileIndex,
        tokens: masked.tokens,
        originalSource: unit.source,
      };
    });

    progress.currentFile = project.files[batchItems[0]?.fileIndex ?? 0]?.info.fileName;
    options.onProgress?.({ ...progress });

    let results;
    try {
      results = await options.provider.translateBatch(
        batchItems.map((b) => ({
          id: b.id,
          text: b.text,
          context: b.context,
        })),
        options.sourceLanguage,
        options.targetLanguage,
        (done, total) => {
          progress.lastError = undefined;
          options.onProgress?.({
            ...progress,
            lastError: `Translating batch (${done}/${total})…`,
          });
        },
        options.instructions
      );
    } catch (error) {
      const message =
        error instanceof ProviderError || error instanceof Error
          ? error.message
          : formatFetchError(error);
      if (error instanceof ProviderError && error.fatal) {
        progress.lastError = message;
        options.onProgress?.({ ...progress });
        throw error;
      }
      results = batchItems.map((batchItem) => ({
        id: batchItem.id,
        text: batchItem.text,
        error: message,
      }));
    }

    for (const batchItem of batchItems) {
      const result = results.find((r) => r.id === batchItem.id);
      const unit = batchItem.unit;

      if (!result || result.error) {
        unit.status = 'error';
        unit.translatedTarget = unit.source;
        progress.failed += 1;
        progress.lastError = result?.error ?? 'Translation failed';
        unit.warnings.push(progress.lastError);
      } else {
        let translated = unmaskProtectedContent(result.text, batchItem.tokens);
        translated = mergeTranslatedPipeAttribute(batchItem.originalSource, translated);

        const check = verifyProtectedContent(batchItem.originalSource, translated);
        unit.translatedTarget = translated;
        unit.status = check.valid ? 'translated' : 'needs_review';
        if (!check.valid) {
          unit.warnings.push(
            `Protected content may be missing: ${check.missing.slice(0, 2).join(', ')}`
          );
        }
        progress.completed += 1;
        progress.lastError = undefined;
      }

      options.onProgress?.({ ...progress });
    }
  }

  return project;
}

export function exportTranslatedFiles(project: LoadedProject): Array<{
  fileName: string;
  content: string;
}> {
  return project.files.map((file) => ({
    fileName: file.info.fileName,
    content: serializeXliff(file.parsed),
  }));
}

export function updateUnitTarget(
  project: LoadedProject,
  fileName: string,
  unitId: string,
  newTarget: string
): void {
  const file = project.files.find((f) => f.info.fileName === fileName);
  if (!file) return;
  const unit = file.parsed.transUnits.find((u) => u.meta.id === unitId);
  if (!unit) return;
  unit.translatedTarget = newTarget;
  unit.status = 'translated';
}

export function getProjectStats(project: LoadedProject) {
  let total = 0;
  let pending = 0;
  let translated = 0;
  let skipped = 0;
  let needsReview = 0;
  let errors = 0;

  for (const file of project.files) {
    for (const unit of file.parsed.transUnits) {
      total++;
      switch (unit.status) {
        case 'pending':
          pending++;
          break;
        case 'translated':
          translated++;
          break;
        case 'skipped':
          skipped++;
          break;
        case 'needs_review':
          needsReview++;
          break;
        case 'error':
          errors++;
          break;
      }
    }
  }

  return { total, pending, translated, skipped, needsReview, errors };
}

export { parseXliff, serializeXliff };
