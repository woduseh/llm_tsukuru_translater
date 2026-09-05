import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer, type InlineConfig, type ViteDevServer } from 'vite';

const require = createRequire(import.meta.url);
const { createRendererServer } = require('../../scripts/dev.cjs');
const servers: ViteDevServer[] = [];
const roots: string[] = [];
const scratch = path.resolve('artifacts/unit/dev-server');

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  for (const root of roots.splice(0)) {
    expect(path.dirname(fs.realpathSync(root))).toBe(fs.realpathSync(scratch));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('two real Vite servers keep distinct ports and serve their own checkout', async () => {
  fs.mkdirSync(scratch, { recursive: true });
  const urls: string[] = [];
  for (const marker of ['first checkout', 'second checkout']) {
    const root = fs.mkdtempSync(path.join(scratch, 'run-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'index.html'), `<h1>${marker}</h1>`);
    const server: ViteDevServer = await createRendererServer(root, (config: InlineConfig) => createServer({
      ...config, configFile: false, root, cacheDir: path.join(root, '.vite'),
      logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] },
    }));
    servers.push(server);
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port');
    urls.push(`http://127.0.0.1:${address.port}/`);
  }
  expect(urls[0]).not.toBe(urls[1]);
  expect(await (await fetch(urls[0])).text()).toContain('first checkout');
  expect(await (await fetch(urls[1])).text()).toContain('second checkout');
});
