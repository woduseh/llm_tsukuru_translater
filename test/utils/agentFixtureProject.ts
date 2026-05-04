import * as fs from 'fs';
import * as path from 'path';

export interface GeneratedAgentFixtureProject {
  root: string;
  dataDir: string;
  extractDir: string;
  manifestPath: string;
  manifest: {
    schemaVersion: 1;
    engine: 'rpg-maker-mock';
    includes: string[];
    shiftedLineFixture: string;
  };
}

export function generateAgentFixtureProject(root: string): GeneratedAgentFixtureProject {
  fs.rmSync(root, { recursive: true, force: true });
  const dataDir = path.join(root, 'data');
  const extractDir = path.join(root, 'Extract');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(extractDir, { recursive: true });

  fs.writeFileSync(path.join(dataDir, 'Map001.json'), JSON.stringify({
    events: [null, {
      id: 1,
      name: 'FixtureEvent',
      pages: [{
        list: [
          { code: 101, parameters: ['', 0, 0, 2] },
          { code: 401, parameters: ['Hello \\V[1]'] },
          { code: 401, parameters: [''] },
          { code: 401, parameters: ['Keep --- marker text'] },
          { code: 0, parameters: [] },
        ],
      }],
    }],
  }, null, 2), 'utf-8');

  fs.writeFileSync(path.join(extractDir, 'Map001.txt'), [
    '--- 101 ---',
    'Hello \\V[1]',
    '',
    'Keep --- marker text',
    'Shift source line',
    'Shift translated line extra',
    '',
  ].join('\n'), 'utf-8');

  fs.writeFileSync(path.join(extractDir, 'Map001.shifted.txt'), [
    '--- 101 ---',
    'Hello \\V[1]',
    'unexpected inserted line',
    '',
    'Keep --- marker text',
  ].join('\n'), 'utf-8');

  const manifest = {
    schemaVersion: 1 as const,
    engine: 'rpg-maker-mock' as const,
    includes: ['separators', 'empty-lines', 'control-codes', 'shifted-lines'],
    shiftedLineFixture: 'Extract\\Map001.shifted.txt',
  };
  const manifestPath = path.join(root, 'agent-fixture-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return { root, dataDir, extractDir, manifestPath, manifest };
}
