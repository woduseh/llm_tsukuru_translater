type ErrorRecord = Record<string, unknown>;

function asRecord(value: unknown): ErrorRecord | undefined {
  return value !== null && typeof value === 'object' ? value as ErrorRecord : undefined;
}

function validDelay(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function validStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value : undefined;
}

export function getProviderErrorStatus(error: unknown): number | undefined {
  const source = asRecord(error);
  return validStatus(source?.status) ?? validStatus(asRecord(source?.response)?.status);
}

// Restrict Date.parse to HTTP-date shapes; it otherwise accepts values such as
// "-1" and "1.5" as calendar dates. Include the two legacy HTTP-date formats.
const HTTP_DATE = /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;

function parseRetryAfter(value: unknown, now: number): number | undefined {
  if (typeof value === 'number') {
    const seconds = validDelay(value);
    return seconds === undefined ? undefined : validDelay(seconds * 1000);
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return validDelay(Number(text) * 1000);
  if (!HTTP_DATE.test(text) || !Number.isFinite(now)) return undefined;
  // The legacy asctime form omits its zone; HTTP still defines it as GMT.
  const timestamp = Date.parse(text.endsWith(' GMT') ? text : `${text} GMT`);
  return Number.isFinite(timestamp) ? validDelay(Math.max(0, timestamp - now)) : undefined;
}

function parseRetryDelay(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,9})?s$/.test(value)) return undefined;
  return validDelay(Number(value.slice(0, -1)) * 1000);
}

/** Read server retry hints without retaining any provider request or response data. */
export function getRetryAfterMs(error: unknown, now = Date.now()): number | undefined {
  const source = asRecord(error);
  const response = asRecord(source?.response);
  let delay = validDelay(source?.retryAfterMs);
  const include = (candidate: number | undefined) => {
    if (candidate !== undefined) delay = delay === undefined ? candidate : Math.max(delay, candidate);
  };

  const headers = asRecord(response?.headers);
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() !== 'retry-after') continue;
      const value = headers[key];
      for (const header of Array.isArray(value) ? value : [value]) {
        include(parseRetryAfter(header, now));
      }
    }
  }

  const details = asRecord(asRecord(response?.data)?.error)?.details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      const info = asRecord(detail);
      if (info?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
        || info?.['@type'] === 'google.rpc.RetryInfo') {
        include(parseRetryDelay(info.retryDelay));
      }
    }
  }
  return delay;
}

/** Add only safe scalar metadata to an already sanitized error. */
export function copyRetryMetadata(source: unknown, target: Error): Error {
  const status = getProviderErrorStatus(source);
  const retryAfterMs = getRetryAfterMs(source);
  const safeTarget = target as Error & { status?: number; retryAfterMs?: number };
  if (status !== undefined) safeTarget.status = status;
  if (retryAfterMs !== undefined) safeTarget.retryAfterMs = retryAfterMs;
  return target;
}
