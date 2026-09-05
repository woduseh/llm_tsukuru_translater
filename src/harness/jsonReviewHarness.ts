import { BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';

/** Real renderer actions and disk writes; only the external LLM boundary is stubbed. */
export async function exerciseJsonReview(win: BrowserWindow, dir: string, timeoutMs: number) {
  const cases: Array<{ id: string; title: string; status: 'passed'; durationMs: number }> = [];
  const target = path.join(dir, 'Map001.json');
  const second = path.join(dir, 'Map002.json');
  const originalBytes = fs.readFileSync(target, 'utf8');
  const secondBytes = fs.readFileSync(second, 'utf8');
  const source = JSON.parse(fs.readFileSync(path.join(dir, 'Backup', 'Map001.json'), 'utf8'));
  const translated = JSON.parse(originalBytes);
  const expected = structuredClone(translated);
  expected.events[1].pages[0].list[0].parameters[0] = source.events[1].pages[0].list[0].parameters[0];
  const root = '[data-harness-view="json-verify"]';
  const read = () => JSON.parse(fs.readFileSync(target, 'utf8'));
  const run = (script: string) => win.webContents.executeJavaScript(script, true);
  async function wait(script: string) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await run(script)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`JSON review condition timed out: ${script}`);
  }
  async function button(text: string) {
    await run(`(() => {
      const button = [...document.querySelectorAll('${root} button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
      if (!button || button.disabled) throw new Error('Missing or disabled JSON review button: ' + ${JSON.stringify(text)});
      button.click();
    })()`);
  }
  async function reload(bytes: string, count: number) {
    fs.writeFileSync(target, bytes);
    await button('다시 검사');
    await wait(`document.querySelector('${root}')?.getAttribute('data-total-issues') === '${count}' && !document.querySelector('${root} .no-issues-filter')?.textContent.includes('검사하고')`);
  }
  async function status(text: string) {
    await wait(`document.querySelector('${root} .status')?.textContent.includes(${JSON.stringify(text)})`);
  }
  async function record(id: string, title: string, action: () => Promise<void>) {
    const started = Date.now();
    await action();
    cases.push({ id, title, status: 'passed', durationMs: Date.now() - started });
  }

  const llmListeners = ipcMain.listeners('verifyLlmRepair');
  ipcMain.removeAllListeners('verifyLlmRepair');
  ipcMain.on('verifyLlmRepair', (event, request: { requestId: string; items: Array<{ path: string; origText: string }> }) => {
    event.sender.send('verifyLlmRepairDone', {
      requestId: request.requestId, success: true,
      results: request.items.map(item => ({ ...item, newText: item.origText })),
    });
  });
  try {
    await record('json-selected-revert', 'Selected revert restores the marker and preserves adjacent translated dialogue', async () => {
      await run(`document.querySelector('${root} .issue-checkbox input').click()`);
      await button('선택 되돌리기');
      await status('되돌리기 완료');
      assert.deepEqual(read(), expected);
      assert.equal(fs.readFileSync(second, 'utf8'), secondBytes);
    });

    const broken = structuredClone(expected);
    broken.events[1].pages[0].list[1].indent = 7;
    await record('json-current-repair', 'Current-file repair corrects structure without replacing translated text', async () => {
      await reload(JSON.stringify(broken), 1);
      await run(`document.querySelector('${root} .batch-actions').open = true`);
      await button('현재 파일 수정');
      await status('수정 완료');
      assert.deepEqual(read(), expected);
      assert.equal(fs.readFileSync(second, 'utf8'), secondBytes);
    });

    await record('json-all-repair', 'All-file repair fixes both affected files and preserves translations', async () => {
      const secondBroken = JSON.parse(secondBytes);
      secondBroken.unexpectedKey = 1;
      fs.writeFileSync(second, JSON.stringify(secondBroken));
      await reload(JSON.stringify(broken), 2);
      await button('전체 수정');
      await status('2개 파일');
      assert.deepEqual(read(), expected);
      assert.deepEqual(JSON.parse(fs.readFileSync(second, 'utf8')), JSON.parse(secondBytes));
    });

    await record('json-all-partial-failure', 'All-file repair reports an invalid file without hiding a successful repair', async () => {
      const invalidBytes = '{ invalid JSON\n';
      fs.writeFileSync(second, invalidBytes);
      await reload(JSON.stringify(broken), 2);
      await button('전체 수정');
      await status('1개 수정, 1개 실패');
      assert.deepEqual(read(), expected);
      assert.equal(fs.readFileSync(second, 'utf8'), invalidBytes);
      fs.writeFileSync(second, secondBytes);
    });

    async function preview() {
      await reload(originalBytes, 1);
      win.webContents.send('verifySettings', { llmReady: true, llmProvider: 'gemini', JsonChangeLine: false });
      await wait(`!document.querySelector('[data-harness-shift-repair]')?.disabled`);
      await run(`document.querySelector('[data-harness-shift-repair]').click()`);
      await wait(`!!document.querySelector('${root} .llm-preview')`);
      assert.equal(fs.readFileSync(target, 'utf8'), originalBytes, 'Preview must not write the file');
    }
    await record('json-preview-cancel', 'LLM preview and cancellation leave exact disk bytes unchanged', async () => {
      await preview();
      await button('취소');
      await wait(`!document.querySelector('${root} .llm-preview')`);
      assert.equal(fs.readFileSync(target, 'utf8'), originalBytes);
    });
    await record('json-preview-apply', 'LLM preview applies through the real atomic IPC write path', async () => {
      await preview();
      await button('전체 적용');
      await status('1건 적용 완료');
      assert.deepEqual(read(), expected);
    });
    await record('json-preview-external-edit', 'External edits after preview are preserved and application is rejected', async () => {
      await preview();
      const external = structuredClone(translated);
      external.events[1].pages[0].list[1].parameters[0] = '외부 편집 내용';
      const externalBytes = JSON.stringify(external, null, 2) + '\n';
      fs.writeFileSync(target, externalBytes);
      await button('전체 적용');
      await status('요청 이후 대상 파일이 변경');
      assert.equal(fs.readFileSync(target, 'utf8'), externalBytes);
      assert.equal(await run(`!!document.querySelector('${root} .llm-preview')`), true);
      await button('취소');
    });
    await record('json-atomic-write-race', 'Main rejects a file changed after renderer validation and preserves external bytes', async () => {
      await preview();
      const externalBytes = JSON.stringify(translated, null, 4) + '\n';
      let intercepted = false;
      const changeBeforeWrite = () => { intercepted = true; fs.writeFileSync(target, externalBytes); };
      ipcMain.prependOnceListener('verifyApplyJson', changeBeforeWrite);
      try {
        await button('전체 적용');
        await status('요청 후 대상 파일이 변경');
        assert.equal(intercepted, true);
        assert.equal(fs.readFileSync(target, 'utf8'), externalBytes);
        assert.equal(await run(`!!document.querySelector('${root} .llm-preview')`), true);
        await button('취소');
      } finally {
        ipcMain.removeListener('verifyApplyJson', changeBeforeWrite);
      }
    });
    return cases;
  } finally {
    ipcMain.removeAllListeners('verifyLlmRepair');
    for (const listener of llmListeners) ipcMain.on('verifyLlmRepair', listener as (...args: any[]) => void);
    fs.writeFileSync(target, originalBytes);
    fs.writeFileSync(second, secondBytes);
  }
}
