import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { installProjectFont, updateProjectFontSize } from '../../src/ts/rpgmv/fonts';

const sandboxRoot = path.resolve('artifacts', 'unit', 'fonts');
const cleanupDirs: string[] = [];
let sequence = 0;

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('updateProjectFontSize', () => {
  it('updates the RPG Maker MV font-size override', () => {
    const dataDir = makeProject('mv');
    const scriptPath = path.join(path.dirname(dataDir), 'js', 'rpg_windows.js');
    fs.writeFileSync(scriptPath, 'Window_Base.prototype.standardFontSize = function() { return 28; };\n', 'utf8');

    updateProjectFontSize(dataDir, 34);

    expect(fs.readFileSync(scriptPath, 'utf8')).toContain('return 34');
  });

  it('updates the RPG Maker MZ Game_System font-size method', () => {
    const dataDir = makeProject('mz');
    const scriptPath = path.join(path.dirname(dataDir), 'js', 'rmmz_objects.js');
    fs.writeFileSync(scriptPath, [
      'Game_System.prototype.mainFontSize = function() {',
      '    return 26;',
      '};',
      '',
    ].join('\n'), 'utf8');

    updateProjectFontSize(dataDir, 32);

    const result = fs.readFileSync(scriptPath, 'utf8');
    expect(result).toContain('return 32');
    expect(result.match(/Game_System\.prototype\.mainFontSize/g)).toHaveLength(1);
  });
});

describe('installProjectFont', () => {
  it('updates the MV GameFont URL and installs the selected font', () => {
    const dataDir = makeProject('mv-font');
    const root = path.dirname(dataDir);
    const fontsDir = path.join(root, 'fonts');
    const cssPath = path.join(fontsDir, 'gamefont.css');
    const sourcePath = path.join(root, 'chosen.otf');
    fs.mkdirSync(fontsDir, { recursive: true });
    fs.writeFileSync(cssPath, '@font-face {\n  font-family: GameFont;\n  src: url("custom-old.ttf");\n}\n', 'utf8');
    fs.writeFileSync(sourcePath, 'font-bytes', 'utf8');

    installProjectFont(dataDir, sourcePath);

    expect(fs.readFileSync(cssPath, 'utf8')).toContain('url("tsukuru-selected-font.otf")');
    expect(fs.readFileSync(path.join(fontsDir, 'tsukuru-selected-font.otf'), 'utf8')).toBe('font-bytes');
  });

  it('updates the MZ System.json main font filename', () => {
    const dataDir = makeProject('mz-font');
    const root = path.dirname(dataDir);
    const sourcePath = path.join(root, 'chosen.ttf');
    fs.writeFileSync(path.join(root, 'js', 'rmmz_objects.js'), '', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'System.json'), JSON.stringify({
      advanced: { mainFontFilename: 'old.woff' },
    }), 'utf8');
    fs.writeFileSync(sourcePath, 'font-bytes', 'utf8');

    installProjectFont(dataDir, sourcePath);

    const system = JSON.parse(fs.readFileSync(path.join(dataDir, 'System.json'), 'utf8'));
    expect(system.advanced.mainFontFilename).toBe('tsukuru-selected-font.ttf');
    expect(fs.readFileSync(path.join(root, 'fonts', 'tsukuru-selected-font.ttf'), 'utf8')).toBe('font-bytes');
  });
});

function makeProject(prefix: string): string {
  const projectRoot = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  const dataDir = path.join(projectRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'js'), { recursive: true });
  cleanupDirs.push(projectRoot);
  return dataDir;
}
