import { localInterpret, type Intent } from "./intent";

export interface QcResult { pass: boolean; score: number; issues: string[]; simulated: boolean }

/** LLM-based understanding when the server has a key; otherwise the local multilingual lexicon. */
export async function interpret(message: string, context = ""): Promise<Intent> {
  try {
    const r = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "interpret", message, context }) });
    const j = await r.json();
    if (j.source === "llm" && typeof j.language === "string") {
      return {
        language: j.language, finish: j.finish, material: !!j.material || !!j.finish, split: !!j.split,
        regenerate: !!j.regenerate, explode: j.explode, reply: String(j.reply ?? ""), source: "llm",
      };
    }
  } catch {}
  return localInterpret(message);
}

/** Vision QC via the server when a key exists; otherwise a clearly-labelled simulation. */
export async function qualityCheck(snapshot: string | null, run: number, allowSimulated: boolean, brief = ""): Promise<QcResult | null> {
  if (snapshot) {
    try {
      const r = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "qc", image: snapshot, brief }) });
      const j = await r.json();
      if (j.source === "llm" && typeof j.pass === "boolean") {
        return { pass: j.pass, score: Number(j.score) || 0, issues: Array.isArray(j.issues) ? j.issues : [], simulated: false };
      }
    } catch {}
  }
  if (!allowSimulated) return null;
  return run === 0
    ? { pass: false, score: 0.62, issues: ["Fine surface detail is soft"], simulated: true }
    : { pass: true, score: 0.91, issues: [], simulated: true };
}
