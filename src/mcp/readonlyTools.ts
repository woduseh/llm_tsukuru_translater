import { createAgentToolDefinitions } from './agentTools';
export { PATCH_VALIDATE_INPUT_SCHEMA } from './agentTools';
import type { AgentService } from '../agent/agentService';
import { redactSecretLikeValues } from '../agent/contractsValidation';
import type {
  AgentResultEnvelope,
  AuditEntry,
  JsonObject,
  McpToolDefinition,
  PermissionTier,
} from '../types/agentWorkspace';

export type McpToolHandler = (args: JsonObject, context: McpToolContext) => JsonObject;

export interface McpToolContext {
  requestId: string;
  service: AgentService;
  toolDefinitions: McpToolDefinition[];
}

export interface RegisteredMcpTool {
  definition: McpToolDefinition;
  handler: McpToolHandler;
}

export class McpToolRegistry {
  private readonly tools = new Map<string, RegisteredMcpTool>();

  constructor(
    private readonly service: AgentService,
    private readonly options: {
      allowedTiers?: readonly PermissionTier[];
    } = {},
  ) {}

  register(definition: McpToolDefinition, handler: McpToolHandler): void {
    if (this.options.allowedTiers && !this.options.allowedTiers.includes(definition.permissionTier)) {
      throw new Error(`MCP registry cannot register ${definition.name} with ${definition.permissionTier}`);
    }
    this.tools.set(definition.name, { definition, handler });
  }

