import { Web3Service, Web3Custom } from './Web3Service';
import { DEFAULT_WEB3_TIMEOUT_MS } from '../../../utils/parsePositiveInt';

/**
 * Tests for the application-level timeout wrapper inside createHttpProvider.
 *
 * We mock Web3Custom.providers.HttpProvider so no real HTTP connection is made.
 * Instead we get a controllable `send` function that lets us simulate:
 *   - fast responses (before timeout)
 *   - hanging RPCs (never respond)
 *   - slow responses (arrive after timeout already fired)
 */

let capturedOriginalSend: (payload: any, cb: (err: any, result?: any) => void) => void;

jest.mock('web3', () => {
  return class MockWeb3 {
    static providers = {
      HttpProvider: class MockHttpProvider {
        send: any;
        constructor(_url: string, _options: any) {
          this.send = (payload: any, callback: any) => {
            capturedOriginalSend(payload, callback);
          };
        }
      },
    };

    constructor(_provider?: any) {}

    eth = {};
  };
});

const makeService = (timeoutMs = 500): Web3Service => {
  const configService = {
    get: (key: string, defaultVal?: string) => {
      if (key === 'WEB3_TIMEOUT') return String(timeoutMs);
      return defaultVal;
    },
  } as any;
  return new Web3Service(configService);
};

const makeServiceWithRawTimeout = (raw: string | undefined): Web3Service => {
  const configService = {
    get: (key: string) => (key === 'WEB3_TIMEOUT' ? raw : undefined),
  } as any;
  return new Web3Service(configService);
};

const getTimeout = (s: Web3Service): number => (s as any).web3Timeout;

describe('createHttpProvider timeout wrapper', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    capturedOriginalSend = () => {};
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('forwards successful response when RPC replies before timeout', () => {
    const service = makeService(5000);
    const provider = (service as any).createHttpProvider('http://localhost', {});

    capturedOriginalSend = (_payload, cb) => {
      cb(null, { jsonrpc: '2.0', result: '0x1' });
    };

    const callback = jest.fn();
    provider.send({ method: 'eth_blockNumber' }, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null, { jsonrpc: '2.0', result: '0x1' });
  });

  it('forwards RPC error when provider returns error before timeout', () => {
    const service = makeService(5000);
    const provider = (service as any).createHttpProvider('http://localhost', {});

    const rpcError = new Error('server error');
    capturedOriginalSend = (_payload, cb) => {
      cb(rpcError);
    };

    const callback = jest.fn();
    provider.send({ method: 'eth_blockNumber' }, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toBe(rpcError);
  });

  it('fires timeout error when RPC never responds', () => {
    const service = makeService(3000);
    const provider = (service as any).createHttpProvider('http://localhost', {});

    capturedOriginalSend = () => {
      // never calls callback — simulates a hanging RPC
    };

    const callback = jest.fn();
    provider.send({ method: 'eth_blockNumber' }, callback);

    expect(callback).not.toHaveBeenCalled();

    jest.advanceTimersByTime(3000);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(callback.mock.calls[0][0].message).toBe('RPC request timeout after 3000ms');
  });

  it('ignores late RPC response that arrives after timeout', () => {
    const service = makeService(1000);
    const provider = (service as any).createHttpProvider('http://localhost', {});

    let lateCb: (err: any, result?: any) => void;
    capturedOriginalSend = (_payload, cb) => {
      lateCb = cb;
    };

    const callback = jest.fn();
    provider.send({ method: 'eth_blockNumber' }, callback);

    jest.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].message).toMatch(/timeout/i);

    lateCb!(null, { jsonrpc: '2.0', result: '0x1' });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not fire timeout after successful response', () => {
    const service = makeService(1000);
    const provider = (service as any).createHttpProvider('http://localhost', {});

    capturedOriginalSend = (_payload, cb) => {
      cb(null, { jsonrpc: '2.0', result: '0x1' });
    };

    const callback = jest.fn();
    provider.send({ method: 'eth_blockNumber' }, callback);

    expect(callback).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2000);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('uses WEB3_TIMEOUT from config', () => {
    const service = makeService(7500);
    const provider = (service as any).createHttpProvider('http://localhost', {});

    capturedOriginalSend = () => {};

    const callback = jest.fn();
    provider.send({ method: 'eth_call' }, callback);

    jest.advanceTimersByTime(7499);
    expect(callback).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].message).toBe('RPC request timeout after 7500ms');
  });
});

/**
 * Regression for the WEB3_TIMEOUT=NaN bug: docker-compose passes
 * `WEB3_TIMEOUT=${WEB3_TIMEOUT}` into the container, and when the host var is
 * unset ConfigService returns '' (default only applies to `undefined`). Naive
 * parseInt yields NaN, and setTimeout(fn, NaN) fires immediately, so every RPC
 * call is reported as timed out. We guarantee web3Timeout is always a positive
 * integer regardless of env input.
 */
describe('Web3Service WEB3_TIMEOUT parsing', () => {
  it.each<[string | undefined, string]>([
    [undefined, 'not set in .env'],
    ['', 'empty (docker-compose pass-through of unset host var)'],
    ['   ', 'only whitespace'],
    ['abc', 'non-numeric'],
    ['0', 'zero'],
    ['-1', 'negative'],
  ])('falls back to DEFAULT_WEB3_TIMEOUT_MS when WEB3_TIMEOUT is %j (%s)', (raw) => {
    expect(getTimeout(makeServiceWithRawTimeout(raw))).toBe(DEFAULT_WEB3_TIMEOUT_MS);
  });

  it('uses WEB3_TIMEOUT verbatim when it is a valid positive integer', () => {
    expect(getTimeout(makeServiceWithRawTimeout('45000'))).toBe(45000);
  });

  it('never produces NaN (regression: setTimeout(fn, NaN) fires immediately)', () => {
    for (const raw of [undefined, '', '   ', 'abc', '10s']) {
      const t = getTimeout(makeServiceWithRawTimeout(raw));
      expect(Number.isNaN(t)).toBe(false);
      expect(t).toBeGreaterThan(0);
    }
  });
});
