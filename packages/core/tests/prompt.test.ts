import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/providers/base.js';

describe('buildSystemPrompt', () => {
  it('returns the base prompt without user instructions', () => {
    const prompt = buildSystemPrompt('it', 'en');
    expect(prompt).toContain('Translate from Italian to English');
    expect(prompt).toContain('Preserve ALL placeholder tokens');
    expect(prompt).not.toContain('Additional user translation instructions');
  });

  it('appends user instructions when provided', () => {
    const prompt = buildSystemPrompt('it', 'en', 'Keep Florence2Book untranslated.');
    expect(prompt).toContain('Additional user translation instructions:');
    expect(prompt).toContain('Keep Florence2Book untranslated.');
    expect(prompt).toContain('preservation rules take priority');
  });

  it('ignores blank instructions', () => {
    const prompt = buildSystemPrompt('it', 'en', '   ');
    expect(prompt).not.toContain('Additional user translation instructions');
  });
});
