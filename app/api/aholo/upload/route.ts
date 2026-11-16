import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { AholoError, aholo, env } from "@/lib/aholo/server";

export const runtime = "nodejs";

/**
 * Asset upload per the documented flow: token -> single upload (multipart file + md5) -> status.
 * UNVERIFIED for the global region: the token URL (override with AHOLO_ASSET_TOKEN_URL) and the exact
 * upload response shape. Files larger than blockSize need block upload, which is not implemented.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AholoError("missing file", 400);
    const buf = Buffer.from(await file.arrayBuffer());
    const md5 = createHash("md5").update(buf).digest("hex");

    const tok = (await aholo(env().tokenUrl || "/asset/v1/token")) as { ousToken: string; globalDomain: string; blockSize?: number };
    if (!tok?.ousToken || !tok?.globalDomain) throw new AholoError("Unexpected token response from Aholo asset service");
    if (tok.blockSize && buf.length > tok.blockSize) throw new AholoError(`File is larger than one block (${tok.blockSize} bytes); block upload is not implemented`, 413);

    const fd = new FormData();
    fd.set("file", new Blob([buf], { type: file.type }), file.name);
    fd.set("md5", md5);
    const headers = { "ous-token-v2": tok.ousToken };
    const up = await fetch(`${tok.globalDomain}/ous/api/v2/single/upload`, { method: "POST", body: fd, headers });
    const upJson = await up.json().catch(() => ({}));
    const pick = (j: Record<string, unknown>) => {
      const d = (j.d ?? j) as Record<string, unknown>;
      return { status: Number(d.status), url: typeof d.url === "string" ? d.url : undefined };
    };
    let r = pick(upJson);
    for (let i = 0; i < 20 && !(r.status === 5 && r.url) && !(r.url && Number.isNaN(r.status)); i++) {
      if (r.status === 6 || r.status === 8) throw new AholoError("Aholo asset upload failed");
      await new Promise((s) => setTimeout(s, 1000));
      const st = await fetch(`${tok.globalDomain}/ous/api/v2/upload/status?md5=${md5}`, { headers });
      r = pick(await st.json().catch(() => ({})));
    }
    if (!r.url) throw new AholoError("Upload finished without a URL");
    return NextResponse.json({ url: r.url });
  } catch (e) {
    const err = e instanceof AholoError ? e : new AholoError(e instanceof Error ? e.message : "failed");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
