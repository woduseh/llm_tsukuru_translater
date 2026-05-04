import { describe, expect, it } from 'vitest';
import type { AppSettings } from '../../src/types/settings';
import {
  buildBoundedGuidelineProfile,
  buildGuidelineGenerationPrompts,
  generateGuidelineDraft,
  GUIDELINE_FIXED_FORMAT_RULES,
  type GuidelineProviderClient,
} from '../../src/ts/libs/guidelineGenerator';
import type { ProjectTranslationProfile } from '../../src/ts/libs/projectProfile';

function createProfile(): ProjectTranslationProfile {
  return {
    schemaVersion: 1,
    scanner: 'projectProfile',
    rootName: 'SampleGame',
    limits: {
      maxFiles: 300,
      maxDirectoryEntries: 5000,
      maxFileBytes: 2 * 1024 * 1024,
      maxJsonBytes: 1024 * 1024,
      maxTextBytes: 256 * 1024,
      maxSamplesPerBucket: 40,
      maxSampleLength: 80,
      maxRepeatedPhrases: 40,
      maxTerms: 80,
      maxCandidates: 60,
      minRepeatedPhraseCount: 2,
    },
    fileStats: {
      totalFiles: 20,
      scannedFiles: 8,
      skippedFiles: 12,
      totalBytes: 12345,
      byExtension: { '.json': 5, '.txt': 3 },
      byKind: {
        'rpg-maker-json': 5,
        'wolf-data': 0,
        'extracted-text': 3,
        csv: 0,
        other: 0,
      },
      largestFiles: [{ path: 'data\\Map001.json', bytes: 5000, kind: 'rpg-maker-json' }],
    },
    languageHints: { hangul: 0, hiragana: 5, katakana: 4, kanji: 12, latin: 20 },
    terms: [
      { text: 'Magic Crystal', count: 5, files: ['data\\Items.json'] },
      { text: 'very-long-term '.repeat(20), count: 3, files: ['Extract\\Map001.txt'] },
    ],
    names: [{ text: 'Harold', count: 7, files: ['data\\Actors.json'] }],
    repeatedPhrases: [{ text: 'Welcome to town!', count: 3, files: ['Extract\\Map001.txt'] }],
    characterCandidates: [{ text: 'Village Elder', count: 2, files: ['data\\Map001.json'] }],
    controlCodePatterns: [{ pattern: '\\N[]', count: 4, files: ['Extract\\Map001.txt'], examples: ['Hello \\N[1]'] }],
    separatorPatterns: [{ pattern: '--- <label> ---', count: 8, files: ['Extract\\Map001.txt'], examples: ['--- 101 ---'] }],
    warnings: ['Skipped huge file because maxFileBytes was exceeded.'],
  };
}

function createSettings(): Partial<AppSettings> {
  return {
    llmProvider: 'gemini',
    llmApiKey: 'test-key',
    llmModel: 'gemini-test',
    llmCustomPrompt: 'Existing prompt',
    llmTimeout: 1,
  };
}

describe('guidelineGenerator', () => {
  it('builds a bounded profile and omits large/raw-only fields from provider prompts', () => {
    const profile = createProfile();
    const bounded = buildBoundedGuidelineProfile(profile, { maxItemsPerBucket: 1, maxTextLength: 24 });
    const prompts = buildGuidelineGenerationPrompts(profile, {
      sourceLang: 'ja',
      targetLang: 'ko',
      maxItemsPerBucket: 1,
      maxTextLength: 24,
    });

    expect(bounded.terms).toHaveLength(1);
    expect(JSON.stringify(bounded)).not.toContain('very-long-term very-long-term very-long-term');
    expect(prompts.userPrompt).toContain('Bounded project translation profile JSON');
    expect(prompts.userPrompt).toContain('Magic Crystal');
    expect(prompts.userPrompt).not.toContain('largestFiles');
    expect(prompts.userPrompt).not.toContain('totalBytes');
  });

  it('uses the active provider client and always prepends fixed format rules', async () => {
    const seen: { systemPrompt?: string; userPrompt?: string } = {};
    const mockClient: GuidelineProviderClient = {
      async generate(args) {
        seen.systemPrompt = args.systemPrompt;
        seen.userPrompt = args.userPrompt;
        return '## Project-Specific Style Guidance\n\nUse warm village-fantasy diction.';
      },
    };

    const result = await generateGuidelineDraft(createProfile(), createSettings(), {
      sourceLang: 'ja',
      targetLang: 'ko',
      providerClient: mockClient,
    });

    expect(seen.systemPrompt).toContain('bounded project profile');
    expect(seen.userPrompt).toContain('SampleGame');
    expect(result.guideline).toContain(GUIDELINE_FIXED_FORMAT_RULES);
    expect(result.guideline).toContain('Use warm village-fantasy diction.');
    expect(result.guideline).toContain('Preserve dialogue separators exactly as-is');
    expect(result.guideline).toContain('Preserve the source line count');
  });

  it('does not call the provider when generation is already cancelled', async () => {
    let called = false;
    const mockClient: GuidelineProviderClient = {
      async generate() {
        called = true;
        return 'unused';
      },
    };

    await expect(generateGuidelineDraft(createProfile(), createSettings(), {
      sourceLang: 'ja',
      targetLang: 'ko',
      isAborted: () => true,
      providerClient: mockClient,
    })).rejects.toThrow('취소');
    expect(called).toBe(false);
  });
});
