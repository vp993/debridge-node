import { sanitizeHeaders, sanitizeRequestConfigForLogging } from '../sanitizeHttpLogging';

describe('sanitizeHeaders', () => {
  it('masks the Authorization header regardless of casing', () => {
    expect(sanitizeHeaders({ Authorization: 'Bearer secret-token' })).toEqual({ Authorization: '***' });
    expect(sanitizeHeaders({ authorization: 'Bearer secret-token' })).toEqual({ authorization: '***' });
    expect(sanitizeHeaders({ AUTHORIZATION: 'Bearer secret-token' })).toEqual({ AUTHORIZATION: '***' });
  });

  it('masks other sensitive headers (Cookie, proxy-authorization, x-api-key)', () => {
    expect(
      sanitizeHeaders({
        Cookie: 'session=abc',
        'Proxy-Authorization': 'Basic xyz',
        'X-Api-Key': 'sk_live_abc',
      }),
    ).toEqual({
      Cookie: '***',
      'Proxy-Authorization': '***',
      'X-Api-Key': '***',
    });
  });

  it('leaves non-sensitive headers untouched', () => {
    expect(
      sanitizeHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'axios/1.8.3',
      }),
    ).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'axios/1.8.3',
    });
  });
});

describe('sanitizeRequestConfigForLogging', () => {
  it('masks Authorization inside the headers of an axios-like config', () => {
    const config = {
      url: 'https://validator-api.debridge.finance/Validator/updateProgress',
      method: 'post',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer super-secret-jwt',
      },
      data: { progressInfo: [] },
    };

    const sanitized = sanitizeRequestConfigForLogging(config);

    expect(sanitized.headers.Authorization).toBe('***');
    expect(sanitized.headers.Accept).toBe('application/json');
    expect(sanitized.url).toBe(config.url);
    expect(sanitized.data).toEqual(config.data);
  });

  it('does not mutate the original config', () => {
    const config = {
      headers: { Authorization: 'Bearer secret' },
    };

    sanitizeRequestConfigForLogging(config);

    expect(config.headers.Authorization).toBe('Bearer secret');
  });

  it('returns the value unchanged for primitives and nullish values', () => {
    expect(sanitizeRequestConfigForLogging(null)).toBeNull();
    expect(sanitizeRequestConfigForLogging(undefined)).toBeUndefined();
    expect(sanitizeRequestConfigForLogging('string' as any)).toBe('string');
  });

  it('handles configs that do not have headers', () => {
    const config = { url: 'https://example.com', method: 'get' };
    expect(sanitizeRequestConfigForLogging(config)).toEqual(config);
  });
});
