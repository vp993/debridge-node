import { DEFAULT_WEB3_TIMEOUT_MS, parsePositiveInt } from '../parsePositiveInt';

describe('parsePositiveInt', () => {
  it.each<[string | undefined, number]>([
    ['30000', 30000],
    ['1', 1],
    ['  42  ', 42],
    [undefined, DEFAULT_WEB3_TIMEOUT_MS],
    ['', DEFAULT_WEB3_TIMEOUT_MS],
    ['   ', DEFAULT_WEB3_TIMEOUT_MS],
    ['abc', DEFAULT_WEB3_TIMEOUT_MS],
    ['10s', 10],
    ['0', DEFAULT_WEB3_TIMEOUT_MS],
    ['-5', DEFAULT_WEB3_TIMEOUT_MS],
    ['NaN', DEFAULT_WEB3_TIMEOUT_MS],
  ])('parses %j as %d', (raw, expected) => {
    expect(parsePositiveInt(raw, DEFAULT_WEB3_TIMEOUT_MS)).toBe(expected);
  });

  it('uses the provided fallback regardless of value', () => {
    expect(parsePositiveInt(undefined, 5000)).toBe(5000);
    expect(parsePositiveInt('', 12345)).toBe(12345);
  });
});
