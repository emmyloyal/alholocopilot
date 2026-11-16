import { NextResponse } from "next/server";
import { aholo, env } from "@/lib/aholo/server";

export const runtime = "nodejs";

/** Tells the browser whether to run live or mock, and whether the key/paths work. */
export async function GET() {
  if (!env().key) return NextResponse.json({ live: false });
  try {
    // Free call that proves the key works (there is no balance endpoint in the official SDK).
    await aholo("/lux3d/v1/generate/task/list?page=1&pagesize=1");
    return NextResponse.json({ live: true, ok: true });
  } catch (e) {
    return NextResponse.json({ live: true, ok: false, message: e instanceof Error ? e.message : "failed" });
  }
}
