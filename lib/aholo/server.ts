import "server-only";

/**
 * Server-side Aholo helpers. The API key never reaches the browser.
 * Paths marked UNVERIFIED are not in the public docs I could reach; override them via env.
 */
export const env = () => ({
  key: process.env.AHOLO_API_KEY,
  base: (process.env.AHOLO_BASE_URL || "https://api.aholo.ai/global").replace(/\/$/, ""),
  taskParam: process.env.AHOLO_TASK_PARAM || "taskid", // verified in the official SDK (tasks.ts)
  tokenUrl: process.env.AHOLO_ASSET_TOKEN_URL, // UNVERIFIED for the global region; default below
  assetHosts: (process.env.AHOLO_ASSET_HOSTS || ".aholo.ai,.aholo3d.com,.aholo3d.cn,.kujiale.com,.manycoreapis.com")
    .split(",").map((s) => s.trim()).filter(Boolean),
});

export const OPS: Record<string, string | undefined> = {
  "image-to-3d": "/lux3d/v1/generate/img-to-3d/task/create",
  "text-to-3d": "/lux3d/v1/generate/text-to-3d/task/create",
  "material-transfer": "/lux3d/v1/generate/material-transfer/task/create",
  export: "/lux3d/v1/multi-format-export/task/create",
  // Verified against the official SDK (manycoretech/aholo-spatial-sdk, lux3d part-split.ts): body { glbUrl }, d = task id.
  "part-split": process.env.AHOLO_PART_SPLIT_PATH || "/lux3d/v1/part-split/task/create",
};
export const GET_TASK_PATH = process.env.AHOLO_GET_TASK_PATH || "/lux3d/v1/generate/task/get";

export class AholoError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

/** Calls Aholo and unwraps the { c, d, m } envelope ("0" = success). */
export async function aholo(path: string, init: RequestInit = {}): Promise<unknown> {
  const { key, base } = env();
  if (!key) throw new AholoError("AHOLO_API_KEY is not set on the server", 503);
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: key }, // no "Bearer"
    cache: "no-store",
  });
  const text = await res.text();
  let json: { c?: string | number; d?: unknown; m?: string } | null = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new AholoError(`Aholo HTTP ${res.status} at ${path}: ${(json?.m ?? text).slice(0, 300)}`, res.status);
  if (!json) throw new AholoError(`Aholo returned non-JSON at ${path}: ${text.slice(0, 200)}`);
  if (json.c !== undefined && String(json.c) !== "0") {
    throw new AholoError(`Aholo error ${json.c} at ${path}: ${json.m ?? "unknown"}`);
  }
  // Some endpoints (e.g. /asset/v1/token) return their fields directly, without the { c, d, m } envelope.
  return json.c === undefined && json.d === undefined ? json : json.d;
}

export function hostAllowed(u: URL): boolean {
  const { assetHosts } = env();
  return assetHosts.some((h) => (h.startsWith(".") ? u.hostname.endsWith(h) || u.hostname === h.slice(1) : u.hostname === h));
}
