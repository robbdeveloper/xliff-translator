import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { TransUnit, TransUnitMeta } from '../types.js';
import { classifyTransUnit } from '../preservation/classify.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: false,
  preserveOrder: true,
  commentPropName: '#comment',
  cdataPropName: '#cdata',
  processEntities: false,
  htmlEntities: false,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: false,
  preserveOrder: true,
  commentPropName: '#comment',
  cdataPropName: '#cdata',
  suppressEmptyNode: false,
});

function extractTextValue(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    return node.map(extractTextValue).join('');
  }
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if ('#text' in record) return extractTextValue(record['#text']);
    if ('#cdata' in record) return extractTextValue(record['#cdata']);
  }
  return '';
}

function getCdataContent(node: unknown): string {
  if (!node) return '';
  if (Array.isArray(node)) {
    const fromChildren = node
      .map((child) => getCdataContent(child))
      .join('');
    return fromChildren || extractTextValue(node);
  }
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if ('#cdata' in record) return extractTextValue(record['#cdata']);
    if ('#text' in record) return extractTextValue(record['#text']);
  }
  return extractTextValue(node);
}

function setCdataContent(node: unknown, value: string): void {
  if (!node) return;

  if (Array.isArray(node)) {
    if (node.length === 0) {
      node.push({ '#cdata': [{ '#text': value }] });
      return;
    }
    const first = node[0];
    if (first && typeof first === 'object') {
      (first as Record<string, unknown>)['#cdata'] = [{ '#text': value }];
      return;
    }
    node[0] = { '#cdata': [{ '#text': value }] };
    return;
  }

  if (typeof node === 'object') {
    (node as Record<string, unknown>)['#cdata'] = [{ '#text': value }];
  }
}

function findChild(node: unknown[], tagName: string): unknown[] | undefined {
  for (const item of node) {
    if (item && typeof item === 'object') {
      const key = Object.keys(item as object).find((k) => k !== ':@');
      if (key === tagName) {
        return (item as Record<string, unknown[]>)[tagName] as unknown[];
      }
    }
  }
  return undefined;
}

function extractMeta(transUnitNode: unknown[], attrs: Record<string, string>): TransUnitMeta {
  let group: string | undefined;
  let groupId: string | undefined;
  let unit: string | undefined;
  let type: string | undefined;
  let note: string | undefined;

  for (const item of transUnitNode) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === ':@') continue;
      if (key === 'note' && Array.isArray(record[key])) {
        note = getCdataContent(record[key]) || String((record[key] as unknown[])[0] ?? '');
      }
      if (key.includes('extradata') && Array.isArray(record[key])) {
        const extraAttrs = (record[':@'] ?? {}) as Record<string, string>;
        group = extraAttrs['@_group'];
        groupId = extraAttrs['@_group_id'];
        unit = extraAttrs['@_unit'];
        type = extraAttrs['@_type'];
      }
    }
  }

  return {
    id: attrs['@_id'] ?? '',
    resname: attrs['@_resname'] ?? '',
    group,
    groupId,
    unit,
    type,
    note,
  };
}

function extractReferenceUrl(headerNode: unknown[]): string | undefined {
  const reference = findChild(headerNode, 'reference');
  if (!reference) return undefined;

  for (const item of reference) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const attrs = (record[':@'] ?? {}) as Record<string, string>;
    if (attrs['@_href']) return attrs['@_href'];

    const external = findChild([item], 'external-file');
    if (external) {
      const externalAttrs = (external.find(
        (n) => n && typeof n === 'object' && ':@' in (n as object)
      ) as Record<string, unknown> | undefined)?.[':@'] as Record<string, string> | undefined;
      if (externalAttrs?.['@_href']) return externalAttrs['@_href'];
    }
  }

  return undefined;
}

function extractPostType(headerNode: unknown[]): string | undefined {
  const phaseGroup = findChild(headerNode, 'phase-group');
  if (!phaseGroup) return undefined;
  for (const phase of phaseGroup) {
    if (!phase || typeof phase !== 'object') continue;
    const record = phase as Record<string, unknown>;
    if ('phase' in record && Array.isArray(record.phase)) {
      const attrs = (record[':@'] ?? {}) as Record<string, string>;
      if (attrs['@_phase-name'] === 'post_type') {
        const note = findChild(record.phase as unknown[], 'note');
        if (note?.[0] && typeof note[0] === 'object') {
          const noteRecord = note[0] as Record<string, unknown>;
          if (Array.isArray(noteRecord['#text'])) {
            return String(noteRecord['#text'][0] ?? '');
          }
        }
      }
    }
  }
  return undefined;
}

