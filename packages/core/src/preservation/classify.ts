import type { SkipReason, TransUnitMeta } from '../types.js';

const URL_ONLY =
  /^(https?:\/\/[^\s]+|mailto:[^\s]+|\/[^\s]*|www\.[^\s]+)$/i;
const SHORTCODE_PATTERN = /^\[[\w_-]+(\s[^\]]*)?\]$/;
const SHORTCODE_RESNAMES = new Set(['Shortcode']);
const URL_RESNAMES = new Set([
  'Link URL',
  'URL',
  'URL Vimeo',
  'media_image_title_url',
  'media_video_title_url',
]);

export interface ClassificationResult {
  skipReason: SkipReason;
  warnings: string[];
}

export function isUrlOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return URL_ONLY.test(trimmed);
}

export function isShortcodeOnly(text: string): boolean {
  const trimmed = text.trim();
  return SHORTCODE_PATTERN.test(trimmed) || /^\[[\s\S]+\]$/.test(trimmed);
}

export function isPipeAttribute(text: string): boolean {
  return /^[\w-]+\|.+$/.test(text.trim());
}

export function shouldSkipByResname(resname: string): boolean {
  if (SHORTCODE_RESNAMES.has(resname)) return true;
  if (URL_RESNAMES.has(resname)) return true;
  if (/^media_.*_title_url$/i.test(resname)) return true;
  if (/^Link URL$/i.test(resname)) return true;
  return false;
}

export function classifyTransUnit(source: string, meta: TransUnitMeta): ClassificationResult {
  const warnings: string[] = [];

  if (shouldSkipByResname(meta.resname)) {
    return { skipReason: 'copy_as_is', warnings };
  }

  if (isShortcodeOnly(source)) {
    return { skipReason: 'shortcode', warnings };
  }

  if (isUrlOnly(source)) {
    return { skipReason: 'url_only', warnings };
  }

  if (isPipeAttribute(source)) {
    warnings.push('Pipe-delimited attribute: translate value after | only');
  }

  if (source.includes('<') || source.includes('[')) {
    warnings.push('Contains markup or shortcodes that must be preserved');
  }

  return { skipReason: null, warnings };
}

export function prepareForTranslation(source: string, _meta: TransUnitMeta): string {
  if (isPipeAttribute(source)) {
    const [, ...rest] = source.split('|');
    return rest.join('|');
  }
  return source;
}

export function mergeTranslatedPipeAttribute(
  source: string,
  translatedValue: string
): string {
  if (isPipeAttribute(source)) {
    const [attr] = source.split('|');
    return `${attr}|${translatedValue}`;
  }
  return translatedValue;
}
