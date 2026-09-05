const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runner = require('../../scripts/verify.cjs');

const scratch = path.resolve(__dirname, '../../artifacts/unit/verification-evidence');
const roots = [];
function tempRoot() {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'run-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(scratch));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preparation denial replaces a previous successful latest report, while --plan remains read-only', async () => {
  const root = tempRoot();
  const latest = path.join(root, 'artifacts/verify/latest.json');
  fs.mkdirSync(path.dirname(latest), { recursive: true });
  fs.writeFileSync(latest, JSON.stringify({ id: 'old-success', status: 'passed' }));
  const dependencies = { root, changedFiles: () => { throw Object.assign(new Error('intentional pipe denial'), { code: 'EPERM' }); } };
  const failed = await runner.main([], dependencies);
  const report = JSON.parse(fs.readFileSync(latest, 'utf8'));
  assert.equal(failed.exitCode, 1);
  assert.equal(report.status, 'failed');
  assert.equal(report.error.code, 'EPERM');
  assert.equal(report.error.phase, 'git-changes');
  assert.deepEqual(report.checks, []);
  assert.notEqual(report.id, 'old-success');
  const before = fs.readFileSync(latest, 'utf8');
  await assert.rejects(runner.main(['--plan'], dependencies), { code: 'EPERM' });
  assert.equal(fs.readFileSync(latest, 'utf8'), before);
});

test('the real command adapter retains nonzero exit and diagnostic log content', async () => {
  const root = tempRoot();
  const logPath = path.join(root, 'failure.log');
  const result = await runner.executeCheck({ command: process.execPath, args: ['-e', 'console.error("intentional-failure-marker"); process.exit(23)'] }, {
    root, logPath, env: process.env,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 23);
  assert.match(fs.readFileSync(logPath, 'utf8'), /intentional-failure-marker/);
});

for (const statuses of [['skipped'], ['passed', 'skipped'], []]) {
  test(`core cannot pass on exit zero with cases ${JSON.stringify(statuses)}`, async () => {
    const report = await runner.runPlan({ mode: 'changed', files: [], reasons: [], checks: ['core'] }, {
      root: tempRoot(), fingerprint: () => 'fixture-source',
      definitions: { core: { command: process.execPath, args: [], harness: true } },
      execute: async check => {
        fs.writeFileSync(check.args.at(-1), JSON.stringify({
          schemaVersion: 1, suite: 'harness-core', status: 'passed',
          cases: statuses.map((status, id) => ({ id: String(id), status })),
        }));
        return { status: 'passed', exitCode: 0 };
      },
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.checks[0].status, 'failed');
  });
}

test('an initial fingerprint failure is a recorded failed run with no passed checks', async () => {
  const report = await runner.runPlan({ mode: 'changed', files: [], reasons: [], checks: ['unit'] }, {
    root: tempRoot(), fingerprint: () => { throw Object.assign(new Error('intentional read failure'), { code: 'EACCES' }); },
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.error.code, 'EACCES');
  assert.deepEqual(report.checks, []);
});
