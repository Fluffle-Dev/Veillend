import { NextRequest, NextResponse } from 'next/server';
import { generateCsrfValue, signCsrfToken, verifyCsrfToken } from '@/lib/server/csrf';
import { buildCsp, generateNonce, getStaticSecurityHeaders } from '@/lib/server/security-headers';

// Runs on every route except Next's own static/image-optimization assets —
// those aren't documents and don't need CSP/HSTS/etc, and excluding them
// keeps the proxy off the hot path for every JS/CSS chunk.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const SESSION_COOKIE = 'veillend_session';
const MARKER_COOKIE = 'veillend_has_session';
const REFRESH_TTL_RATIO = 0.5; // refresh when >50% of TTL elapsed
const REFRESH_DEDUPE_MS = 5 * 60 * 1000; // 5 minutes
const REFRESH_MAX_AGE = 24 * 60 * 60; // 24 hours in seconds

// Simple in-memory dedupe by session jti or token fingerprint.
const lastRefreshAt = new Map<string, number>();

function parseJwt(token: string | undefined) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    let json = '';
    if (typeof globalThis.atob === 'function') {
      json = decodeURIComponent(
        Array.prototype.map
          .call(globalThis.atob(b64), function (c: string) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join(''),
      );
    } else if (typeof Buffer !== 'undefined') {
      json = Buffer.from(b64, 'base64').toString('utf8');
    } else {
      return null;
    }
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function sameOriginNext(nextParam: string | null) {
  if (!nextParam) return '/';
  try {
    const u = new URL(nextParam, SITE_URL);
    const allowed = new URL(SITE_URL);
    if (u.origin !== allowed.origin) return '/';
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}

/** Applies the CSP/HSTS/nosniff/etc. headers every matched response carries. */
function applySecurityHeaders(response: NextResponse, nonce: string): NextResponse {
  const isDev = process.env.NODE_ENV === 'development';
  response.headers.set('Content-Security-Policy', buildCsp({ nonce, isDev }));
  for (const [key, value] of Object.entries(getStaticSecurityHeaders(isDev))) {
    response.headers.set(key, value);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  const path = url.pathname;

  const nonce = generateNonce();

  // ── Strip client-supplied identity headers (defense against header spoofing),
  //    and make the nonce available to Server Components via `headers()`. ──────
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-wallet-address');
  requestHeaders.set('x-nonce', nonce);

  const protectedPrefix =
    path.startsWith('/dashboard') ||
    path.startsWith('/api/dashboard') ||
    path.startsWith('/api/actions');
  const session = request.cookies.get(SESSION_COOKIE)?.value;

  // ── Auth gate for protected routes ────────────────────────────────────────
  if (protectedPrefix && !session) {
    if (request.method === 'GET') {
      const nextParam = url.pathname + url.search;
      const allowedNext = sameOriginNext(nextParam);
      const redirectTo = new URL(allowedNext, SITE_URL);
      redirectTo.searchParams.set('next', allowedNext);
      return applySecurityHeaders(NextResponse.redirect(redirectTo, 307), nonce);
    } else {
      return applySecurityHeaders(
        NextResponse.json({ code: 'UNAUTHENTICATED', loginUrl: '/login' }, { status: 401 }),
        nonce,
      );
    }
  }

  // ── Opportunistic session refresh when the token is past 50% of its TTL ───
  if (session) {
    const payload = parseJwt(session);
    if (payload && payload.iat && payload.exp) {
      const now = Math.floor(Date.now() / 1000);
      const ttl = payload.exp - payload.iat;
      const age = now - payload.iat;
      const ratio = ttl > 0 ? age / ttl : 1;

      const key = payload.jti || session.slice(0, 24);
      const last = lastRefreshAt.get(key) || 0;

      if (ratio > REFRESH_TTL_RATIO && Date.now() - last > REFRESH_DEDUPE_MS) {
        try {
          lastRefreshAt.set(key, Date.now());
          const r = await fetch(`${API_BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session}`,
              'Content-Type': 'application/json',
            },
          });

          if (r.status === 200) {
            const data = await r.json();
            const newToken = data?.accessToken || data?.token || null;
            if (newToken) {
              const res = NextResponse.next({ request: { headers: requestHeaders } });
              res.cookies.set({
                name: SESSION_COOKIE,
                value: newToken,
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                maxAge: REFRESH_MAX_AGE,
              });
              res.cookies.set({ name: MARKER_COOKIE, value: 'true', path: '/' });
              return applySecurityHeaders(res, nonce);
            }
          }

          if (r.status === 401) {
            const redirectTo = new URL('/login', SITE_URL);
            redirectTo.searchParams.set('reason', 'expired');
            const res = NextResponse.redirect(redirectTo);
            res.cookies.delete(SESSION_COOKIE);
            res.cookies.delete(MARKER_COOKIE);
            return applySecurityHeaders(res, nonce);
          }
        } catch (e) {
          // ignore refresh errors and proceed
          console.error('proxy refresh error', e);
        }
      }
    }
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // ── CSRF validation — API write methods only ──────────────────────────────
  const isApiRoute = path.startsWith('/api/');
  const existingCookie = request.cookies.get(CSRF_COOKIE)?.value;

  // Bootstrap a signed token for clients that don't have one yet so the
  // double-submit pattern has something to compare against next request.
  if (isApiRoute && !existingCookie) {
    const signed = await signCsrfToken(generateCsrfValue());
    response.cookies.set(CSRF_COOKIE, signed, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }

  if (!isApiRoute || !WRITE_METHODS.has(request.method)) {
    return applySecurityHeaders(response, nonce);
  }

  const headerToken = request.headers.get(CSRF_HEADER);
  const cookieToken = existingCookie;

  if (!headerToken || !cookieToken) {
    return applySecurityHeaders(
      NextResponse.json({ error: 'Missing CSRF token' }, { status: 401 }),
      nonce,
    );
  }

  const cookieIsValid = await verifyCsrfToken(cookieToken);
  if (!cookieIsValid || headerToken !== cookieToken) {
    return applySecurityHeaders(
      NextResponse.json({ error: 'CSRF token mismatch' }, { status: 403 }),
      nonce,
    );
  }

  return applySecurityHeaders(response, nonce);
}
