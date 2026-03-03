import { describe, it, expect, beforeEach } from 'vitest';
import { extract, format_extracted, setObj, getVal } from '../../src/js/rpgmv/extract/index';
import { settings as defaultSettings } from '../../src/js/rpgmv/datas';
import fs from 'fs';
import path from 'path';

const fixturesDir = path.join(__dirname, '..', 'fixtures');

function makeConf(fileName: string, overrides: Record<string, any> = {}) {
  return {
    extended: false,
    fileName,
    dir: '/tmp/test/',
    note: false,
    srce: false,
    arg: { dir: '/tmp/test/', ext_javascript: false, ext_src: false, ext_note: false },
    ...overrides,
  };
}

describe('extract-apply round-trip', () => {
  beforeEach(() => {
    globalThis.gb = {};
    globalThis.settings = { ...defaultSettings, formatNice: false, oneMapFile: false, onefile_src: false, onefile_note: false };
    globalThis.mwindow = { webContents: { send: () => {} } } as any;
    globalThis.useExternMsg = false;
    globalThis.externMsgKeys = [];
    globalThis.externMsg = {};
  });

  describe('setObj and getVal utilities', () => {
    it('sets and gets a simple key', () => {
      const obj = setObj('name', 'Alice', {});
      expect(getVal('name', obj)).toBe('Alice');
    });

    it('sets and gets a nested key', () => {
      const obj = setObj('events.1.pages.0.list.0.parameters.0', 'Hello', {});
      expect(getVal('events.1.pages.0.list.0.parameters.0', obj)).toBe('Hello');
    });

    it('overwrites existing value at path', () => {
      let obj: Record<string, unknown> = { a: { b: 'old' } };
      obj = setObj('a.b', 'new', obj);
      expect(getVal('a.b', obj)).toBe('new');
    });

    it('returns empty string for undefined root', () => {
      expect(getVal('missing.path', undefined)).toBe('');
    });
  });

  describe('basic extraction - Actors.json', () => {
    it('extracts actor name from Actors.json', async () => {
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Actors.json'), 'utf8');
      const conf = makeConf('Actors.json');
      const result = await extract(filedata, conf, 'actor');

      expect(result.datobj).toBeDefined();
      expect(result.edited).toBeDefined();

      const keys = Object.keys(result.datobj);
      expect(keys.length).toBeGreaterThan(0);

      const nameEntry = Object.entries(result.datobj).find(([k]) => k.endsWith('.name'));
      expect(nameEntry).toBeDefined();
      expect((nameEntry![1] as any).var).toBe('Harold');
    });

    it('extracts actor nickname (even empty when ExtractAddLine is true)', async () => {
      globalThis.settings.ExtractAddLine = true;
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Actors.json'), 'utf8');
      const conf = makeConf('Actors.json');
      const result = await extract(filedata, conf, 'actor');

      const nicknameEntry = Object.entries(result.datobj).find(([k]) => k.endsWith('.nickname'));
      expect(nicknameEntry).toBeDefined();
    });

    it('skips empty string values when ExtractAddLine is false', async () => {
      globalThis.settings.ExtractAddLine = false;
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Actors.json'), 'utf8');
      const conf = makeConf('Actors.json');
      const result = await extract(filedata, conf, 'actor');

      const nicknameEntry = Object.entries(result.datobj).find(([k]) => k.endsWith('.nickname'));
      expect(nicknameEntry).toBeUndefined();
    });
  });

  describe('format_extracted output', () => {
    it('produces correct text output with line numbering metadata', async () => {
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Actors.json'), 'utf8');
      const conf = makeConf('Actors.json');
      const result = await extract(filedata, conf, 'actor');
      await format_extracted(result);

      const gb = globalThis.gb['Actors.json'];
      expect(gb.outputText).toBeDefined();
      expect(gb.outputText)!.toContain('Harold');

      // Verify metadata line numbers are consistent with text
      const lines = gb.outputText!.split('\n');
      for (const [lineNum, entry] of Object.entries(gb.data) as [string, any][]) {
        const idx = parseInt(lineNum);
        expect(idx).toBeLessThan(lines.length);
        expect(entry.val).toBeDefined();
        expect(entry.m).toBeGreaterThan(idx);
      }
    });

    it('metadata origin matches the source file', async () => {
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Actors.json'), 'utf8');
      const conf = makeConf('Actors.json');
      const result = await extract(filedata, conf, 'actor');
      await format_extracted(result);

      const gb = globalThis.gb['Actors.json'];
      for (const entry of Object.values(gb.data) as any[]) {
        expect(entry.origin).toBe('Actors.json');
      }
    });
  });

  describe('round-trip: extract → modify → apply', () => {
    it('preserves JSON structure after round-trip with modified text', async () => {
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Actors.json'), 'utf8');
      const conf = makeConf('Actors.json');
      const result = await extract(filedata, conf, 'actor');
      await format_extracted(result);

      const gb = globalThis.gb['Actors.json'];
      const textLines = gb.outputText!.split('\n');

      // Simulate translation: replace text in the lines
      for (const [lineNum, entry] of Object.entries(gb.data) as [string, any][]) {
        const idx = parseInt(lineNum);
        for (let x = idx; x < entry.m; x++) {
          textLines[x] = 'TRANSLATED_' + textLines[x];
        }
      }

      // Apply: reconstruct JSON using metadata
      let outputData = JSON.parse(filedata);
      for (const [lineNum, entry] of Object.entries(gb.data) as [string, any][]) {
        const idx = parseInt(lineNum);
        let output = '';
        for (let x = idx; x < entry.m; x++) {
          output += textLines[x];
          if (x !== entry.m - 1) output += '\n';
        }
        outputData = setObj(entry.val, output, outputData);
      }

      // Verify translated values applied correctly
      expect(outputData[1].name).toBe('TRANSLATED_Harold');
      // Structure preserved: id still exists
      expect(outputData[1].id).toBe(1);
      // Null first entry preserved
      expect(outputData[0]).toBeNull();
    });

    it('round-trip with identity (no modification) produces original values', async () => {
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Actors.json'), 'utf8');
      const original = JSON.parse(filedata);
      const conf = makeConf('Actors.json');
      const result = await extract(filedata, conf, 'actor');
      await format_extracted(result);

      const gb = globalThis.gb['Actors.json'];
      const textLines = gb.outputText!.split('\n');

      // Apply without modification
      let outputData = JSON.parse(filedata);
      for (const [lineNum, entry] of Object.entries(gb.data) as [string, any][]) {
        const idx = parseInt(lineNum);
        let output = '';
        for (let x = idx; x < entry.m; x++) {
          output += textLines[x];
          if (x !== entry.m - 1) output += '\n';
        }
        outputData = setObj(entry.val, output, outputData);
      }

      expect(outputData[1].name).toBe(original[1].name);
      expect(outputData[1].id).toBe(original[1].id);
    });
  });

  describe('map extraction - Map001.json', () => {
    it('extracts event dialogue text from map', async () => {
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Map001.json'), 'utf8');
      const conf = makeConf('Map001.json');
      const result = await extract(filedata, conf, 'map');

      const keys = Object.keys(result.datobj);
      expect(keys.length).toBeGreaterThan(0);

      // The map has a code 401 event with "Hello World"
      const dialogueEntry = Object.entries(result.datobj).find(
        ([, v]: [string, any]) => v.var === 'Hello World'
      );
      expect(dialogueEntry).toBeDefined();
    });

    it('extracted path points to correct event parameter location', async () => {
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Map001.json'), 'utf8');
      const conf = makeConf('Map001.json');
      const result = await extract(filedata, conf, 'map');

      const dialogueEntry = Object.entries(result.datobj).find(
        ([, v]: [string, any]) => v.var === 'Hello World'
      );
      expect(dialogueEntry).toBeDefined();
      const jsonPath = dialogueEntry![0];
      // Verify the path resolves to "Hello World" in the edited data
      expect(getVal(jsonPath, result.edited)).toBe('Hello World');
    });

    it('round-trip works for map extraction', async () => {
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Map001.json'), 'utf8');
      const conf = makeConf('Map001.json');
      const result = await extract(filedata, conf, 'map');
      await format_extracted(result);

      const gb = globalThis.gb['Map001.json'];
      const textLines = gb.outputText!.split('\n');

      // Modify text
      for (const [lineNum, entry] of Object.entries(gb.data) as [string, any][]) {
        const idx = parseInt(lineNum);
        for (let x = idx; x < entry.m; x++) {
          textLines[x] = textLines[x].replace('Hello World', 'こんにちは世界');
        }
      }

      // Apply
      let outputData = JSON.parse(filedata);
      for (const [lineNum, entry] of Object.entries(gb.data) as [string, any][]) {
        const idx = parseInt(lineNum);
        let output = '';
        for (let x = idx; x < entry.m; x++) {
          output += textLines[x];
          if (x !== entry.m - 1) output += '\n';
        }
        outputData = setObj(entry.val, output, outputData);
      }

      // Verify translation applied
      expect(outputData.events[1].pages[0].list[0].parameters[0]).toBe('こんにちは世界');
      // Structure preserved
      expect(outputData.events[0]).toBeNull();
      expect(outputData.events[1].id).toBe(1);
    });
  });

  describe('System.json extraction', () => {
    it('extracts system terms messages', async () => {
      const filedata = fs.readFileSync(path.join(fixturesDir, 'System.json'), 'utf8');
      const conf = makeConf('System.json');
      const result = await extract(filedata, conf, 'sys');

      const entries = Object.entries(result.datobj);
      expect(entries.length).toBeGreaterThan(0);

      const alwaysDash = entries.find(([, v]: [string, any]) => v.var === 'Always Dash');
      expect(alwaysDash).toBeDefined();

      const commandRemember = entries.find(([, v]: [string, any]) => v.var === 'Remember Command');
      expect(commandRemember).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('handles empty events array in map', async () => {
      const filedata = JSON.stringify({ events: [] });
      const conf = makeConf('Map002.json');
      const result = await extract(filedata, conf, 'map');

      expect(result.datobj).toBeDefined();
      expect(Object.keys(result.datobj).length).toBe(0);
    });

    it('handles null entries in events array (sparse array)', async () => {
      const filedata = JSON.stringify({
        events: [null, null, null],
      });
      const conf = makeConf('Map003.json');
      const result = await extract(filedata, conf, 'map');

      expect(result.datobj).toBeDefined();
      expect(Object.keys(result.datobj).length).toBe(0);
    });

    it('handles multi-line text with newlines', async () => {
      const filedata = JSON.stringify({
        events: [
          null,
          {
            id: 1,
            name: '',
            pages: [
              {
                list: [
                  { code: 401, parameters: ['Line1\nLine2\nLine3'] },
                  { code: 0, parameters: [] },
                ],
              },
            ],
          },
        ],
      });
      const conf = makeConf('Map004.json');
      const result = await extract(filedata, conf, 'map');
      await format_extracted(result);

      const gb = globalThis.gb['Map004.json'];
      // Multi-line text should appear in the output
      expect(gb.outputText)!.toContain('Line1\nLine2\nLine3');

      // Verify metadata: multi-line text spans multiple lines in txt
      const dataEntries = Object.entries(gb.data) as [string, any][];
      const multiLineEntry = dataEntries.find(([, e]) => e.originText.includes('Line1'));
      expect(multiLineEntry).toBeDefined();
    });

    it('handles invalid JSON gracefully', async () => {
      const filedata = 'not valid json {{{';
      const conf = makeConf('Bad.json');
      const result = await extract(filedata, conf, 'actor');

      expect(result.datobj).toEqual({});
      expect(result.edited).toEqual({});
    });

    it('handles BOM prefix in file data', async () => {
      const bom = '\uFEFF';
      const filedata = bom + JSON.stringify([null, { id: 1, name: 'BomTest', nickname: '', profile: '' }]);
      const conf = makeConf('BomActors.json');
      const result = await extract(filedata, conf, 'actor');

      expect(globalThis.gb['BomActors.json'].isbom).toBe(true);
      const nameEntry = Object.entries(result.datobj).find(([k]) => k.endsWith('.name'));
      expect(nameEntry).toBeDefined();
      expect((nameEntry![1] as any).var).toBe('BomTest');
    });

    it('actors array with only null entry produces no extraction', async () => {
      const filedata = JSON.stringify([null]);
      const conf = makeConf('EmptyActors.json');
      const result = await extract(filedata, conf, 'actor');

      expect(Object.keys(result.datobj).length).toBe(0);
    });
  });
});
