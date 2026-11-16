import { NextResponse } from "next/server";
import { AholoError, OPS, aholo } from "@/lib/aholo/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { op, body } = await req.json();
    const path = OPS[String(op)];
    if (!path) {
      throw new AholoError(`Unknown operation: ${op}`, 400);
    }
    const d = await aholo(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const taskId = typeof d === "object" && d ? ((d as Record<string, unknown>).taskid ?? (d as Record<string, unknown>).taskId ?? (d as Record<string, unknown>).id) : d;
    if (taskId === undefined || taskId === null) throw new AholoError(`No task id in response: ${JSON.stringify(d).slice(0, 200)}`);
    return NextResponse.json({ taskId: String(taskId) });
  } catch (e) {
    const err = e instanceof AholoError ? e : new AholoError(e instanceof Error ? e.message : "failed");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
