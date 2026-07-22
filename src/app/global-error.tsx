"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "./globals.css";

const SUPPORT_EMAIL = "deskcultr@gmail.com";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col" style={{ background: "var(--background)", color: "var(--text-primary)" }}>
        <main className="grid min-h-screen place-items-center px-6 text-center">
          <div className="max-w-sm">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full" style={{ background: "var(--surface-soft)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-6 w-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold mb-2">Something went wrong</h1>
            <p className="text-sm mb-6" style={{ color: "var(--text-tertiary)" }}>
              We&apos;ve been notified and are looking into it. Reloading usually fixes it.
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => window.location.reload()}
                className="rounded-lg px-4 py-2 text-sm font-medium border-0 cursor-pointer"
                style={{ background: "#0d9488", color: "#04201d" }}
              >
                Reload
              </button>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                Contact support
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
