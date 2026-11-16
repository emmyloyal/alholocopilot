"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useWorkflow } from "@/lib/useWorkflow";
import { exportExplodedGLB, exportGLB, download } from "@/lib/exporter";
import { languageName } from "@/lib/intent";
import { speak, useVoice, VOICE_LANGS } from "@/lib/useVoice";
import type { ExportFile, ModelState, Step } from "@/lib/types";
import { FINISH_PRESETS, PICKER_PRESETS, finishLabel, resolveFinish } from "@/lib/finish";
import { DEMO_BRIEF } from "@/lib/aholo/replay";

const Viewer = dynamic(() => import("./Viewer"), { ssr: false });

/** Starting brief: matches the recorded demo run, and shows the kind of request the Copilot plans from. */
const EXAMPLE = DEMO_BRIEF;

const THEMES = [
  { id: "midnight", label: "Midnight", dot: "#38a3ff", bg: "#0a0c11" },
  { id: "paper", label: "Paper", dot: "#4f46e5", bg: "#e9ebf2" },
  { id: "aurora", label: "Aurora", dot: "#b78cff", bg: "#0d0819" },
] as const;

const STATUS_COLOR: Record<Step["status"], string> = {
  pending: "var(--muted)", running: "var(--accent)", done: "var(--ok)", failed: "var(--bad)", skipped: "var(--muted)",
};
const KIND_ICON: Record<Step["kind"], string> = { generate: "◇", qc: "◎", material: "◐", split: "▦", export: "⇩" };
const RING = 2 * Math.PI * 17; // circumference of the step-rail progress ring

