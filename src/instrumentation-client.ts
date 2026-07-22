import * as Sentry from "@sentry/nextjs";

// Client-side only, deliberately: this app deploys to Cloudflare Workers via
// OpenNext, not Vercel, and @sentry/nextjs's server/edge instrumentation
// hooks aren't verified compatible with that runtime. Browser error capture
// (the class of bug this project has actually hit -- React state/effect
// bugs, unhandled UI errors) doesn't care what serves the page, so it's the
// safe, high-value slice to wire up now. Server-side capture is a real
// follow-up, not a Phase 0 item.
//
// No-ops safely (with a console warning) if NEXT_PUBLIC_SENTRY_DSN isn't
// set -- this file is meant to ship inert until the DSN secret exists.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    environment: process.env.NODE_ENV,
  });
}

export const onRouterTransitionStart = dsn ? Sentry.captureRouterTransitionStart : undefined;
