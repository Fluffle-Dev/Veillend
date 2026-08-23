// Builds the Content-Security-Policy and companion security headers shared
// between `proxy.ts` (the authoritative, per-request/nonce'd layer) and
// `next.config.ts` (a static backup for any route the proxy matcher misses).
//
// Kept framework-agnostic (plain strings, no NextResponse/NextRequest) so it
// can be unit-tested and reused from both call sites without pulling in the
// Edge/Node request types.

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';

/** Origins the app itself needs to call out to; feeds `connect-src`. */
export function getConnectSrcOrigins(): string[] {
  const origins = [
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
    process.env.NEXT_PUBLIC_HORIZON_URL || DEFAULT_HORIZON_URL,
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || DEFAULT_SOROBAN_RPC_URL,
  ];
  // De-dupe: NEXT_PUBLIC_HORIZON_URL and NEXT_PUBLIC_SOROBAN_RPC_URL are
  // sometimes pointed at the same host in local/dev setups.
  return Array.from(new Set(origins));
}

/** A base64 random value suitable for a CSP `nonce-...` source and a `nonce` attribute. */
export function generateNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}

interface CspOptions {
  /** Per-request nonce. Omit for the static (no-nonce) fallback policy. */
  nonce?: string;
  isDev: boolean;
}

/**
 * Builds the primary, nonce-based CSP used by `proxy.ts`.
 *
 * `strict-dynamic` means the classic host-based `script-src` allowlist is
 * ignored by browsers that support it (Chrome, Firefox, Edge) in favor of
 * trusting only scripts loaded by an already-trusted (nonce'd) script; the
 * `https:` fallback keeps older browsers restricted to same-scheme scripts
 * rather than falling open.
 */
export function buildCsp({ nonce, isDev }: CspOptions): string {
  const connectSrc = ["'self'", ...getConnectSrcOrigins()];
  if (isDev) {
    // Turbopack/webpack HMR connects over a same-origin websocket.
    connectSrc.push('ws:', 'http://localhost:*');
  }

  const scriptSrc = ["'self'"];
  const styleSrc = ["'self'"];
  if (nonce) {
    scriptSrc.push(`'nonce-${nonce}'`, 'https:', "'strict-dynamic'");
    styleSrc.push(`'nonce-${nonce}'`);
  } else {
    // Static fallback: no nonce is available outside of a per-request
    // context, so this stays deliberately more permissive than the primary
    // policy — it exists only as a backup for routes the proxy misses.
    scriptSrc.push('https:');
    styleSrc.push("'unsafe-inline'");
  }
  if (isDev) {
    scriptSrc.push("'unsafe-eval'", "'unsafe-inline'");
    styleSrc.push("'unsafe-inline'");
  }

  const directives = [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(' ')}`,
    `style-src ${styleSrc.join(' ')}`,
    `img-src 'self' data: https:`,
    `font-src 'self'`,
    `connect-src ${connectSrc.join(' ')}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ];
  if (!isDev) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

/** Headers with no meaningful per-request state; identical in both layers. */
export function getStaticSecurityHeaders(isDev: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (!isDev) {
    // 2 years, including subdomains, eligible for browser preload lists.
    headers['Strict-Transport-Security'] =
      'max-age=63072000; includeSubDomains; preload';
  }
  return headers;
}