/** Live m:ss counter so a long Aholo task visibly keeps working. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const sec = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="tabular-nums">{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}</span>;
}

export default function Studio() {
  const wf = useWorkflow();
  const { project } = wf;
  const [prompt, setPrompt] = useState(EXAMPLE);
  const [refName, setRefName] = useState<string | undefined>(undefined);
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refUrl, setRefUrl] = useState<string>("");
  const [view, setView] = useState<"processed" | "original">("processed");
  const [chat, setChat] = useState("");
  const [voiceLang, setVoiceLang] = useState("auto");
  const [building, setBuilding] = useState<string | null>(null); // export file being built in the browser
  const send = async (t: string, spoken: boolean) => {
    const r = await wf.sendChat(t);
    if (spoken && r) speak(r.reply, r.language);
  };
  const voice = useVoice((t) => { setChat(""); if (!wf.thinking) send(t, true); });
  const [theme, setTheme] = useState<(typeof THEMES)[number]["id"]>("aurora");

  useEffect(() => {
    const t = localStorage.getItem("aholo-theme") as typeof theme | null;
    if (t && THEMES.some((x) => x.id === t)) setTheme(t);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("aholo-theme", theme); } catch {}
  }, [theme]);

  const failed = project?.steps.some((s) => s.status === "failed");
  const doneCount = project?.steps.filter((s) => s.status === "done").length ?? 0;
  const base: ModelState | undefined = project?.model;
  const shown: ModelState | undefined =
    base && (view === "original"
      // live/replay: the model exactly as first generated; mock: the procedural model in its starting finish
      ? { ...base, modelUrl: base.originalModelUrl ?? base.modelUrl, finish: base.originalModelUrl ? base.finish : "titanium", exploded: false, stage: base.stage === "none" ? "none" : "generated" }
      : base);
  const viewerBg = THEMES.find((t) => t.id === theme)!.bg;

  const downloadFile = async (f: ExportFile) => {
    if (f.explodeFrom) {
      setBuilding(f.id);
      try { download(await exportExplodedGLB(f.explodeFrom), f.name); }
      catch (e) { alert(`Could not build the exploded model: ${e instanceof Error ? e.message : e}`); }
      finally { setBuilding(null); }
      return;
    }
    if (f.url) { const a = document.createElement("a"); a.href = f.url; a.download = f.name; a.click(); return; }
    if (f.format === "glb") return download(await exportGLB(), f.name);
    const body = f.format === "zip"
      ? JSON.stringify({ project: project?.id, prompt: project?.prompt, steps: project?.steps.map((s) => ({ kind: s.kind, status: s.status, options: s.options })), log: project?.log }, null, 2)
      : `Mock ${f.format.toUpperCase()} placeholder. In live mode this file comes from Aholo multi-format export.`;
    download(new Blob([body], { type: "text/plain" }), f.format === "zip" ? "project-manifest.json" : f.name + ".txt");
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-[1440px] flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl text-lg font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>A</div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Aholo Creator Copilot</h1>
            <p className="muted text-xs">From a product idea to an export-ready 3D asset.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-full border p-1" style={{ borderColor: "var(--line)", background: "var(--panel)" }} role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.id} title={t.label} aria-label={`${t.label} theme`} onClick={() => setTheme(t.id)}
                className="h-6 w-6 rounded-full" style={{ background: t.dot, outline: theme === t.id ? "2px solid var(--text)" : "none", outlineOffset: 2 }} />
            ))}
          </div>
          {wf.mode === "live"
            ? <span className="chip" title={wf.liveNote || "Connected"} style={{ color: wf.liveNote ? "var(--warn)" : "var(--ok)" }}>LIVE · Aholo API{wf.liveNote ? " ⚠" : ""}</span>
            : wf.mode === "replay"
              ? <span className="chip" title="Plays back a recorded real Aholo run. No credits used." style={{ color: "var(--accent)" }}>DEMO REPLAY · recorded Aholo run</span>
              : <span className="chip" style={{ color: "var(--warn)" }}>MOCK · simulated Aholo API</span>}
          {project && <button onClick={wf.reset} className="btn">New project</button>}
        </div>
      </header>

      <div className="grid flex-1 gap-4 lg:grid-cols-[380px_1fr_330px]">
        <section className="panel flex flex-col gap-4 p-5">
          {!project ? (
            <>
              <div>
                <h2 className="font-semibold">Describe your product</h2>
                <p className="muted mt-1 text-xs">The Copilot turns this into a production plan you can review.</p>
              </div>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={7}
                className="card p-3 text-sm outline-none focus:ring-2" style={{ ["--tw-ring-color" as string]: "var(--accent)" }} />
              <div>
                <div className="muted mb-2 text-xs font-medium uppercase tracking-wide">Reference image</div>
                <div className="card flex items-center gap-3 p-3">
                  {refUrl
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={refUrl} alt="reference" className="h-20 w-14 rounded-md object-cover" style={{ border: "1px solid var(--line)" }} />
                    : <div className="muted grid h-20 w-14 place-items-center rounded-md text-center text-[10px]" style={{ border: "1px dashed var(--line)" }}>No photo</div>}
                  <div className="flex flex-col gap-2 text-xs">
                    <span className="muted">Optional. Without a photo the model is generated from your text.</span>
                    {refFile && <button onClick={() => { setRefName(undefined); setRefFile(null); setRefUrl(""); }} className="btn !py-1.5 !text-xs">Remove photo</button>}
                    <input type="file" accept="image/*" className="w-44 text-[11px]" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setRefName(f.name); setRefFile(f); setRefUrl(URL.createObjectURL(f)); } }} />
                  </div>
                </div>
              </div>
              <button onClick={() => wf.createPlan(prompt, refName, refFile)} disabled={!prompt.trim()} className="btn btn-primary disabled:opacity-40">Create production plan</button>
            </>
          ) : (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="font-semibold">{project.approved ? "Production workflow" : "Review the plan"}</h2>
                  <p className="muted mt-1 line-clamp-2 text-xs">{project.prompt}</p>
                </div>
                <span className="chip muted shrink-0">{doneCount}/{project.steps.length}</span>
              </div>
              <ol className="relative flex flex-col gap-3">
                {project.steps.map((s, i) => {
                  // done/skipped steps count as complete; the running step shows its live progress
                  const pct = s.status === "done" || s.status === "skipped" ? 100 : s.status === "running" ? s.progress : 0;
                  const lit = s.status === "running" || s.status === "done";
                  return (
                  <li key={s.id} className="relative flex gap-3">
                    {i < project.steps.length - 1 && (
                      // connector to the next step, filled by this step's progress
                      <span className="absolute left-[17px] top-9 -bottom-3 w-0.5 -translate-x-1/4 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                        <span className="rail-fill absolute inset-x-0 top-0 rounded-full" style={{ height: `${pct}%`, background: "var(--progress)" }} />
                      </span>
                    )}
                    <div className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${s.status === "running" ? "rail-running" : ""}`}
                      style={{ background: "var(--panel)", border: `2px solid ${lit ? "var(--line)" : STATUS_COLOR[s.status]}`, color: lit ? "var(--progress)" : STATUS_COLOR[s.status] }}
                      role={s.status === "running" ? "progressbar" : undefined} aria-valuenow={s.status === "running" ? s.progress : undefined} aria-valuemin={0} aria-valuemax={100}>
                      {lit && (
                        <svg className="pointer-events-none absolute -inset-0.5 -rotate-90" viewBox="0 0 36 36" aria-hidden>
                          <circle cx="18" cy="18" r="17" fill="none" stroke="var(--progress)" strokeWidth="2" strokeLinecap="round"
                            className="rail-ring" strokeDasharray={RING} strokeDashoffset={RING * (1 - pct / 100)} />
                        </svg>
                      )}
                      {s.status === "running"
                        ? <span className="text-[10px] font-bold tabular-nums">{Math.round(s.progress)}%</span>
                        : s.status === "done" ? "✓" : s.status === "failed" ? "!" : KIND_ICON[s.kind]}
                    </div>
                    <div className="card flex-1 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{i + 1}. {s.title}</span>
                        <span className="chip" style={{ color: STATUS_COLOR[s.status] }}>{s.status}{s.status === "running" && s.runStartedAt ? <> · <Elapsed since={s.runStartedAt} /></> : ""}{s.attempts > 1 ? ` · try ${s.attempts}` : ""}</span>
                      </div>
                      <p className="muted mt-1 text-xs">{s.description}</p>
                      {s.kind === "material" && !project.approved && (
                        <div className="mt-2 flex flex-col gap-1.5">
                          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Finish">
                            {PICKER_PRESETS.map((k) => { const v = FINISH_PRESETS[k]; return (
                              <button key={k} title={v.label} aria-label={v.label} role="radio" aria-checked={s.options.finish === k} onClick={() => wf.editStep(s.id, { finish: k })}
                                className="h-7 w-7 rounded-full" style={{ background: `linear-gradient(135deg, ${v.color}, ${v.accent})`, outline: s.options.finish === k ? "2px solid var(--accent)" : "1px solid var(--line)", outlineOffset: 2 }} />
                            ); })}
                            {s.options.finish && !FINISH_PRESETS[s.options.finish] && (
                              <span title={finishLabel(s.options.finish)} className="h-7 w-7 rounded-full" style={{ background: `linear-gradient(135deg, ${resolveFinish(s.options.finish).color}, ${resolveFinish(s.options.finish).accent})`, outline: "2px solid var(--accent)", outlineOffset: 2 }} />
                            )}
                          </div>
                          <span className="muted text-xs">{finishLabel(s.options.finish)} · or ask the Copilot for any finish (e.g. "brushed copper", "terracotta")</span>
                        </div>
                      )}
                      {(s.status === "running" || s.status === "done") && (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                          <div className="h-full transition-all" style={{ width: `${s.progress}%`, background: s.status === "done" ? "var(--ok)" : "var(--accent)" }} />
                        </div>
                      )}
                      {s.error && <p className="mt-2 break-words text-xs" style={{ color: "var(--bad)" }}>{s.error}</p>}
                      {s.status === "failed" && !wf.running && s.kind !== "generate" && <button onClick={() => wf.skipStep(s.id)} className="muted mt-1 text-[11px] underline">Skip this step</button>}
                      {!project.approved && s.kind !== "generate" && (
                        <button onClick={() => wf.removeStep(s.id)} className="muted mt-2 text-[11px] hover:underline">Remove step</button>
                      )}
                    </div>
                  </li>
                  );
                })}
              </ol>
              {!project.approved && wf.mode === "replay" && (
                <p className="card p-2 text-xs" style={{ borderColor: "var(--accent)" }}>Demo replay: this plays back a real Aholo Lux3D run recorded on 16 Nov 2026 (a carved sculpture). No credits are used, and the results shown are the recorded ones whatever the brief. Add an Aholo API key to run your own product.</p>
              )}
              {!project.approved && wf.mode === "live" && (
                <p className="card p-2 text-xs" style={{ borderColor: "var(--warn)" }}>Live mode: running this plan calls the Aholo API and uses your credits. {!refFile && "No reference photo uploaded, so the model will be generated from your text."}{wf.liveNote && ` Connection issue: ${wf.liveNote}`}</p>
              )}
              {!project.approved && <button onClick={wf.run} className="btn btn-ok">Approve &amp; run</button>}
              {failed && !wf.running && <button onClick={wf.retry} className="btn btn-warn">Retry failed step (keeps completed work)</button>}
              {project.approved && (
                <div className="mt-1 flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--line)" }}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Talk to the Copilot</h3>
                    {project.language && <span className="chip muted">{languageName(project.language)}</span>}
                  </div>
                  {project.chat.slice(-6).map((m, i) => (
                    <div key={i} className="card p-2 text-xs" style={m.role === "copilot" ? { borderColor: "var(--accent)" } : undefined}>
                      <span className="muted">{m.role === "user" ? "You" : "Copilot"}: </span>{m.text}
                    </div>
                  ))}
                  {wf.thinking && <div className="card animate-pulse p-2 text-xs" style={{ borderColor: "var(--accent)" }}><span className="muted">Copilot: </span>thinking…</div>}
                  {wf.running && !wf.thinking && <p className="muted text-[11px]">A run is in progress: ask anything, and changes you request are applied when it finishes.</p>}
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = chat.trim(); if (t && !wf.thinking) { setChat(""); send(t, false); } }}>
                    {voice.supported && (
                      <button type="button" disabled={wf.thinking} onClick={() => (voice.listening ? voice.stop() : voice.start(voiceLang))}
                        aria-label={voice.listening ? "Stop listening" : "Speak a change"} title={voice.listening ? "Stop" : "Speak a change"}
                        className={`btn grid h-10 w-10 shrink-0 place-items-center !p-0 ${voice.listening ? "animate-pulse" : ""}`}
                        style={voice.listening ? { background: "var(--bad)", color: "#fff", borderColor: "transparent" } : undefined}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                      </button>
                    )}
                    <input value={voice.listening ? voice.interim : chat} onChange={(e) => setChat(e.target.value)} disabled={wf.thinking} aria-label="Talk to the Copilot"
                      placeholder={voice.listening ? "Listening…" : "Ask or request a change, any language"} className="card min-w-0 flex-1 px-3 py-2 text-sm outline-none" />
                    <button className="btn btn-primary" disabled={wf.thinking || !chat.trim()}>Send</button>
                  </form>
                  {voice.supported && (
                    <select value={voiceLang} onChange={(e) => setVoiceLang(e.target.value)} aria-label="Voice language" className="card px-2 py-1.5 text-xs">
                      {VOICE_LANGS.map((l) => <option key={l.code} value={l.code}>Voice: {l.label}</option>)}
                    </select>
                  )}
                  {voice.error && <p className="text-xs" style={{ color: "var(--bad)" }}>{voice.error}</p>}
                  {!voice.supported && <p className="muted text-[11px]">Voice input needs Chrome, Edge or Safari. You can still type in any language.</p>}
                </div>
              )}
            </>
          )}
        </section>

        <section className="panel relative min-h-[480px] overflow-hidden" style={{ background: "var(--viewer)" }}>
          {shown && shown.stage !== "none" ? (
            <Viewer model={shown} bg={viewerBg} />
          ) : (
            <div className="grid h-full place-items-center p-8 text-center">
              <div>
                <svg width="120" height="120" viewBox="0 0 120 120" className="mx-auto" aria-hidden="true" fill="none" stroke="var(--line)" strokeWidth="2" strokeLinejoin="round">
                  {/* generic 3D cube: the product can be anything */}
                  <path d="M60 14 102 37v46L60 106 18 83V37Z" strokeDasharray="6 5" />
                  <path d="M18 37 60 60l42-23M60 60v46" strokeDasharray="6 5" />
                </svg>
                <p className="mt-4 text-sm font-medium">Your 3D model will appear here</p>
                <p className="muted mt-1 text-xs">Approve the plan to start generating.</p>
              </div>
            </div>
          )}
          {project && project.model.stage !== "none" && (
            <>
              <div className="absolute left-4 top-4 flex gap-2">
                {(["processed", "original"] as const).filter((v) => v === "processed" || project.model.stage !== "generated").map((v) => (
                  <button key={v} onClick={() => setView(v)} data-on={view === v} className="pill">{v === "processed" ? "Processed" : "Original"}</button>
                ))}
                {project.model.stage === "split" && view === "processed" && (
                  <button onClick={() => wf.setExploded(!project.model.exploded)} data-on={project.model.exploded} className="pill">{project.model.exploded ? "Assemble" : "Explode components"}</button>
                )}
              </div>
              <span className="pill absolute right-4 top-4">Stage: {project.model.stage}</span>
              <span className="pill absolute bottom-4 left-4 !font-normal">Drag to rotate · scroll to zoom</span>
              {!project.model.modelUrl && <span className="pill absolute bottom-4 right-4">{finishLabel(view === "original" ? "titanium" : project.model.finish)}</span>}
            </>
          )}
        </section>

        <section className="panel flex flex-col gap-4 p-5">
          <h2 className="font-semibold">Export centre</h2>
          {project?.files.length ? (
            <ul className="flex flex-col gap-2">
              {project.files.map((f) => (
                <li key={f.id} className="card flex items-center gap-3 p-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg text-[10px] font-bold uppercase" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{f.format}</span>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm">{f.name}</div><div className="muted text-[11px] leading-tight">{f.note}</div></div>
                  <button onClick={() => downloadFile(f)} disabled={building === f.id} className="btn !px-2.5 !py-1.5 !text-xs disabled:opacity-60" aria-label={`Download ${f.name}`}>{building === f.id ? "…" : "↓"}</button>
                </li>
              ))}
            </ul>
          ) : <p className="muted card p-3 text-xs">Files appear here once the export step completes.</p>}
          <h2 className="mt-1 font-semibold">Activity</h2>
          <ul className="max-h-80 space-y-2 overflow-auto text-[12px]">
            {[...(project?.log ?? [])].reverse().map((l, i) => (
              <li key={i} className="flex gap-2"><span className="muted shrink-0 tabular-nums">{new Date(l.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><span>{l.msg}</span></li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