export interface ParsedXliffDocument {
  fileName: string;
  info: Omit<import('../types.js').XliffFileInfo, 'rawContent' | 'transUnits'>;
  transUnits: TransUnit[];
  tree: unknown[];
  transUnitRefs: Array<{ fileIndex: number; unitIndex: number; node: unknown[] }>;
}

export function parseXliff(fileName: string, content: string): ParsedXliffDocument {
  const tree = parser.parse(content) as unknown[];
  const xliffNode = tree.find((n) => n && typeof n === 'object' && 'xliff' in (n as object)) as Record<string, unknown[]> | undefined;
  if (!xliffNode?.xliff) {
    throw new Error(`Invalid XLIFF file: ${fileName}`);
  }

  const fileNodes = xliffNode.xliff.filter((n) => n && typeof n === 'object' && 'file' in (n as object));
  const transUnits: TransUnit[] = [];
  const transUnitRefs: ParsedXliffDocument['transUnitRefs'] = [];

  let fileIndex = 0;
  for (const fileWrapper of fileNodes) {
    const fileRecord = fileWrapper as Record<string, unknown>;
    const fileContent = fileRecord.file as unknown[];
    const body = findChild(fileContent, 'body');
    if (!body) {
      fileIndex++;
      continue;
    }

    let unitIndex = 0;
    for (const bodyItem of body) {
      if (!bodyItem || typeof bodyItem !== 'object') continue;
      const record = bodyItem as Record<string, unknown>;
      if (!('trans-unit' in record)) continue;

      const transUnitNode = record['trans-unit'] as unknown[];
      const attrs = (record[':@'] ?? {}) as Record<string, string>;
      const sourceNode = findChild(transUnitNode, 'source');
      const targetNode = findChild(transUnitNode, 'target');
      const source = sourceNode ? getCdataContent(sourceNode) : '';
      const target = targetNode ? getCdataContent(targetNode) : '';
      const meta = extractMeta(transUnitNode, attrs);
      const classification = classifyTransUnit(source, meta);

      transUnits.push({
        fileIndex,
        unitIndex,
        meta,
        source,
        target,
        translatedTarget: target,
        status: classification.skipReason ? 'skipped' : 'pending',
        skipReason: classification.skipReason,
        warnings: classification.warnings,
      });

      transUnitRefs.push({ fileIndex, unitIndex, node: transUnitNode });
      unitIndex++;
    }

    fileIndex++;
  }

  const firstFile = fileNodes[0] as Record<string, unknown>;
  const firstAttrs = (firstFile[':@'] ?? {}) as Record<string, string>;
  const firstHeader = findChild((firstFile.file as unknown[]), 'header') ?? [];

  return {
    fileName,
    info: {
      fileName,
      original: firstAttrs['@_original'],
      sourceLanguage: firstAttrs['@_source-language'] ?? 'it',
      targetLanguage: firstAttrs['@_target-language'] ?? 'en',
      referenceUrl: extractReferenceUrl(firstHeader),
      postType: extractPostType(firstHeader),
      wordCount: firstAttrs['@_tool:wpml-words-to-translate-count']
        ? Number(firstAttrs['@_tool:wpml-words-to-translate-count'])
        : undefined,
    },
    transUnits,
    tree,
    transUnitRefs,
  };
}

export function applyTranslations(
  parsed: ParsedXliffDocument,
  updates: Map<string, string>
): string {
  for (const ref of parsed.transUnitRefs) {
    const unit = parsed.transUnits.find(
      (u) => u.fileIndex === ref.fileIndex && u.unitIndex === ref.unitIndex
    );
    if (!unit) continue;

    const newTarget = updates.get(unit.meta.id) ?? unit.translatedTarget ?? unit.target;
    const targetNode = findChild(ref.node, 'target');
    if (targetNode) {
      setCdataContent(targetNode, newTarget);
    }
  }

  return builder.build(parsed.tree);
}

export function serializeXliff(parsed: ParsedXliffDocument): string {
  for (const ref of parsed.transUnitRefs) {
    const unit = parsed.transUnits.find(
      (u) => u.fileIndex === ref.fileIndex && u.unitIndex === ref.unitIndex
    );
    if (!unit) continue;
    const targetNode = findChild(ref.node, 'target');
    if (targetNode) {
      setCdataContent(targetNode, unit.translatedTarget ?? unit.target);
    }
  }
  return builder.build(parsed.tree);
}

export function buildXliffFileInfo(parsed: ParsedXliffDocument, rawContent: string): import('../types.js').XliffFileInfo {
  return {
    ...parsed.info,
    transUnits: parsed.transUnits,
    rawContent,
  };
}
