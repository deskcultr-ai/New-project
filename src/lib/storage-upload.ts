import { supabase } from "@/lib/supabase";

/**
 * Uploads a file, retrying once after a forced session refresh if the first
 * attempt fails with an RLS violation. A locally-persisted Supabase session
 * can go stale in a way that still looks valid client-side but gets
 * rejected once the request actually reaches Postgres RLS -- this makes
 * every upload path self-heal from that instead of surfacing a confusing
 * "row-level security" error the user has no way to act on.
 */
export async function uploadFileWithRetry(
  bucket: string,
  path: string,
  file: File,
  options?: { upsert?: boolean; contentType?: string }
) {
  let result = await supabase.storage.from(bucket).upload(path, file, options);

  if (result.error && /row-level security/i.test(result.error.message)) {
    const { error: refreshErr } = await supabase.auth.refreshSession();
    if (!refreshErr) {
      result = await supabase.storage.from(bucket).upload(path, file, options);
    }
  }

  return result;
}
