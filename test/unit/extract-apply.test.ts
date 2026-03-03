import { describe, it, expect, beforeEach } from 'vitest';
import { extract, format_extracted, setObj, getVal } from '../../src/js/rpgmv/extract/index';
import { settings as defaultSettings } from '../../src/js/rpgmv/datas';
import { appCtx } from '../../src/appContext';
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
    appCtx.gb = {};
    appCtx.settings = { ...defaultSettings, formatNice: false, oneMapFile: false, onefile_src: false, onefile_note: false } as any;
    appCtx.mainWindow = { webContents: { send: () => {} } } as any;
    appCtx.useExternMsg = false;
    appCtx.externMsgKeys = [];
    appCtx.externMsg = {};
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

    it('creates intermediate objects for missing getVal path', () => {
      const obj: Record<string, unknown> = {};
      getVal('a.b.c', obj);
      expect(obj).toHaveProperty('a');
      expect((obj.a as Record<string, unknown>)).toHaveProperty('b');
    });

    it('sets multiple keys at different depths', () => {
      let obj: Record<string, unknown> = {};
      obj = setObj('a.b.c', 1, obj);
      obj = setObj('a.b.d', 2, obj);
      obj = setObj('a.e', 3, obj);
      expect(getVal('a.b.c', obj)).toBe(1);
      expect(getVal('a.b.d', obj)).toBe(2);
      expect(getVal('a.e', obj)).toBe(3);
    });

    it('handles numeric-like path segments', () => {
      const obj = setObj('0.pages.1.list.2', 'val', {});
      expect(getVal('0.pages.1.list.2', obj)).toBe('val');
    });
  });

  describe('basic extraction - Actors.json', () => {
    it('extracts actor name from Actors.json', async () => {
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Actors.json'), 'utf8');
      const conf = makeConf('Actors.json');
      const result = await extract(filedata, conf, 'actor', appCtx);

      expect(result.datobj).toBeDefined();
      expect(result.edited).toBeDefined();

      const keys = Object.keys(result.datobj);
      expect(keys.length).toBeGreaterThan(0);

      const nameEntry = Object.entries(result.datobj).find(([k]) => k.endsWith('.name'));
      expect(nameEntry).toBeDefined();
      expect((nameEntry![1] as any).var).toBe('Harold');
    });

    it('extracts actor nickname (even empty when ExtractAddLine is true)', async () => {
      appCtx.settings.ExtractAddLine = true;
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Actors.json'), 'utf8');
      const conf = makeConf('Actors.json');
      const result = await extract(filedata, conf, 'actor', appCtx);

      const nicknameEntry = Object.entries(result.datobj).find(([k]) => k.endsWith('.nickname'));
      expect(nicknameEntry).toBeDefined();
    });

    it('skips empty string values when ExtractAddLine is false', async () => {
      appCtx.settings.ExtractAddLine = false;
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Actors.json'), 'utf8');
      const conf = makeConf('Actors.json');
      const result = await extract(filedata, conf, 'actor', appCtx);

      const nicknameEntry = Object.entries(result.datobj).find(([k]) => k.endsWith('.nickname'));
      expect(nicknameEntry).toBeUndefined();
    });
  });

  describe('format_extracted output', () => {
    it('produces correct text output with line numbering metadata', async () => {
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Actors.json'), 'utf8');
      const conf = makeConf('Actors.json');
      const result = await extract(filedata, conf, 'actor', appCtx);
      await format_extracted(result, 0, appCtx);

      const gb = appCtx.gb['Actors.json'];
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
      const result = await extract(filedata, conf, 'actor', appCtx);
      await format_extracted(result, 0, appCtx);

      const gb = appCtx.gb['Actors.json'];
      for (const entry of Object.values(gb.data) as any[]) {
        expect(entry.origin).toBe('Actors.json');
      }
    });
  });

  describe('round-trip: extract → modify → apply', () => {
    it('preserves JSON structure after round-trip with modified text', async () => {
      const filedata = fs.readFileSync(path.join(fixturesDir, 'Actors.json'), 'utf8');
      const conf = makeConf('Actors.json');
      const result = await extract(filedata, conf, 'actor', appCtx);
      await format_extracted(result, 0, appCtx);

      const gb = appCtx.gb['Actors.json'];
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
      const result = await extract(filedata, conf, 'actor', appCtx);
      await format_extracted(result, 0, appCtx);

      const gb = appCtx.gb['Actors.json'];
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
      const result = await extract(filedata, conf, 'map', appCtx);

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
      const result = await extract(filedata, conf, 'map', appCtx);

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
      const result = await extract(filedata, conf, 'map', appCtx);
      await format_extracted(result, 0, appCtx);

      const gb = appCtx.gb['Map001.json'];
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
      const result = await extract(filedata, conf, 'sys', appCtx);

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
      const result = await extract(filedata, conf, 'map', appCtx);

      expect(result.datobj).toBeDefined();
      expect(Object.keys(result.datobj).length).toBe(0);
    });

    it('handles null entries in events array (sparse array)', async () => {
      const filedata = JSON.stringify({
        events: [null, null, null],
      });
      const conf = makeConf('Map003.json');
      const result = await extract(filedata, conf, 'map', appCtx);

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
      const result = await extract(filedata, conf, 'map', appCtx);
      await format_extracted(result, 0, appCtx);

      const gb = appCtx.gb['Map004.json'];
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
      const result = await extract(filedata, conf, 'actor', appCtx);

      expect(result.datobj).toEqual({});
      expect(result.edited).toEqual({});
    });

    it('handles BOM prefix in file data', async () => {
      const bom = '\uFEFF';
      const filedata = bom + JSON.stringify([null, { id: 1, name: 'BomTest', nickname: '', profile: '' }]);
      const conf = makeConf('BomActors.json');
      const result = await extract(filedata, conf, 'actor', appCtx);

      expect(appCtx.gb['BomActors.json'].isbom).toBe(true);
      const nameEntry = Object.entries(result.datobj).find(([k]) => k.endsWith('.name'));
      expect(nameEntry).toBeDefined();
      expect((nameEntry![1] as any).var).toBe('BomTest');
    });

    it('actors array with only null entry produces no extraction', async () => {
      const filedata = JSON.stringify([null]);
      const conf = makeConf('EmptyActors.json');
      const result = await extract(filedata, conf, 'actor', appCtx);

      expect(Object.keys(result.datobj).length).toBe(0);
    });
  });

  describe('Skills.json extraction', () => {
    it('extracts skill name and description', async () => {
      const filedata = JSON.stringify([
        null,
        { id: 1, name: 'Fire', description: 'Burns the enemy', message1: '%1 cast Fire!', message2: 'Flames erupt!' }
      ]);
      const conf = makeConf('Skills.json');
      const result = await extract(filedata, conf, 'skill', appCtx);

      const entries = Object.entries(result.datobj);
      const nameEntry = entries.find(([k]) => k === '1.name');
      const descEntry = entries.find(([k]) => k === '1.description');
      const msg1Entry = entries.find(([k]) => k === '1.message1');
      const msg2Entry = entries.find(([k]) => k === '1.message2');

      expect(nameEntry).toBeDefined();
      expect((nameEntry![1] as any).var).toBe('Fire');
      expect(descEntry).toBeDefined();
      expect((descEntry![1] as any).var).toBe('Burns the enemy');
      expect(msg1Entry).toBeDefined();
      expect((msg1Entry![1] as any).var).toBe('%1 cast Fire!');
      expect(msg2Entry).toBeDefined();
      expect((msg2Entry![1] as any).var).toBe('Flames erupt!');
    });

    it('skips empty skill fields when ExtractAddLine is false', async () => {
      const filedata = JSON.stringify([
        null,
        { id: 1, name: 'Heal', description: '', message1: '', message2: '' }
      ]);
      const conf = makeConf('Skills2.json');
      appCtx.settings.ExtractAddLine = false;
      const result = await extract(filedata, conf, 'skill', appCtx);

      const entries = Object.entries(result.datobj).filter(([k]) => !k.startsWith('comment_'));
      expect(entries.length).toBe(1); // only name
      expect(entries[0][0]).toBe('1.name');
    });
  });

  describe('Items.json extraction', () => {
    it('extracts item name and description', async () => {
      const filedata = JSON.stringify([
        null,
        { id: 1, name: 'Potion', description: 'Recovers 100 HP' },
        { id: 2, name: 'Ether', description: 'Recovers 50 MP' }
      ]);
      const conf = makeConf('Items.json');
      const result = await extract(filedata, conf, 'item', appCtx);

      const entries = Object.entries(result.datobj).filter(([k]) => !k.startsWith('comment_'));
      const names = entries.filter(([k]) => k.endsWith('.name'));
      const descs = entries.filter(([k]) => k.endsWith('.description'));
      expect(names.length).toBe(2);
      expect(descs.length).toBe(2);
      expect((names[0][1] as any).var).toBe('Potion');
      expect((descs[1][1] as any).var).toBe('Recovers 50 MP');
    });
  });

  describe('States.json extraction', () => {
    it('extracts all state text fields', async () => {
      const filedata = JSON.stringify([
        null,
        { id: 1, name: 'Poison', description: 'Takes damage each turn',
          message1: 'was poisoned!', message2: 'is still poisoned.',
          message3: 'recovered from poison.', message4: 'was poisoned!' }
      ]);
      const conf = makeConf('States.json');
      const result = await extract(filedata, conf, 'state', appCtx);

      const entries = Object.entries(result.datobj).filter(([k]) => !k.startsWith('comment_'));
      // state extracts: description, message1, message2, message3, message4, name
      const fieldNames = entries.map(([k]) => k.replace('1.', ''));
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('description');
      expect(fieldNames).toContain('message1');
      expect(fieldNames).toContain('message2');
      expect(fieldNames).toContain('message3');
      expect(fieldNames).toContain('message4');
    });
  });

  describe('Enemies.json extraction', () => {
    it('extracts enemy name', async () => {
      const filedata = JSON.stringify([
        null,
        { id: 1, name: 'Slime' },
        { id: 2, name: 'Bat' }
      ]);
      const conf = makeConf('Enemies.json');
      const result = await extract(filedata, conf, 'ene', appCtx);

      const entries = Object.entries(result.datobj).filter(([k]) => !k.startsWith('comment_'));
      expect(entries.length).toBe(2);
      expect((entries[0][1] as any).var).toBe('Slime');
      expect((entries[1][1] as any).var).toBe('Bat');
    });
  });

  describe('CommonEvents extraction (events ftype)', () => {
    it('extracts dialogue from common events', async () => {
      const filedata = JSON.stringify([
        null,
        {
          id: 1, name: 'Tutorial',
          list: [
            { code: 401, indent: 0, parameters: ['Welcome to the game!'] },
            { code: 401, indent: 0, parameters: ['Enjoy your adventure.'] },
            { code: 0, indent: 0, parameters: [] }
          ]
        }
      ]);
      const conf = makeConf('CommonEvents.json');
      const result = await extract(filedata, conf, 'events', appCtx);

      const entries = Object.entries(result.datobj).filter(([k]) => !k.startsWith('comment_'));
      expect(entries.length).toBe(2);
      expect((entries[0][1] as any).var).toBe('Welcome to the game!');
      expect((entries[1][1] as any).var).toBe('Enjoy your adventure.');
    });

    it('extracts code 102 choice commands', async () => {
      const filedata = JSON.stringify([
        null,
        {
          id: 1, name: 'Choice',
          list: [
            { code: 102, indent: 0, parameters: [['Yes', 'No']] },
            { code: 0, indent: 0, parameters: [] }
          ]
        }
      ]);
      const conf = makeConf('CommonEvents2.json');
      const result = await extract(filedata, conf, 'events', appCtx);

      const entries = Object.entries(result.datobj).filter(([k]) => !k.startsWith('comment_'));
      // code 102 extracts choice parameters: 'Yes' and 'No'
      const choiceValues = entries.map(([, v]) => (v as any).var);
      expect(choiceValues).toContain('Yes');
      expect(choiceValues).toContain('No');
    });
  });

  describe('event extraction with flags', () => {
    it('extracts note field when note flag is enabled', async () => {
      const filedata = JSON.stringify({
        events: [
          null,
          {
            id: 1, name: '', note: '<special_tag>',
            pages: [{ list: [{ code: 0, parameters: [] }] }]
          }
        ]
      });
      const conf = makeConf('MapNote.json', { note: true });
      const result = await extract(filedata, conf, 'map', appCtx);

      const noteEntry = Object.entries(result.datobj).find(([k]) => k.includes('.note'));
      expect(noteEntry).toBeDefined();
      expect((noteEntry![1] as any).var).toBe('<special_tag>');
    });

    it('does not extract note when note flag is disabled', async () => {
      const filedata = JSON.stringify({
        events: [
          null,
          {
            id: 1, name: '', note: '<special_tag>',
            pages: [{ list: [{ code: 0, parameters: [] }] }]
          }
        ]
      });
      const conf = makeConf('MapNoNote.json', { note: false });
      const result = await extract(filedata, conf, 'map', appCtx);

      const noteEntry = Object.entries(result.datobj).find(([k]) => k.includes('.note'));
      expect(noteEntry).toBeUndefined();
    });

    it('extracts script calls (code 356) when srce flag is enabled', async () => {
      const filedata = JSON.stringify({
        events: [
          null,
          {
            id: 1, name: '',
            pages: [{
              list: [
                { code: 356, indent: 0, parameters: ['SomePlugin call'] },
                { code: 0, indent: 0, parameters: [] }
              ]
            }]
          }
        ]
      });
      const conf = makeConf('MapSrce.json', { srce: true });
      const result = await extract(filedata, conf, 'map', appCtx);

      const scriptEntry = Object.entries(result.datobj).find(
        ([, v]) => (v as any).var === 'SomePlugin call'
      );
      expect(scriptEntry).toBeDefined();
      expect((scriptEntry![1] as any).conf.code).toBe(356);
    });

    it('does not extract script calls when srce flag is disabled', async () => {
      const filedata = JSON.stringify({
        events: [
          null,
          {
            id: 1, name: '',
            pages: [{
              list: [
                { code: 356, indent: 0, parameters: ['SomePlugin call'] },
                { code: 0, indent: 0, parameters: [] }
              ]
            }]
          }
        ]
      });
      const conf = makeConf('MapNoSrce.json', { srce: false });
      const result = await extract(filedata, conf, 'map', appCtx);

      const scriptEntry = Object.entries(result.datobj).find(
        ([, v]) => (v as any).var === 'SomePlugin call'
      );
      expect(scriptEntry).toBeUndefined();
    });

    it('extracts javascript (code 355) when ext_javascript is enabled', async () => {
      const filedata = JSON.stringify({
        events: [
          null,
          {
            id: 1, name: '',
            pages: [{
              list: [
                { code: 355, indent: 0, parameters: ['console.log("test")'] },
                { code: 0, indent: 0, parameters: [] }
              ]
            }]
          }
        ]
      });
      const conf = makeConf('MapJs.json', { arg: { dir: '/tmp/', ext_javascript: true, ext_src: false, ext_note: false } });
      const result = await extract(filedata, conf, 'map', appCtx);

      const jsEntry = Object.entries(result.datobj).find(
        ([, v]) => (v as any).var === 'console.log("test")'
      );
      expect(jsEntry).toBeDefined();
    });

    it('extracts code 108 note commands when note flag is enabled', async () => {
      const filedata = JSON.stringify({
        events: [
          null,
          {
            id: 1, name: '',
            pages: [{
              list: [
                { code: 108, indent: 0, parameters: ['<encounter_rate:200>'] },
                { code: 0, indent: 0, parameters: [] }
              ]
            }]
          }
        ]
      });
      const conf = makeConf('MapNote2.json', { note: true });
      const result = await extract(filedata, conf, 'map', appCtx);

      const noteEntry = Object.entries(result.datobj).find(
        ([, v]) => (v as any).var === '<encounter_rate:200>'
      );
      expect(noteEntry).toBeDefined();
      expect((noteEntry![1] as any).conf.code).toBe(108);
    });
  });

  describe('Plugin extraction', () => {
    it('extracts plugin parameters', async () => {
      const filedata = JSON.stringify([
        null,
        {
          name: 'MyPlugin',
          parameters: {
            'helpText': 'This is help text',
            'maxCount': '10',
            'enabled': 'true'
          }
        }
      ]);
      const conf = makeConf('ext_plugins.json');
      const result = await extract(filedata, conf, 'plugin', appCtx);

      // Numeric and boolean-like values ('10', 'true') are skipped
      const entries = Object.entries(result.datobj).filter(([k]) => !k.startsWith('comment_'));
      expect(entries.length).toBe(1);
      expect((entries[0][1] as any).var).toBe('This is help text');
    });

    it('skips false/true/on/off/auto plugin parameters', async () => {
      const filedata = JSON.stringify([
        null,
        {
          name: 'TestPlugin',
          parameters: {
            'opt1': 'false',
            'opt2': 'true',
            'opt3': 'on',
            'opt4': 'off',
            'opt5': 'auto',
            'text': 'Actual text'
          }
        }
      ]);
      const conf = makeConf('ext_plugins2.json');
      const result = await extract(filedata, conf, 'plugin', appCtx);

      const entries = Object.entries(result.datobj).filter(([k]) => !k.startsWith('comment_'));
      expect(entries.length).toBe(1);
      expect((entries[0][1] as any).var).toBe('Actual text');
    });
  });

  describe('generic ex extraction', () => {
    it('extracts all string leaves from arbitrary nested object', async () => {
      const filedata = JSON.stringify({
        title: 'My Game',
        nested: { deep: { value: 'Secret' } },
        num: 42
      });
      const conf = makeConf('Custom.json');
      const result = await extract(filedata, conf, 'ex', appCtx);

      const entries = Object.entries(result.datobj).filter(([k]) => !k.startsWith('comment_'));
      const values = entries.map(([, v]) => (v as any).var);
      expect(values).toContain('My Game');
      expect(values).toContain('Secret');
      // numeric leaf should not be extracted
      expect(values).not.toContain(42);
      expect(values).not.toContain('42');
    });
  });

  describe('format_extracted features', () => {
    it('formatNice adds beautify separators for code 108', async () => {
      appCtx.settings.formatNice = true;
      const filedata = JSON.stringify({
        events: [
          null,
          {
            id: 1, name: '',
            pages: [{
              list: [
                { code: 108, indent: 0, parameters: ['note_text'] },
                { code: 0, indent: 0, parameters: [] }
              ]
            }]
          }
        ]
      });
      const conf = makeConf('MapFmt.json', { note: true });
      const result = await extract(filedata, conf, 'map', appCtx);
      await format_extracted(result, 0, appCtx);

      const output = appCtx.gb['MapFmt.json'].outputText!;
      expect(output).toContain('==========\n');
      expect(output).toContain('note_text');
    });

    it('formatNice adds beautify separators for code 356 (per event)', async () => {
      appCtx.settings.formatNice = true;
      const filedata = JSON.stringify({
        events: [
          null,
          {
            id: 1, name: '',
            pages: [{
              list: [
                { code: 356, indent: 0, parameters: ['script_call'] },
                { code: 0, indent: 0, parameters: [] }
              ]
            }]
          }
        ]
      });
      const conf = makeConf('MapFmt2.json', { srce: true });
      const result = await extract(filedata, conf, 'map', appCtx);
      await format_extracted(result, 0, appCtx);

      const output = appCtx.gb['MapFmt2.json'].outputText!;
      expect(output).toContain('//==========//\n');
    });

    it('onefile_src routes script entries to ext_scripts.json', async () => {
      appCtx.settings.onefile_src = true;
      appCtx.gb['ext_scripts.json'] = { data: {}, outputText: '', isbom: false };
      const filedata = JSON.stringify({
        events: [
          null,
          {
            id: 1, name: '',
            pages: [{
              list: [
                { code: 356, indent: 0, parameters: ['plugin_call'] },
                { code: 0, indent: 0, parameters: [] }
              ]
            }]
          }
        ]
      });
      const conf = makeConf('MapSrc.json', { srce: true });
      const result = await extract(filedata, conf, 'map', appCtx);
      await format_extracted(result, 0, appCtx);

      // Script entry should be routed to ext_scripts.json, not MapSrc.json
      const scriptGb = appCtx.gb['ext_scripts.json'];
      expect(scriptGb.outputText).toContain('plugin_call');
    });

    it('onefile_note routes note entries to ext_note.json', async () => {
      appCtx.settings.onefile_note = true;
      appCtx.gb['ext_note.json'] = { data: {}, outputText: '', isbom: false };
      appCtx.gb['ext_note2.json'] = { data: {}, outputText: '', isbom: false };
      const filedata = JSON.stringify({
        events: [
          null,
          {
            id: 1, name: '', note: '<tag>',
            pages: [{
              list: [
                { code: 108, indent: 0, parameters: ['note_cmd'] },
                { code: 0, indent: 0, parameters: [] }
              ]
            }]
          }
        ]
      });
      const conf = makeConf('MapNoteFile.json', { note: true });
      const result = await extract(filedata, conf, 'map', appCtx);
      await format_extracted(result, 0, appCtx);

      // Event-level note (qpath='note') goes to ext_note.json
      const noteGb = appCtx.gb['ext_note.json'];
      expect(noteGb.outputText).toContain('<tag>');
      // Code 108 note command (qpath='note2') goes to ext_note2.json
      const note2Gb = appCtx.gb['ext_note2.json'];
      expect(note2Gb.outputText).toContain('note_cmd');
    });

    it('externMsg substitution replaces matching keys', async () => {
      appCtx.useExternMsg = true;
      appCtx.externMsgKeys = ['Original Text'];
      appCtx.externMsg = { 'Original Text': 'Replaced Text' };

      const filedata = JSON.stringify([
        null,
        { id: 1, name: 'Original Text', nickname: '', profile: '' }
      ]);
      const conf = makeConf('ActorsExt.json');
      const result = await extract(filedata, conf, 'actor', appCtx);
      await format_extracted(result, 0, appCtx);

      const gb = appCtx.gb['ActorsExt.json'];
      expect(gb.outputText).toContain('Replaced Text');
      expect(gb.outputText).not.toContain('Original Text');
    });

    it('oneMapFile routes map entries to Maps.json', async () => {
      appCtx.settings.oneMapFile = true;
      appCtx.gb['Maps.json'] = { data: {}, outputText: '', isbom: false };
      const filedata = JSON.stringify({
        events: [
          null,
          {
            id: 1, name: '',
            pages: [{
              list: [
                { code: 401, indent: 0, parameters: ['Hello from map'] },
                { code: 0, indent: 0, parameters: [] }
              ]
            }]
          }
        ]
      });
      const conf = makeConf('Map001.json');
      const result = await extract(filedata, conf, 'map', appCtx);
      await format_extracted(result, 0, appCtx);

      const mapsGb = appCtx.gb['Maps.json'];
      expect(mapsGb.outputText).toContain('Hello from map');
    });

    it('metadata m values are correct for multi-line text', async () => {
      const filedata = JSON.stringify([
        null,
        { id: 1, name: 'Hero', description: 'A brave\nwarrior', message1: '', message2: '' }
      ]);
      const conf = makeConf('SkillsMeta.json');
      const result = await extract(filedata, conf, 'skill', appCtx);
      await format_extracted(result, 0, appCtx);

      const gb = appCtx.gb['SkillsMeta.json'];
      const lines = gb.outputText!.split('\n');
      for (const [lineNum, entry] of Object.entries(gb.data) as [string, any][]) {
        const start = parseInt(lineNum);
        // Reconstruct text from lines using metadata
        let reconstructed = '';
        for (let x = start; x < entry.m; x++) {
          reconstructed += lines[x];
          if (x !== entry.m - 1) reconstructed += '\n';
        }
        expect(reconstructed).toBe(entry.originText);
      }
    });
  });
});
