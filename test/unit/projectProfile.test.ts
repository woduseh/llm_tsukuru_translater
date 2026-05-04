import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { scanProjectTranslationProfile } from '../../src/ts/libs/projectProfile';

const tmpRoot = path.join(process.cwd(), 'test', '.tmp-project-profile');

function writeFixture(relativePath: string, content: string): void {
  const filePath = path.join(tmpRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

describe('projectProfile', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('profiles RPG Maker JSON names, phrases, language hints, and file statistics deterministically', () => {
    writeFixture('data\\Actors.json', JSON.stringify([
      null,
      { id: 1, name: 'Harold', nickname: 'Hero', profile: 'Brave knight' },
      { id: 2, name: 'テレーゼ', nickname: '', profile: '魔法の先生' },
    ]));
    writeFixture('data\\Map001.json', JSON.stringify({
      events: [null, {
        name: 'Village Elder',
        pages: [{
          list: [
            { code: 401, parameters: ['Harold: Welcome to town!'] },
            { code: 401, parameters: ['Welcome to town!'] },
          ],
        }],
      }],
    }));

    const first = scanProjectTranslationProfile(tmpRoot);
    const second = scanProjectTranslationProfile(tmpRoot);

    expect(second).toEqual(first);
    expect(first.fileStats.byKind['rpg-maker-json']).toBe(2);
    expect(first.fileStats.scannedFiles).toBe(2);
    expect(first.names.map((entry) => entry.text)).toEqual(expect.arrayContaining(['Harold', 'Hero', 'テレーゼ']));
    expect(first.characterCandidates.map((entry) => entry.text)).toContain('Harold');
    expect(first.repeatedPhrases).toContainEqual(expect.objectContaining({ text: 'Welcome to town!', count: 2 }));
    expect(first.languageHints.katakana).toBeGreaterThan(0);
    expect(first.languageHints.kanji).toBeGreaterThan(0);
  });

  it('detects extracted text separators and RPG Maker control-code shapes without storing long lines', () => {
    const longDialogue = `Alice: ${'secret-source '.repeat(30)}\\V[123]`;
    writeFixture('Extract\\Map001.txt', [
      '--- 101 ---',
      'Alice: Hello \\N[1]!',
      'Alice: Hello \\N[1]!',
      '\\C[2]Colored text',
      longDialogue,
    ].join('\n'));

    const profile = scanProjectTranslationProfile(tmpRoot, { maxSampleLength: 32 });

    expect(profile.separatorPatterns).toContainEqual(expect.objectContaining({
      pattern: '--- <label> ---',
      count: 1,
    }));
    expect(profile.controlCodePatterns).toEqual(expect.arrayContaining([
      expect.objectContaining({ pattern: '\\N[]', count: 2 }),
      expect.objectContaining({ pattern: '\\C[]', count: 1 }),
      expect.objectContaining({ pattern: '\\V[]', count: 1 }),
    ]));
    expect(profile.characterCandidates).toContainEqual(expect.objectContaining({ text: 'Alice' }));
    expect(profile.repeatedPhrases).toContainEqual(expect.objectContaining({ text: 'Alice: Hello \\N[1]!', count: 2 }));
    expect(JSON.stringify(profile)).not.toContain('secret-source secret-source secret-source secret-source');
    expect(profile.terms.every((entry) => entry.text.length <= 32)).toBe(true);
  });

  it('keeps samples and scanned files bounded for large projects', () => {
    for (let i = 0; i < 12; i += 1) {
      writeFixture(`Extract\\part-${String(i).padStart(2, '0')}.txt`, [
        `Line ${i} repeated phrase`,
        `Character${i}: Hello`,
        `UniqueTerm${i}`,
      ].join('\n'));
    }

    const profile = scanProjectTranslationProfile(tmpRoot, {
      maxFiles: 5,
      maxTerms: 4,
      maxRepeatedPhrases: 3,
      maxCandidates: 2,
      maxSamplesPerBucket: 3,
    });

    expect(profile.fileStats.totalFiles).toBe(12);
    expect(profile.fileStats.scannedFiles).toBe(5);
    expect(profile.fileStats.skippedFiles).toBeGreaterThanOrEqual(7);
    expect(profile.terms.length).toBeLessThanOrEqual(4);
    expect(profile.repeatedPhrases.length).toBeLessThanOrEqual(3);
    expect(profile.characterCandidates.length).toBeLessThanOrEqual(2);
    expect(profile.warnings.some((warning) => warning.includes('maxFiles'))).toBe(true);
  });

  it('records Wolf project file statistics without reading binary source content', () => {
    const binaryPath = path.join(tmpRoot, 'Data', 'BasicData.wolf');
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.writeFileSync(binaryPath, Buffer.from([0x00, 0x01, 0x02, 0xff]));
    writeFixture('Data\\Database.project', 'Wolf RPG Editor project marker');

    const profile = scanProjectTranslationProfile(tmpRoot);

    expect(profile.fileStats.byKind['wolf-data']).toBe(2);
    expect(profile.fileStats.scannedFiles).toBe(0);
    expect(profile.terms).toEqual([]);
    expect(JSON.stringify(profile)).not.toContain('Wolf RPG Editor project marker');
  });
});
