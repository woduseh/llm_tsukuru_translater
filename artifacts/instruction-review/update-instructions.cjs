const fs = require('node:fs');
const path = require('node:path');
const root = 'C:/Users/wodus/.codex';
const plugin = `${root}/plugins/cache/openai-curated-remote`;
const changes = [];
function edit(file, replacements) {
  const original = fs.readFileSync(file);
  const raw = original.toString('utf8');
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  let next = raw.replace(/\r\n/g, '\n');
  for (const [old, replacement] of replacements) {
    if (next.split(old).length !== 2) throw new Error(`Expected one match: ${file}: ${old}`);
    next = next.replace(old, replacement);
  }
  changes.push({file, before: original.toString('base64'), after: Buffer.from(next.replace(/\n/g, newline)).toString('base64')});
}
edit(path.resolve('AGENTS.md'), [[
  'stop once relevant checks pass unless new evidence warrants more work.',
  'once the requested implementation and deliverables are ready and relevant checks pass, do not broaden or repeat verification without new evidence. Complete remaining authorized work and handoff before ending the task.'
]]);
edit(`${root}/AGENTS.md`, [[
  'Once the relevant checks pass, finish unless new evidence calls for more work.',
  'Once the requested implementation and deliverables are ready and relevant checks pass, do not broaden or repeat verification without new evidence. Complete remaining authorized work and handoff before ending the task.'
]]);
const docsPath = `${root}/skills/.system/openai-docs/SKILL.md`;
const docs = fs.readFileSync(docsPath, 'utf8').replace(/\r\n/g, '\n');
edit(docsPath, [
  [docs.split('\n').find(line => line.startsWith('**First substantive action:**')), '**Source selection:** For local configuration, instruction, skill, or repository reviews and troubleshooting, inspect the relevant local files first. Search official documentation when a material claim depends on current product behavior or the user requests official evidence. For documentation questions, search the exact topic and any explicitly named model with a concise query, using an available direct official documentation search and retrieval capability before general official-domain web search. Open or fetch the relevant page; do not rely on snippets or unopened links. Search another appropriate official source if needed. Preserve the exact requested model. Follow the current runtime\'s source-order requirements when they differ.'],
  [docs.split('\n').find(line => line.startsWith('**Only exception:**')), '**Broad synthesis:** An explicitly requested broad, cross-topic Codex setup, orientation, or system-map synthesis may use the manual first when shell execution and an allowed temporary cache are available. Fetch official sources for unresolved current product claims.'],
  ['Before building, running, editing, debugging, or testing an API-backed app or tool, use `openai-platform-api-key` first when available. Documentation, conceptual examples, model selection, and read-only guidance do not require an API key.', 'Use `openai-platform-api-key` first when available only for a step that requires an actual authenticated API call. Local inspection, editing, builds, and mock tests do not require API-key setup. Preserve authorization requirements for live calls and spending.']
]);
const pwPath = `${root}/skills/playwright/SKILL.md`;
const pw = fs.readFileSync(pwPath, 'utf8').replace(/\r\n/g, '\n');
edit(pwPath, [[pw.slice(pw.indexOf('Before proposing commands,'), pw.indexOf('## Skill path')), 'Check for a usable Node/npm runtime using the current shell (`Get-Command npx` in PowerShell; `command -v npx` in Bash). If `npx` is not on PATH, inspect the configured bundled runtime and existing local CLI before concluding that installation is required. Use a verified existing executable by absolute path when available.\n\nIf no usable runtime or CLI exists, request only the installation needed for the browser step and continue independent authorized work. Preserve installation and browser-choice approval requirements. Global installation of `playwright-cli` is optional, not a required recovery step.\n\nUse the bundled wrapper when a compatible Bash environment and `npx` are available; otherwise use the verified CLI through the current shell. The shell snippets below assume Bash; do not run Bash syntax directly in PowerShell.\n\n']]);
edit(`${root}/skills/.system/imagegen/SKILL.md`, [[
  'Never modify `scripts/image_gen.py`. If something is missing, ask the user before doing anything else.',
  'Never modify `scripts/image_gen.py`. If a missing required input or capability blocks the selected CLI operation, identify the blocker and ask only for the information or authorization needed for that operation. Resolve optional choices from the existing context and continue independent authorized work. Preserve explicit approval requirements for CLI fallback, model changes, and asset replacement.'
]]);
edit(`${plugin}/google-drive/0.1.16/skills/google-docs/SKILL.md`, [
  ['Use `request_user_input` once if available, else ask via a message.', 'When clarification is needed, use `request_user_input` once only if available and permitted for that question; otherwise use an allowed question tool or a concise message.'],
  ['Ask for new documents or major rewrites. Skip this for edits/conversions.', 'For new documents or major rewrites, ask only about consequential missing information that cannot be resolved from context. Do not require an intake question merely because the document is new. Edits and conversions need clarification only when a material ambiguity remains.'],
  ['Questions should cover topic, audience, and purpose and come before planning', 'Ask about topic, audience, or purpose only when an unresolved dimension materially changes the result; continue independent planning and preparation while waiting.'],
  ['If the request times out or returns no answer, proceed using your best judgment; do not ask again.', 'For optional preference questions only, if the request times out or returns no answer, proceed using a reasonable stated default; do not ask again. Silence is not approval or an answer to a required question about the target, essential facts, or authorization. Keep dependent work pending and continue independent authorized work.']
]);
const analyticsPath = `${plugin}/data-analytics/0.2.10-13ceeea1f599/skills/index/SKILL.md`;
const analytics = fs.readFileSync(analyticsPath, 'utf8').replace(/\r\n/g, '\n');
edit(analyticsPath, [
  ['Only a concrete task supplied in the user\'s message or the intake form\'s Other field may trigger installation.', 'Consider installation only for a concrete task supplied in the user\'s message or the intake form\'s Other field, and only when the current runtime\'s installation requirements are met. This requirement also applies to the warehouse exception below.'],
  [analytics.split('\n').find(line => line.startsWith('If required evidence is still missing and a plausible connector lane exists,')), 'If required evidence is still missing, explain the needed data or access path concisely. Use plugin discovery and installation-suggestion tools only when available and permitted by the current runtime, including any requirement for an explicit request for a specific plugin. Do not treat missing evidence alone as authorization to trigger installation suggestions for every plausible candidate. Respect an existing selection or decline, and do not repeat an unanswered installation suggestion. If an authorized suggestion fails, explain the relevant manual setup option and continue to the fallback question below in the same turn.']
]);
edit(`${root}/skills/pdf/SKILL.md`, [[
  'Do not deliver until the latest PNG inspection shows zero visual or formatting defects.',
  'Do not label an artifact final or visually verified until the latest PNG inspection shows zero visual or formatting defects. If rendering is unavailable and user review is necessary, provide the generated file explicitly as a review draft, state which checks remain, and request the required visual review. Resume correction and finalization when that evidence is available.'
]]);
edit(`${plugin}/product-design/0.1.53/skills/ideate/SKILL.md`, [
  ['If a named local path or reference is not visible, stop and ask the user to confirm the path, upload the file, start the local app, or point to the correct workspace.', 'If a named local path or reference is not visible, pause the steps that depend on it and ask the user to confirm the path, upload the file, start the local app, or point to the correct workspace. Continue independent authorized work.'],
  ['If a connector, reference, or file cannot be accessed because of auth, permissions, expired login, missing scope, suspiciously empty results, or unavailable local state, stop.', 'If a connector, reference, or file cannot be accessed because of auth, permissions, expired login, missing scope, suspiciously empty results, or unavailable local state, distinguish required visual sources from optional supporting references and pause the steps that depend on the missing material. Continue independent authorized work.'],
  ['Name the gap clearly and ask whether to troubleshoot access or continue without that source.', 'Name the gap clearly. Ask whether to troubleshoot access or continue without a user-named source before omitting or replacing it. Preserve source-capture requirements for faithful matching; do not treat independent progress as permission to generate without a required source.']
]);
const planPath = path.join(__dirname, 'changes.json');
fs.writeFileSync(planPath, JSON.stringify(changes, null, 2));
for (const c of changes) {
  const before = Buffer.from(c.before, 'base64').toString('utf8').replace(/\r\n/g, '\n').split('\n');
  const after = Buffer.from(c.after, 'base64').toString('utf8').replace(/\r\n/g, '\n').split('\n');
  console.log(c.file);
  for (const line of after) if (!before.includes(line)) console.log(`+ ${line}`);
}
console.log(`Prepared ${changes.length} files; originals preserved in ${planPath}`);
