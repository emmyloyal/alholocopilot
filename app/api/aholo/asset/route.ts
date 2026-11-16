import { NextResponse } from "next/server";
import { hostAllowed } from "@/lib/aholo/server";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  glb: "model/gltf-binary",
  usdz: "model/vnd.usdz+zip",
  zip: "application/zip",
  stl: "model/stl",
  "3mf": "model/3mf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** Same-origin proxy so the viewer can load result files (avoids CORS). Host allowlist prevents SSRF. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  let u: URL;
  try { u = new URL(raw ?? ""); } catch { return NextResponse.json({ error: "bad url" }, { status: 400 }); }
  if (!/^https?:$/.test(u.protocol) || !hostAllowed(u)) {
    return NextResponse.json({ error: `Host not allowed: ${u.hostname}. Add it to AHOLO_ASSET_HOSTS.` }, { status: 403 });
  }
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) return NextResponse.json({ error: `upstream ${r.status}` }, { status: 502 });
  // Name the file after the upstream path, so a direct link saves as e.g. "model.usdz" rather than "asset".
  const name = (u.pathname.split("/").pop() || "model").replace(/[^\w.\-]/g, "_");
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const upstreamType = r.headers.get("content-type");
  const type = TYPES[ext] ?? (upstreamType && upstreamType !== "application/octet-stream" ? upstreamType : "application/octet-stream");
  const headers: Record<string, string> = {
    "content-type": type,
    "content-disposition": `inline; filename="${name}"`,
    "cache-control": "private, max-age=3000",
  };
  const len = r.headers.get("content-length");
  if (len) headers["content-length"] = len;
  return new Response(r.body, { headers });
}