  listTools(): McpToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => tool.definition);
  }

  callTool(name: string, args: JsonObject = {}, requestId = createRequestId(name)): AgentResultEnvelope {
    const tool = this.tools.get(name);
    if (!tool) return failureEnvelope(requestId, name, 'readonly', `Unknown MCP tool: ${name}`);
    const argumentErrors = validateToolArguments(args, tool.definition.inputSchema);
    if (argumentErrors.length > 0) {
      return failureEnvelope(
        requestId,
        name,
        tool.definition.permissionTier,
        `Invalid arguments for ${name}: ${argumentErrors.join('; ')}`,
      );
    }
    try {
      const payload = tool.handler(args, {
        requestId,
        service: this.service,
        toolDefinitions: this.listTools(),
      });
      return okEnvelope(requestId, name, tool.definition.permissionTier, payload);
    } catch (error) {
      return failureEnvelope(
        requestId,
        name,
        tool.definition.permissionTier,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

export function createMcpOfflineToolRegistry(service: AgentService): McpToolRegistry {
  const registry = new McpToolRegistry(service, { allowedTiers: ['readonly', 'workspace-write'] });
  for (const tool of createAgentToolDefinitions()) registry.register(tool.definition, tool.handler);
  return registry;
}

export function createMcpReadonlyToolRegistry(service: AgentService): McpToolRegistry {
  const registry = new McpToolRegistry(service, { allowedTiers: ['readonly'] });
  for (const tool of createAgentToolDefinitions()) {
    if (tool.definition.permissionTier === 'readonly') registry.register(tool.definition, tool.handler);
  }
  return registry;
}

function okEnvelope(
  requestId: string,
  toolName: string,
  permissionTier: PermissionTier,
  payload: JsonObject,
): AgentResultEnvelope {
  const redacted = redactSecretLikeValues(payload);
  const envelope: AgentResultEnvelope = {
    schemaVersion: 1,
    requestId,
    toolName,
    status: 'ok',
    permissionTier,
    payload: redacted.value,
    audit: [auditEntry(requestId, toolName, permissionTier, 'tool-call', `call ${toolName}`)],
    redactions: redacted.redactions,
  };
  if (typeof redacted.value.qualityScore === 'number') envelope.qualityScore = redacted.value.qualityScore;
  if (Array.isArray(redacted.value.nextSuggestedCalls))
    envelope.nextSuggestedCalls = redacted.value.nextSuggestedCalls.filter(
      (value): value is string => typeof value === 'string',
    );
  return envelope;
}

function failureEnvelope(
  requestId: string,
  toolName: string,
  permissionTier: PermissionTier,
  message: string,
): AgentResultEnvelope {
  const redacted = redactSecretLikeValues({ message });
  return {
    schemaVersion: 1,
    requestId,
    toolName,
    status: 'failed',
    permissionTier,
    failure: {
      schemaVersion: 1,
      failureId: `failure-${requestId}`,
      requestId,
      stage: 'mcp-tool',
      message: String(redacted.value.message),
      retryable: false,
      createdAt: new Date().toISOString(),
    },
    audit: [auditEntry(requestId, toolName, permissionTier, 'failure', String(redacted.value.message))],
    redactions: redacted.redactions,
  };
}

function auditEntry(
  requestId: string,
  toolName: string,
  permissionTier: PermissionTier,
  kind: 'tool-call' | 'failure',
  action: string,
): AuditEntry {
  return {
    schemaVersion: 1,
    auditId: `audit-${requestId}`,
    timestamp: new Date().toISOString(),
    kind,
    actor: 'mcp',
    action,
    permissionTier,
    requestId,
    metadata: { toolName },
  };
}

export function validateToolArguments(args: JsonObject, schema: JsonObject): string[] {
  return validateSchemaValue(args, schema, 'arguments');
}

function validateSchemaValue(value: unknown, schema: JsonObject, label: string): string[] {
  const errors: string[] = [];
  const expectedType = typeof schema.type === 'string' ? schema.type : undefined;
  if (expectedType && !matchesSchemaType(value, expectedType)) {
    return [`${label} must be ${articleFor(expectedType)} ${expectedType}`];
  }

  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      errors.push(`${label} must be >= ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      errors.push(`${label} must be <= ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${label} is too short`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${label} is too long`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value))
      errors.push(`${label} has an invalid format`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems)
      errors.push(`${label} has too few items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
      errors.push(`${label} has too many items`);
  }
  if (enumValues && !enumValues.some((candidate) => Object.is(candidate, value))) {
    errors.push(`${label} must be one of ${enumValues.map((candidate) => JSON.stringify(candidate)).join(', ')}`);
    return errors;
  }

  if (expectedType === 'object' && isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === 'string')
      : [];
    for (const propertyName of required) {
      if (!Object.prototype.hasOwnProperty.call(value, propertyName) || value[propertyName] === undefined) {
        errors.push(`${label} is missing required property ${JSON.stringify(propertyName)}`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const propertyName of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, propertyName)) {
          errors.push(`${label} has unknown property ${JSON.stringify(propertyName)}`);
        }
      }
    }
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, propertyName) || value[propertyName] === undefined) continue;
      if (!isPlainObject(propertySchema)) continue;
      errors.push(...validateSchemaValue(value[propertyName], propertySchema, `${label}.${propertyName}`));
    }
  }

  if (expectedType === 'array' && Array.isArray(value) && isPlainObject(schema.items)) {
    value.forEach((entry, index) => {
      errors.push(...validateSchemaValue(entry, schema.items as JsonObject, `${label}[${index}]`));
    });
  }

  return errors;
}

function matchesSchemaType(value: unknown, expectedType: string): boolean {
  if (expectedType === 'object') return isPlainObject(value);
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expectedType === 'integer') return typeof value === 'number' && Number.isSafeInteger(value);
  if (expectedType === 'string') return typeof value === 'string';
  if (expectedType === 'boolean') return typeof value === 'boolean';
  if (expectedType === 'null') return value === null;
  return true;
}

function articleFor(type: string): 'a' | 'an' {
  return type === 'object' || type === 'array' ? 'an' : 'a';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createRequestId(toolName: string): string {
  return `mcp-${Date.now()}-${toolName.replace(/[^a-z0-9_.-]/gi, '-')}`;
}
