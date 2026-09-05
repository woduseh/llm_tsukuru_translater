import { describe, expect, it } from 'vitest';
import { copyRetryMetadata, getProviderErrorStatus, getRetryAfterMs } from '../../src/ts/libs/providerRetry';

const NOW = Date.UTC(1994, 10, 6, 8, 49, 0);

function retryInfo(retryDelay: unknown, type = 'type.googleapis.com/google.rpc.RetryInfo') {
  return { '@type': type, retryDelay };
}

describe('provider retry metadata', () => {
  it.each([
    ['retry-after', '2', 2000],
    ['Retry-After', 3, 3000],
    ['RETRY-AFTER', ' 1.5 ', 1500],
    ['rEtRy-AfTeR', '0', 0],
    ['retry-after', 0, 0],
    ['retry-after', '86400', 86_400_000],
  ])('reads %s: %s as seconds without shortening long server delays', (header, value, expected) => {
    expect(getRetryAfterMs({ response: { headers: { [header]: value } } }, NOW)).toBe(expected);
  });

  it.each([
    'Sun, 06 Nov 1994 08:49:37 GMT',
    'Sunday, 06-Nov-94 08:49:37 GMT',
    'Sun Nov  6 08:49:37 1994',
  ])('accepts HTTP-date %s relative to the supplied clock', (value) => {
    expect(getRetryAfterMs({ response: { headers: { 'Retry-After': value } } }, NOW)).toBe(37_000);
  });

  it('treats an already elapsed HTTP-date as zero delay', () => {
    expect(getRetryAfterMs({ response: {
      headers: { 'Retry-After': 'Sun, 06 Nov 1994 08:48:00 GMT' },
    } }, NOW)).toBe(0);
  });

  it.each([
    ['0s', 0],
    ['1.5s', 1500],
    ['0.000001s', 0.001],
    ['86400s', 86_400_000],
  ])('reads a Google RetryInfo duration of %s', (duration, expected) => {
    expect(getRetryAfterMs({ response: { data: { error: { details: [retryInfo(duration)] } } } }, NOW))
      .toBe(expected);
  });

  it('also accepts the unprefixed google.rpc.RetryInfo type', () => {
    expect(getRetryAfterMs({ response: { data: { error: {
      details: [retryInfo('1.5s', 'google.rpc.RetryInfo')],
    } } } }, NOW)).toBe(1500);
  });

  it.each([
    { normalized: 8000, header: '2', google: '1.5s', expected: 8000 },
    { normalized: 1000, header: '5', google: '1.5s', expected: 5000 },
    { normalized: 1000, header: '2', google: '6s', expected: 6000 },
  ])('honors the longest available server delay: $expected ms', ({ normalized, header, google, expected }) => {
    expect(getRetryAfterMs({
      retryAfterMs: normalized,
      response: {
        headers: { 'Retry-After': header },
        data: { error: { details: [retryInfo('0.5s'), retryInfo(google)] } },
      },
    }, NOW)).toBe(expected);
  });

  it('checks every Retry-After casing and repeated header value', () => {
    expect(getRetryAfterMs({ response: { headers: {
      'retry-after': '3',
      'Retry-After': ['6', '2', 'invalid'],
      'RETRY-AFTER': '4',
    } } }, NOW)).toBe(6000);
  });

  it.each([null, undefined, false, {}, [], -1, NaN, Infinity, '', ' ', '-1', '+2', '1e3', 'Infinity', '1ms', '2026-09-05', 'not a date'])
    ('ignores invalid Retry-After value %s without discarding another valid hint', (value) => {
      expect(getRetryAfterMs({ retryAfterMs: 700, response: { headers: { 'Retry-After': value } } }, NOW)).toBe(700);
    });

  it.each([-1, NaN, Infinity, '1000', null, false, {}])('ignores invalid normalized milliseconds %s', (value) => {
    expect(getRetryAfterMs({ retryAfterMs: value }, NOW)).toBeUndefined();
  });

  it.each(['-1s', 'Infinitys', '1e3s', '1.5', '1ms', '1.s', ' 1s ', null, 1.5])
    ('ignores invalid Google RetryInfo duration %s', (value) => {
      expect(getRetryAfterMs({ response: { data: { error: { details: [retryInfo(value)] } } } }, NOW))
        .toBeUndefined();
    });

  it('ignores retryDelay outside a Google RetryInfo detail', () => {
    expect(getRetryAfterMs({ response: { data: { error: { details: [
      retryInfo('12s', 'type.googleapis.com/google.rpc.ErrorInfo'),
      { retryDelay: '10s' },
      null,
      retryInfo('2s'),
    ] } } } }, NOW)).toBe(2000);
  });

  it('rejects millisecond overflow and malformed response nesting', () => {
    const overflowingSeconds = `1${'0'.repeat(306)}`;
    expect(getRetryAfterMs({ response: {
      headers: { 'retry-after': overflowingSeconds },
      data: { error: { details: [retryInfo(`${overflowingSeconds}s`)] } },
    } }, NOW)).toBeUndefined();
    for (const error of [undefined, null, 'failure', 503, {}, { response: null }, { response: { data: { error: { details: {} } } } }]) {
      expect(getRetryAfterMs(error, NOW)).toBeUndefined();
    }
    expect(getRetryAfterMs({ retryAfterMs: Number.MAX_VALUE }, NOW)).toBe(Number.MAX_VALUE);
  });

  it('ignores HTTP-date when the supplied clock is invalid but keeps duration hints', () => {
    const response = { headers: { 'Retry-After': 'Sun, 06 Nov 1994 08:49:37 GMT' } };
    expect(getRetryAfterMs({ response }, NaN)).toBeUndefined();
    expect(getRetryAfterMs({ response, retryAfterMs: 1000 }, Infinity)).toBe(1000);
  });

  it('uses a valid normalized HTTP status before the Axios response status', () => {
    expect(getProviderErrorStatus({ status: 429, response: { status: 503 } })).toBe(429);
    expect(getProviderErrorStatus({ response: { status: 503 } })).toBe(503);
    for (const status of [NaN, Infinity, -1, 0, 99, 600, 429.5, '429']) {
      expect(getProviderErrorStatus({ status, response: { status: 503 } })).toBe(503);
      expect(getProviderErrorStatus({ status })).toBeUndefined();
    }
    expect(getProviderErrorStatus(null)).toBeUndefined();
  });

  it('copies only numeric retry metadata onto the sanitized error without provider secrets or references', () => {
    const secret = 'provider-secret-value';
    const source = Object.assign(new Error(`unsafe ${secret}`), {
      status: 429,
      retryAfterMs: 1000,
      code: 'ERR_BAD_REQUEST',
      config: { headers: { Authorization: `Bearer ${secret}` }, data: secret },
      request: { body: secret },
      cause: new Error(secret),
      response: {
        status: 503,
        headers: { 'Retry-After': '3', authorization: secret },
        data: { error: { message: secret, details: [retryInfo('4s')] } },
      },
    });
    const target = new Error('Sanitized provider failure');
    const originalStack = target.stack;
    const originalProperties = Object.getOwnPropertyNames(target);

    expect(copyRetryMetadata(source, target)).toBe(target);

    expect(target).toMatchObject({ status: 429, retryAfterMs: 4000 });
    expect(target.message).toBe('Sanitized provider failure');
    expect(target.stack).toBe(originalStack);
    expect(Object.getOwnPropertyNames(target).sort()).toEqual([...originalProperties, 'status', 'retryAfterMs'].sort());
    expect(JSON.stringify(target)).not.toContain(secret);
    for (const property of ['response', 'config', 'request', 'cause', 'code']) {
      expect(target).not.toHaveProperty(property);
    }
    expect(source.config.headers.Authorization).toBe(`Bearer ${secret}`);
    expect(getRetryAfterMs(target, NOW)).toBe(4000);
    expect(getProviderErrorStatus(target)).toBe(429);
  });

  it('leaves a sanitized target unchanged when no valid numeric metadata exists', () => {
    const target = new Error('Sanitized failure');
    const originalProperties = Object.getOwnPropertyNames(target);

    expect(copyRetryMetadata({ status: '429', retryAfterMs: -1, response: { headers: { 'Retry-After': 'bad' } } }, target))
      .toBe(target);

    expect(Object.getOwnPropertyNames(target)).toEqual(originalProperties);
  });
});
