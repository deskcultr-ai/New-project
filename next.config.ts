import type { NextConfig } from "next";

const SUPABASE_ORIGIN = "https://afsksxyryvxjaftblufv.supabase.co";
const SUPABASE_WS_ORIGIN = "wss://afsksxyryvxjaftblufv.supabase.co";

// script-src/style-src keep 'unsafe-inline' because Next's App Router streams
// RSC payloads via inline <script> tags and several components set inline
// style={{ position: ... }} — tightening this to a nonce-based policy is a
// real follow-up (needs middleware + a full browser pass to confirm nothing
// breaks), just not one that's safe to ship without live-testing it first.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${SUPABASE_ORIGIN}`,
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_WS_ORIGIN} https://*.sentry.io https://*.ingest.sentry.io https://*.ingest.us.sentry.io`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
