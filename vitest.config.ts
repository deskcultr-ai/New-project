import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // src/lib/supabase.ts throws if these are missing, and its
    // client-construction side effect runs at import time in any file
    // that imports something re-exported alongside it (e.g. session.ts).
    // Dummy values are enough -- no test here makes a real network call.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      // Pin the timezone so date-boundary tests (e.g. getDueUrgency) are
      // deterministic regardless of what machine/CI runner they run on.
      TZ: "UTC",
    },
  },
});
