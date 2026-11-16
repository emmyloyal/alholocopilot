import { NextResponse } from "next/server";
import { AholoError, GET_TASK_PATH, aholo, env } from "@/lib/aholo/server";

export const runtime = "nodejs";

/** Normalises the task: statuses 0/1 running, 3 succeeded, 4 failed, 6 cancelled; results in d.outputs[].content. */
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new AholoError("missing id", 400);
    const d = (await aholo(`${GET_TASK_PATH}?${env().taskParam}=${encodeURIComponent(id)}`)) as Record<string, unknown> | null;
    const status = Number(d?.status ?? d?.state ?? 1);
    const outs = Array.isArray(d?.outputs) ? (d!.outputs as Array<{ content?: unknown } | string>) : [];
    const outputs = outs
      .map((o) => (typeof o === "string" ? o : typeof o?.content === "string" ? o.content : ""))
      .flatMap((c) => {
        if (!c) return [];
        if (c.startsWith("[")) { try { return JSON.parse(c) as string[]; } catch {} }
        return [c];
      })
      .filter((c) => /^https?:\/\//i.test(c));
    const state = status === 3 ? "done" : status === 4 || status === 6 ? "failed" : "running";
    return NextResponse.json({ state, status, outputs, message: typeof d?.message === "string" ? d.message : undefined });
  } catch (e) {
    const err = e instanceof AholoError ? e : new AholoError(e instanceof Error ? e.message : "failed");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
