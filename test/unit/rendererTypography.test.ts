import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const MIN_FONT_SIZE_PX = 12;

function rendererStyleFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return rendererStyleFiles(fullPath);
    return /\.(vue|css)$/.test(entry.name) ? [fullPath] : [];
  });
}

it(`keeps renderer text at ${MIN_FONT_SIZE_PX}px or larger`, () => {
  const violations = rendererStyleFiles(path.resolve('src/renderer')).flatMap((file) =>
    fs.readFileSync(file, 'utf8').split('\n').flatMap((line, index) =>
      [...line.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)]
        .filter(match => Number(match[1]) < MIN_FONT_SIZE_PX)
        .map(match => `${path.relative(process.cwd(), file)}:${index + 1} uses ${match[0]}`)));

  expect(violations, `Use ${MIN_FONT_SIZE_PX}px for metadata and badges; show hierarchy with weight or color instead of smaller text.`).toEqual([]);
});
