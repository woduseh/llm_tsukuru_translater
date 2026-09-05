import type { RegisteredMcpTool } from './readonlyTools';
import type { JsonObject } from '../types/agentWorkspace';
import { TranslationReadService } from '../agent/translationReadService';
import type { TranslationPatchOperation } from '../types/agentWorkspace';

const text = (description: string, maxLength = 1024): JsonObject => ({ type: 'string', minLength: 1, maxLength, description });
const integer = (description: string, minimum: number, maximum: number, defaultValue: number): JsonObject => ({ type: 'integer', minimum, maximum, default: defaultValue, description });
const object = (properties: JsonObject, required: string[] = []): JsonObject => ({ type: 'object', properties, required, additionalProperties: false });
const targetPath = text('Translation .txt path relative to the selected game project. Use project.translation_inventory to discover paths.');
const sourcePath = text('Original extracted .txt path relative to the same project. Do not guess source/translation pairings.');
const count = integer('Number of complete lines to return. Reduce for long lines.', 1, 200, 40);
const startLine = integer('One-based physical line number, including separators and empty lines.', 1, 10000000, 1);
const inspection = {
  sourcePath, targetPath,
  metadataPath: text('Optional extraction metadata path; metadata availability does not prove semantic alignment.'),
  maxBytes: integer('Maximum bytes inspected per file. A partial read is never verified.', 1, 8 * 1024 * 1024, 256 * 1024),
};

