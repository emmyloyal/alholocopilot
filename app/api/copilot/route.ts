import { NextResponse } from "next/server";
import { FINISH_PRESETS, encodeCustom } from "@/lib/finish";

export const runtime = "nodejs";

/**
 * Language understanding + vision QC. Uses Google Gemini when GEMINI_API_KEY is set
 * (Claude via ANTHROPIC_API_KEY as a fallback). With neither, the client falls back to the built-in lexicon.
 */
const GEMINI_KEY = process.env.GEMINI_API_KEY;
// Tried in order: on overload (429/5xx) or timeout the next model answers instead.
// Measured 2026-11-16: 3.5-flash ~5 s, flash-lite-latest ~2 s; 3.8-flash was timing out under load.
const GEMINI_MODELS = [process.env.GEMINI_MODEL || "gemini-3.5-flash", "gemini-flash-lite-latest"]
  .filter((m, i, a) => a.indexOf(m) === i);
const GEMINI_TIMEOUT_MS = 20_000;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.COPILOT_MODEL || "claude-sonnet-5-5";
const PROVIDER = GEMINI_KEY ? "gemini" : ANTHROPIC_KEY ? "claude" : null;

/** One prompt -> text. imageB64 is an optional JPEG. */
async function ask(system: string, text: string, imageB64?: string): Promise<string> {
  if (PROVIDER === "gemini") {
    const parts: unknown[] = [{ text }];
    if (imageB64) parts.unshift({ inline_data: { mime_type: "image/jpeg", data: imageB64 } });
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2048, temperature: 0.2 },
    });
    let lastError = "";
    // two rounds over the model list: free-tier keys hit short per-minute limits, which clear after a pause
    for (const model of [...GEMINI_MODELS, ...GEMINI_MODELS]) {
      if (lastError) await new Promise((r) => setTimeout(r, 1500));
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY! },
          body,
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok) return (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
        lastError = `Gemini ${model} ${res.status}: ${j?.error?.message ?? "request failed"}`;
        if (res.status !== 429 && res.status < 500) break; // bad key / bad request: another model won't help
      } catch (e) {
        lastError = `Gemini ${model}: ${e instanceof Error && e.name === "TimeoutError" ? `no answer within ${GEMINI_TIMEOUT_MS / 1000}s` : String(e)}`;
      }
    }
    throw new Error(lastError);
  }
  const content = imageB64
    ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } }, { type: "text", text }]
    : text;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 500, system, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const j = await res.json();
  return j.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
}

/** AI finish answer -> finish string: a known preset key, or an encoded custom finish. */
function toFinish(f: unknown): string | undefined {
  if (typeof f === "string") return FINISH_PRESETS[f] ? f : undefined;
  if (f && typeof f === "object") {
    const o = f as Record<string, unknown>;
    if (typeof o.label === "string" && typeof o.color === "string") {
      return encodeCustom({ label: o.label, color: o.color, accent: typeof o.accent === "string" ? o.accent : undefined, kind: o.kind as never });
    }
  }
  return undefined;
}

const json = (t: string) => {
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no json");
  return JSON.parse(m[0]);
};

const INTERPRET = `You are the planner of a 3D product-production Copilot. The user may write in ANY language.
Return ONLY a JSON object: {"language": ISO-639-1 code of the user's message,
"finish": null if no finish is requested; otherwise a preset key when one fits (${Object.entries(FINISH_PRESETS).map(([k, v]) => `${k}=${v.label}`).join(", ")}),
  or for anything else an object {"label": short English name, "color": "#rrggbb" main colour, "accent": "#rrggbb" darker/secondary colour, "kind": "metal"|"matte"|"gloss"|"wood"|"stone"|"fabric"},
"material": true if they want a different colour/finish/material,
"split": true if they want components/parts separated or inspected,
"regenerate": true if they want the model generated again,
"explode": true to show exploded view, false to reassemble, null if not mentioned,
"reply": written in the user's own language}.
You are given PROJECT CONTEXT (the brief, each step's status and errors, recent activity). Use it.
- If the user asks for a change: set the fields and make "reply" ONE sentence saying what you WILL do ("I'll switch it to gold."). The change has not happened yet, so never say it is done.
- If the user asks a question (status, why something failed, what to do next, what a step does): set all booleans false and answer it in "reply" in at most 3 short sentences, using the context. Be concrete and honest; if the context does not say, say you don't know.
- If the message is unclear: set all booleans false and suggest what they can ask for (finish/colour, split into parts, exploded view, regenerate).
Facts you may use: generating costs about 1 Aholo credit, a material/finish change about 7, splitting into parts about 30, export about 1. Aholo export cannot take the split (multi-part) model, so the app exports the assembled model.`;

const QC = `You inspect a screenshot of a generated 3D model for a production quality check.
You are given the brief the model was made from. Judge the model against THAT brief (it may be any kind of object).
Return ONLY JSON: {"pass": boolean, "score": number 0-1, "issues": string[] (max 3, short)}.
The image is a CLAY RENDER: every surface is drawn in the same plain grey on a light background, so you judge shape and features only. Colour, texture and material are deliberately not shown and are NOT defects.
Missing or plain colour/texture is NOT a defect either: the finish is applied in a later step.
Check: the object is recognisable as what the brief describes, the main features it mentions are present, the surface is complete, no obvious artifacts (holes, melted or floating geometry). Pass if score >= 0.75.`;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!PROVIDER) return NextResponse.json({ source: "none" });
  try {
    if (body.mode === "interpret") {
      const context = String(body.context ?? "").slice(0, 4000);
      const message = String(body.message ?? "").slice(0, 2000);
      const out = json(await ask(INTERPRET, context ? `PROJECT CONTEXT:\n${context}\n\nUSER MESSAGE:\n${message}` : message));
      return NextResponse.json({ ...out, finish: toFinish(out.finish), explode: out.explode ?? undefined, source: "llm", provider: PROVIDER });
    }
    if (body.mode === "qc") {
      const b64 = String(body.image ?? "").replace(/^data:image\/\w+;base64,/, "");
      const brief = String(body.brief ?? "").slice(0, 1000) || "(no brief given)";
      const out = json(await ask(QC, `Brief: ${brief}\n\nRun the quality check.`, b64));
      return NextResponse.json({ ...out, source: "llm", provider: PROVIDER });
    }
    return NextResponse.json({ source: "none" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ source: "none", error: e instanceof Error ? e.message : "failed" });
  }
}
