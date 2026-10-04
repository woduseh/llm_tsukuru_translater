import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

it('allows only the approval runtime to import the patch executor in production code', async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const source = "import { createMutationPatchExecutor } from '../agent/mutationPatchExecutor';\nvoid createMutationPatchExecutor;";
  const [caller] = await eslint.lintText(source, { filePath: 'src/ipc/unapprovedPatch.ts' });
  const [owner] = await eslint.lintText(source, { filePath: 'src/agent/mutationApprovalRuntime.ts' });
  expect(caller.messages).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 })]));
  expect(owner.messages.some(message => message.ruleId === 'no-restricted-imports')).toBe(false);
}, 20_000);
