const fs = require('node:fs');
const path = require('node:path');
const changes = JSON.parse(fs.readFileSync(path.join(__dirname, 'changes.json'), 'utf8'));
for (const c of changes) {
  if (!fs.readFileSync(c.file).equals(Buffer.from(c.before, 'base64'))) throw new Error(`File changed since preparation: ${c.file}`);
}
for (const c of changes) {
  fs.writeFileSync(c.file, Buffer.from(c.after, 'base64'));
  if (!fs.readFileSync(c.file).equals(Buffer.from(c.after, 'base64'))) throw new Error(`Readback failed: ${c.file}`);
  console.log(`Updated: ${c.file}`);
}
