import { withSentryConfig } from "@sentry/nextjs";
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
  // CSP wildcards only cover one subdomain label, so Sentry's per-project,
  // per-region ingest hosts (o<id>.ingest.<region>.sentry.io -- 4 labels
  // deep) need to be listed explicitly rather than guessed at. This is the
  // exact host the current NEXT_PUBLIC_SENTRY_DSN resolves to; if the DSN
  // ever changes (new project/region), update this to match.
  `connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_WS_ORIGIN} https://o4511777398063104.ingest.de.sentry.io`,
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

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "desk-5t",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
