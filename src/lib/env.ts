import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Reads an env var from process.env first, falling back to the Cloudflare Worker's bindings. */
export async function envValue(name: string): Promise<string | undefined> {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  try {
    const context = await getCloudflareContext({ async: true });
    const value = context.env[name as keyof typeof context.env];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function appOrigin(request: Request) {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.CLOUDFLARE_DEPLOYMENT_URL ||
    new URL(request.url).origin
  ).replace(/\/$/, "");
}
