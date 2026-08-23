import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

// Regression coverage for issue #306: the proxy must attach CSP + friends to
// every response, landing and dashboard included, with a fresh nonce per
// request and HSTS only in production.

describe('Security headers (issue #306)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function setNodeEnv(value: string) {
    vi.stubEnv('NODE_ENV', value);
  }

  it('attaches CSP, nosniff, referrer-policy, and permissions-policy to the landing page response', async () => {
    const res = await proxy(new NextRequest('http://localhost:3000/'));

    expect(res.headers.get('content-security-policy')).toBeTruthy();
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).toBe(
      'camera=(), microphone=(), geolocation=()',
    );
  });

  it('attaches the same headers to an unauthenticated /dashboard redirect', async () => {
    const res = await proxy(new NextRequest('http://localhost:3000/dashboard'));

    // No session cookie -> redirected, but security headers must still be present.
    expect(res.status).toBe(307);
    expect(res.headers.get('content-security-policy')).toBeTruthy();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('includes a unique nonce per request that matches the CSP script-src', async () => {
    const res1 = await proxy(new NextRequest('http://localhost:3000/'));
    const res2 = await proxy(new NextRequest('http://localhost:3000/'));

    const csp1 = res1.headers.get('content-security-policy') ?? '';
    const csp2 = res2.headers.get('content-security-policy') ?? '';
    const nonce1 = /'nonce-([^']+)'/.exec(csp1)?.[1];
    const nonce2 = /'nonce-([^']+)'/.exec(csp2)?.[1];

    expect(nonce1).toBeTruthy();
    expect(nonce2).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);
    expect(csp1).toContain(`script-src 'self' 'nonce-${nonce1}'`);
    expect(csp1).toContain(`style-src 'self' 'nonce-${nonce1}'`);
  });

  it('sets Strict-Transport-Security in production but not in development', async () => {
    setNodeEnv('production');
    const prodRes = await proxy(new NextRequest('http://localhost:3000/'));
    expect(prodRes.headers.get('strict-transport-security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );

    setNodeEnv('development');
    const devRes = await proxy(new NextRequest('http://localhost:3000/'));
    expect(devRes.headers.get('strict-transport-security')).toBeNull();
  });

  it('relaxes script-src/style-src with unsafe-eval/unsafe-inline in development for HMR', async () => {
    setNodeEnv('development');
    const res = await proxy(new NextRequest('http://localhost:3000/'));
    const csp = res.headers.get('content-security-policy') ?? '';

    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("'unsafe-inline'");
  });

  it('does not relax the policy with unsafe-eval/unsafe-inline in production', async () => {
    setNodeEnv('production');
    const res = await proxy(new NextRequest('http://localhost:3000/'));
    const csp = res.headers.get('content-security-policy') ?? '';

    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).toContain('upgrade-insecure-requests');
  });
});
