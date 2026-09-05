const fs = require('fs');
const path = require('path');

// tsc does not remove output for deleted or renamed source files.
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.resolve(projectRoot, 'dist-main');
if (path.dirname(outputDir) !== projectRoot) {
  throw new Error('Main build output must be inside the project root.');
}
fs.rmSync(outputDir, { recursive: true, force: true });