/** Public task-oriented MCP surface. Internal analysis scaffolds are deliberately not exposed. */
export function curateAgentTools(all: RegisteredMcpTool[]): RegisteredMcpTool[] {
  const selected = new Map(all.filter(({ definition }) => [
    'project.context_snapshot', 'project.translation_inventory', 'project.get_quality_rules', 'provider.list',
    'alignment.inspect', 'qa.score_file', 'patch.propose', 'patch.validate', 'artifacts.read_ref',
    'glossary.search', 'memory.search', 'help.translation_workflow', 'help.explain_tool', 'help.safe_recipe',
  ].includes(definition.name)).map((tool) => [tool.definition.name, tool]));
  const replace = (name: string, schema: JsonObject, description: string, handler?: RegisteredMcpTool['handler']) => {
    const tool = selected.get(name)!;
    selected.set(name, { definition: { ...tool.definition, inputSchema: schema, description }, handler: handler ?? tool.handler });
  };
  replace('project.translation_inventory', object({ maxFiles: integer('Maximum scanned files; inspect warnings for incomplete inventory.', 1, 2000, 500) }),
    'Discover game data, extracted originals and translations by path. File names do not establish source/target pairing. Limited scans report warnings.');
  replace('alignment.inspect', object(inspection, ['sourcePath', 'targetPath']),
    'Inspect structural alignment of an original/translation pair. Returns coverage, score, top breaks and a paginated artifact ref; never assesses meaning. Partial coverage cannot establish correctness.',
    (args, { service }) => {
      const result = service.alignment.inspect(args as unknown as Parameters<typeof service.alignment.inspect>[0]);
      const { refs, breaks, ...summary } = result;
      return json({ ...summary, breaks: breaks.slice(0, 20), breakCount: breaks.length, refCount: refs.length,
        details: { tool: 'artifacts.read_ref', refId: result.alignmentRef?.refId, collection: 'breaks' } });
    });
  replace('qa.score_file', object(inspection, ['sourcePath', 'targetPath']),
    'Inspect one original/translation pair for deterministic structural and heuristic issues. Returns a structural gate, coverage and top findings, not a semantic translation rating. Read affected lines with translation.read_window.',
    (args, { service }) => {
      const result = service.qa.scoreFile(args as unknown as Parameters<typeof service.qa.scoreFile>[0]);
      const gate = service.qa.thresholdGate({ score: result });
      const { findings, qualityScore, nextSuggestedCalls: _next, ...summary } = result;
      void _next;
      return json({ ...summary, structuralScore: qualityScore, gate: gate.gate,
        semanticQuality: 'not-evaluated', findings: findings.slice(0, 20), findingCount: findings.length,
        nextSuggestedCalls: findings.length ? ['translation.read_window', 'patch.propose'] : [],
        details: { tool: 'artifacts.read_ref', refId: result.qaRef?.refId, collection: 'findings' } });
    });
  replace('patch.propose', object({ targetPath,
    operations: { type: 'array', minItems: 1, maxItems: 100, description: 'Same-line replacements only. Read current text first. Original text is a concurrency precondition.',
      items: object({ lineNumber: { ...startLine, description: 'One-based target line to replace.' },
        originalText: { type: 'string', maxLength: 8192, description: 'Exact current complete line from translation.read_window; never use redacted or clipped text.' },
        replacementText: { type: 'string', maxLength: 8192, description: 'Complete replacement line without newline. Preserve empty-line state, separator and ordered control codes.' } },
      ['lineNumber', 'originalText', 'replacementText']) },
  }, ['targetPath', 'operations']),
  'Prepare and validate up to 100 same-line replacements in one UTF-8 .txt file (256 KiB maximum). Returns patch plus before/after preview. Does not submit or apply. Re-read and regenerate if original text changed.',
  (args, { service }) => {
    const operations = (args.operations as JsonObject[]).map((op, i) => ({ ...op, opId: `op-${i + 1}`, kind: 'replace-line', targetPath: args.targetPath })) as unknown as TranslationPatchOperation[];
    const proposal = service.patch.propose({ targetPath: args.targetPath as string, operations });
    return json({ ...proposal, preview: service.patch.preview(proposal.patch), nextTool: proposal.validation.valid ? 'patch.apply (app bridge only)' : 'translation.read_window' });
  });
  replace('artifacts.read_ref', object({ refId: text('Artifact refId returned by this project.'),
    collection: { type: 'string', enum: ['summary', 'refs', 'breaks', 'findings', 'operations'], default: 'summary', description: 'Collection to page. summary omits array contents.' },
    offset: integer('Zero-based offset into the selected collection.', 0, 10000000, 0),
    limit: integer('Maximum items. The byte budget may return fewer; follow nextOffset.', 1, 100, 20),
  }, ['refId']), 'Read a saved analysis result by reference. Returns valid JSON pages, never a truncated JSON string. Reuse references rather than rerunning inspection.',
  (args, { service }) => service.dataRefs.readPage(args.refId as string, { collection: args.collection as string | undefined, offset: args.offset as number | undefined, limit: args.limit as number | undefined }));

  for (const name of ['glossary.search', 'memory.search']) {
    const tool = selected.get(name)!;
    const properties = { ...(tool.definition.inputSchema.properties as JsonObject), limit: integer('Maximum results.', 1, 50, 20) };
    replace(name, object(properties), tool.definition.description);
  }
  const registerRead = (name: string, description: string, schema: JsonObject, handler: RegisteredMcpTool['handler']) => selected.set(name, {
    definition: { name, title: name, description, permissionTier: 'readonly', inputSchema: schema }, handler,
  });
  registerRead('translation.read_window',
    'Read complete numbered translation lines and optional original lines at the same positions, including empty lines and control codes. Returns file hashes and redaction status. Position pairing is not proof of alignment. Read this before editing or judging meaning.',
    object({ targetPath, sourcePath, startLine, count }, ['targetPath']),
    (args, { service }) => new TranslationReadService({ projectRoot: service.descriptor.projectRoot }).readWindow(args as unknown as Parameters<TranslationReadService['readWindow']>[0]));
  registerRead('translation.search',
    'Find literal text in known project text files. Returns bounded matches and continuation arguments. Use inventory to choose paths; use read_window for complete context.',
    object({ paths: { type: 'array', minItems: 1, maxItems: 20, items: targetPath }, query: text('Literal text to find, not a regular expression.', 500), startLine,
      limit: integer('Maximum matches per response.', 1, 100, 20) }, ['paths', 'query']),
    (args, { service }) => new TranslationReadService({ projectRoot: service.descriptor.projectRoot }).search(args as unknown as Parameters<TranslationReadService['search']>[0]));
  return [...selected.values()];
}

function json(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
