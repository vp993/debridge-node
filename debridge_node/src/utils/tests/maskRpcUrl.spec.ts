import { maskRpcUrl, maskRpcUrls } from '../maskRpcUrl';

describe('maskRpcUrl', () => {
  it('strips path, query and credentials, keeping only protocol and hostname', () => {
    expect(maskRpcUrl('https://rpc.example.com/v1/abc?apiKey=SECRET')).toBe('https://rpc.example.com/...');
  });

  it('masks URLs that embed an API key in the path', () => {
    expect(maskRpcUrl('https://mainnet.infura.io/v3/0123456789abcdef')).toBe('https://mainnet.infura.io/...');
  });

  it('masks URLs that embed basic-auth credentials in userinfo', () => {
    expect(maskRpcUrl('https://user:password@rpc.example.com/path')).toBe('https://rpc.example.com/...');
  });

  it('returns <hidden> for values that are not valid URLs', () => {
    expect(maskRpcUrl('not-a-url')).toBe('<hidden>');
    expect(maskRpcUrl('')).toBe('<hidden>');
  });
});

describe('maskRpcUrls', () => {
  it('masks every URL in the list', () => {
    expect(
      maskRpcUrls([
        'https://rpc.example.com/v1/abc',
        'not-a-url',
        'https://mainnet.infura.io/v3/key',
      ]),
    ).toEqual(['https://rpc.example.com/...', '<hidden>', 'https://mainnet.infura.io/...']);
  });
});
