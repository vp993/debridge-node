/**
 * Masks sensitive parts of an RPC URL (path, query, auth) leaving only
 * the protocol and hostname, so that API keys embedded in RPC URLs are
 * never exposed in logs.
 */
export function maskRpcUrl(rpc: string): string {
  try {
    const u = new URL(rpc);
    return `${u.protocol}//${u.hostname}/...`;
  } catch {
    return '<hidden>';
  }
}

/**
 * Masks every RPC URL in the provided list.
 */
export function maskRpcUrls(rpcs: string[]): string[] {
  return rpcs.map(maskRpcUrl);
}
