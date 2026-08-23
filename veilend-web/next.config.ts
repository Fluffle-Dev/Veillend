import type { NextConfig } from "next";
import { validateConfig } from "./src/lib/config-validation";
import { buildCsp, getStaticSecurityHeaders } from "./src/lib/server/security-headers";

/**
 * Run startup config validation before Next.js processes the rest of the
 * config.  This ensures contributors see a clear, actionable error listing
 * all missing/invalid environment variables at `next dev` / `next build` time
 * rather than cryptic runtime failures deep inside the app.
 *
 * All variables have safe defaults for testnet, so the app starts without any
 * .env.local file.  See .env.example for the full list of variables.
 */
validateConfig();

const isDev = process.env.NODE_ENV === "development";

/**
 * Static (no-nonce) security headers, applied on every route by Next's
 * config-level `headers()`. `proxy.ts` is the authoritative layer — it sets
 * the same headers plus a per-request CSP nonce — but `headers()` runs
 * independently as a backup for any route the proxy's matcher doesn't cover,
 * so both frame-ancestors (CSP) and X-Frame-Options (for browsers that don't
 * honor frame-ancestors) are set here too, not just there.
 */
const staticSecurityHeaders = [
  { key: "Content-Security-Policy", value: buildCsp({ isDev }) },
  ...Object.entries(getStaticSecurityHeaders(isDev)).map(([key, value]) => ({
    key,
    value,
  })),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: staticSecurityHeaders,
      },
    ];
  },
};

export default nextConfig;
