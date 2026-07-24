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

/**
 * Same upload as `uploadFileWithRetry`, but reports real progress -- the
 * Supabase JS client wraps `fetch`, which has no upload-progress event, so
 * this issues the same request the SDK would (a POST to the Storage REST
 * endpoint, bearer token from the current session) via XMLHttpRequest
 * instead, whose `upload.onprogress` does expose it.
 */
export function uploadFileWithProgress(
  bucket: string,
  path: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<{ error: Error | null }> {
  async function attempt(): Promise<{ error: Error | null }> {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!token || !supabaseUrl) return { error: new Error("Not authenticated") };

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${supabaseUrl}/storage/v1/object/${bucket}/${path}`);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("x-upsert", "false");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          resolve({ error: null });
        } else {
          resolve({ error: new Error(xhr.responseText || `Upload failed (${xhr.status})`) });
        }
      };
      xhr.onerror = () => resolve({ error: new Error("Network error during upload") });
      xhr.send(file);
    });
  }

  return (async () => {
    let result = await attempt();
    if (result.error && /row-level security/i.test(result.error.message)) {
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (!refreshErr) result = await attempt();
    }
    return result;
  })();
}
