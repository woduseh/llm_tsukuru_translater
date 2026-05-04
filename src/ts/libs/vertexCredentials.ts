const VERTEX_REQUIRED_FIELDS = ['client_email', 'private_key', 'project_id'] as const;

export interface VertexServiceAccountJson {
  client_email: string;
  private_key: string;
  project_id: string;
  [key: string]: unknown;
}

function hasConfiguredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseVertexServiceAccountJson(serviceAccountJson: string): VertexServiceAccountJson {
  if (!hasConfiguredText(serviceAccountJson)) {
    throw new Error('Vertex service account JSON is required.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serviceAccountJson.trim());
  } catch {
    throw new Error('Vertex service account JSON could not be parsed.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Vertex service account JSON must be an object.');
  }

  const credentials = parsed as Record<string, unknown>;
  for (const field of VERTEX_REQUIRED_FIELDS) {
    if (!hasConfiguredText(credentials[field])) {
      throw new Error(`Vertex service account JSON is missing ${field}.`);
    }
  }

  return credentials as VertexServiceAccountJson;
}
