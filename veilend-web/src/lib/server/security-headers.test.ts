import { describe, expect, it } from 'vitest';
import { buildCsp, generateNonce, getConnectSrcOrigins, getStaticSecurityHeaders } from './security-headers';

describe('generateNonce', () => {
  it('returns a fresh, non-empty value every call', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('buildCsp', () => {
  it('includes the nonce in both script-src and style-src when provided', () => {
    const csp = buildCsp({ nonce: 'abc123', isDev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' https: 'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
  });

  it('falls back to a permissive-but-scoped policy with no nonce (static fallback use case)', () => {
    const csp = buildCsp({ isDev: false });
    expect(csp).not.toContain('nonce-');
    expect(csp).toContain("script-src 'self' https:");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('always includes frame-ancestors none, object-src none, and base-uri self', () => {
    const csp = buildCsp({ nonce: 'x', isDev: false });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('includes upgrade-insecure-requests only outside of dev', () => {
    expect(buildCsp({ nonce: 'x', isDev: false })).toContain('upgrade-insecure-requests');
    expect(buildCsp({ nonce: 'x', isDev: true })).not.toContain('upgrade-insecure-requests');
  });

  it('relaxes script-src and style-src with unsafe-eval/unsafe-inline in dev', () => {
    const csp = buildCsp({ nonce: 'x', isDev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("'unsafe-inline'");
  });

  it("includes the app's API/Horizon/Soroban origins in connect-src", () => {
    const csp = buildCsp({ nonce: 'x', isDev: false });
    for (const origin of getConnectSrcOrigins()) {
      expect(csp).toContain(origin);
    }
  });
});

describe('getStaticSecurityHeaders', () => {
  it('always sets nosniff, X-Frame-Options, referrer-policy, and permissions-policy', () => {
    const headers = getStaticSecurityHeaders(false);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()');
  });

  it('sets Strict-Transport-Security only outside of dev', () => {
    expect(getStaticSecurityHeaders(false)['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(getStaticSecurityHeaders(true)['Strict-Transport-Security']).toBeUndefined();
  });
});
