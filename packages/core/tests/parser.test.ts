import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  classifyTransUnit,
  isShortcodeOnly,
  isUrlOnly,
  maskProtectedContent,
  parseTranslationResponse,
  parseXliff,
  serializeXliff,
  unmaskProtectedContent,
  validateXliffRoundTrip,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePath = join(__dirname, '../../../examples/sample-job-1.xliff');
const sampleContent = readFileSync(samplePath, 'utf-8');

describe('parseXliff', () => {
  it('parses WPML XLIFF sample with trans-units', () => {
    const parsed = parseXliff('sample-job-1.xliff', sampleContent);
    expect(parsed.info.sourceLanguage).toBe('it');
    expect(parsed.info.targetLanguage).toBe('en');
    expect(parsed.transUnits.length).toBeGreaterThan(0);
    expect(parsed.info.referenceUrl).toContain('florence2book.com');
  });

  it('round-trips XML without losing trans-units', () => {
    const parsed = parseXliff('sample-job-1.xliff', sampleContent);
    const serialized = serializeXliff(parsed);
    const issues = validateXliffRoundTrip(sampleContent, serialized, 'sample-job-1.xliff');
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('updates target values on serialize', () => {
    const parsed = parseXliff('sample-job-1.xliff', sampleContent);
    const unit = parsed.transUnits.find((u) => u.meta.id === 'title');
    expect(unit).toBeDefined();
    unit!.translatedTarget = 'Location';
    const serialized = serializeXliff(parsed);
    expect(serialized).toContain('Location');
  });
});

describe('classifyTransUnit', () => {
  it('skips shortcode-only units', () => {
    const source = '[multiple_pins_map post_type="strutture"]';
    expect(isShortcodeOnly(source)).toBe(true);
    const result = classifyTransUnit(source, { id: 'x', resname: 'Testo' });
    expect(result.skipReason).toBe('shortcode');
  });

  it('skips url-only units', () => {
    expect(isUrlOnly('https://florence2book.com/faq/')).toBe(true);
  });

  it('skips by resname Shortcode', () => {
    const result = classifyTransUnit('[foo]', { id: 'x', resname: 'Shortcode' });
    expect(result.skipReason).toBe('copy_as_is');
  });
});

describe('maskProtectedContent', () => {
  it('masks and restores HTML and shortcodes', () => {
    const input = '<p class="p1">Ciao</p> [shortcode attr="x"] https://example.com';
    const masked = maskProtectedContent(input);
    expect(masked.masked).not.toContain('<p');
    expect(masked.masked).not.toContain('[shortcode');
    expect(masked.masked).not.toContain('https://');
    const restored = unmaskProtectedContent(`${masked.masked} mondo`, masked.tokens);
    expect(restored).toContain('<p class="p1">');
    expect(restored).toContain('[shortcode attr="x"]');
    expect(restored).toContain('https://example.com');
  });
});

describe('parseTranslationResponse', () => {
  it('parses JSON translation payload', () => {
    const items = [{ id: '0:title', text: 'Ciao' }];
    const response = JSON.stringify({
      translations: [{ id: '0:title', text: 'Hello' }],
    });
    const results = parseTranslationResponse(response, items);
    expect(results[0]?.text).toBe('Hello');
  });

  it('parses alternate items array payloads', () => {
    const items = [
      { id: 'u1', text: 'Ciao' },
      { id: 'u2', text: 'Mondo' },
    ];
    const response = JSON.stringify({
      items: [
        { id: 'u1', translation: 'Hello' },
        { id: 'u2', translation: 'World' },
      ],
    });
    const results = parseTranslationResponse(response, items);
    expect(results[0]?.text).toBe('Hello');
    expect(results[1]?.text).toBe('World');
  });

  it('falls back to index order when ids are missing', () => {
    const items = [
      { id: 'u1', text: 'Ciao' },
      { id: 'u2', text: 'Mondo' },
    ];
    const response = JSON.stringify({
      translations: [{ id: 'wrong', text: 'Hello' }, { id: 'wrong2', text: 'World' }],
    });
    const results = parseTranslationResponse(response, items);
    expect(results[0]?.text).toBe('Hello');
    expect(results[1]?.text).toBe('World');
  });
});
