"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createMockClient } from "./aholo/mock";
import { createLiveClient } from "./aholo/live";
import { DEMO_FINISH, createReplayClient } from "./aholo/replay";
import { assetUrl } from "./assets";
import { TaskFailedError, type AholoClient, type TaskHandle } from "./aholo/client";
import { interpret, qualityCheck, type QcResult } from "./copilotClient";
import { languageName, type Intent } from "./intent";
import { STEP_ORDER, makeStep, planFromIntent, validatePlan } from "./planner";
import { getSnapshot, waitForRender } from "./exporter";
import type { ExportFile, ModelState, Project, Step } from "./types";

const STORAGE_KEY = "aholo-creator-copilot:project:v2";
/** Consecutive failed status checks tolerated before a step is marked failed (the Aholo task keeps running). */
const MAX_POLL_MISSES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const initialModel: ModelState = { finish: "titanium", exploded: false, stage: "none" };

/** Approximate Aholo credits per step, measured on live runs (2026-11-16). */
const CREDITS: Partial<Record<Step["kind"], number>> = { generate: 1, material: 7, split: 30, export: 1 };
/** Chat changes at or above this cost ask for a "yes" first (in practice: anything that runs a split). */
const CONFIRM_CREDITS = 20;
/** The QC auto-fix regenerates only below this score; borderline results are just reported. */
const QC_REGENERATE_BELOW = 0.5;
/** "yes" in the app's languages. No \b: it does not work after non-Latin letters. */
const YES = /^\s*(yes|y|yeah|yep|ok|okay|sure|go|go ahead|do it|confirm|s[ií]|oui|ja|sim|da|да|是|好|はい|네|예|نعم|हाँ|haan|evet|tamam)(?=[\s.!,]|$)/i;

/**
 * Downloads for a Part Split result. Aholo stores the parts in their assembled positions, so the raw file
 * looks whole in every viewer; "model-parts.glb" is therefore the separated copy built in the browser.
 */
export function splitFiles(splitUrl: string, via: string): ExportFile[] {
  return [
    { id: "exploded", name: "model-parts.glb", format: "glb", note: "Parts pushed apart and named Part 1, Part 2…: opens separated in any 3D viewer (built in your browser)", explodeFrom: assetUrl(splitUrl) },
    { id: "parts", name: "model-parts-in-place.glb", format: "glb", note: `Same parts in their assembled positions, to move yourself in Blender or a configurator (${via} part split)`, url: assetUrl(splitUrl) },
  ];
}

/** What a chat change would do to the plan, without applying it. null = nothing to re-run. */
function planChange(p: Project, intent: Intent): { steps: Step[]; credits: number; rerun: string[] } | null {
  let earliest = Infinity;
  let steps = [...p.steps];
  const ensure = (kind: Step["kind"], opts: Record<string, string> = {}) => {
    let s = steps.find((k) => k.kind === kind);
    if (!s) { s = makeStep(kind, opts); steps.push(s); earliest = Math.min(earliest, STEP_ORDER.indexOf(kind)); }
    return s;
  };
  if (intent.regenerate) earliest = 0;
  if (intent.finish) {
    const s = ensure("material", { finish: intent.finish });
    steps = steps.map((x) => (x.id === s.id ? { ...x, options: { ...x.options, finish: intent.finish! }, task: undefined } : x));
    earliest = Math.min(earliest, STEP_ORDER.indexOf("material"));
  }
  if (intent.split) ensure("split");
  if (earliest === Infinity) return null;
  steps = validatePlan(steps).map((x) =>
    STEP_ORDER.indexOf(x.kind) >= earliest ? { ...x, status: "pending" as const, progress: 0, error: undefined, task: undefined } : x);
  const affected = steps.filter((x) => STEP_ORDER.indexOf(x.kind) >= earliest);
  return { steps, credits: affected.reduce((n, x) => n + (CREDITS[x.kind] ?? 0), 0), rerun: affected.map((x) => x.title) };
}

/** Compact project summary so the AI can answer questions about it. */
function projectContext(p: Project, mode: string, running: boolean): string {
  return [
    `Brief: ${p.prompt}`,
    `Mode: ${mode === "live" ? "live (real Aholo, uses credits)" : mode === "replay" ? "demo replay of a recorded real Aholo run (no credits; results are the recorded ones)" : "mock (simulated)"}; a run is ${running ? "in progress" : "not running"}`,
    `Model: stage ${p.model.stage}, finish ${p.model.finish}, exploded view ${p.model.exploded ? "on" : "off"}`,
    "Steps:",
    ...p.steps.map((s, i) => `${i + 1}. ${s.title} (${s.kind}) — ${s.status}${s.attempts > 1 ? `, ${s.attempts} attempts` : ""}${s.error ? ` — error: ${s.error}` : ""}`),
    `Export files ready: ${p.files.length ? p.files.map((f) => f.name).join(", ") : "none"}`,
    "Recent activity (oldest first):",
    ...p.log.slice(-8).map((l) => `- ${l.msg}`),
  ].join("\n");
}

export function useWorkflow() {
  const [project, setProject] = useState<Project | null>(null);
  const [running, setRunning] = useState(false);
  const ref = useRef<Project | null>(null);
  const client = useRef<AholoClient>(createReplayClient());
  const refFile = useRef<File | null>(null);
  const [mode, setMode] = useState<AholoClient["mode"]>("replay");
  const [liveNote, setLiveNote] = useState<string>("");
  const runToken = useRef(0);
  const qcRuns = useRef(0);
  const lastQc = useRef<QcResult | null>(null);
  const autoFixed = useRef(false);
  // chat: running mirror for async callbacks, changes queued during a run, a change awaiting "yes"
  const runningRef = useRef(false);
  const queued = useRef<Intent[]>([]);
  const applyRef = useRef<(i: Intent) => Promise<void>>(async () => {});
  const pendingConfirm = useRef<Intent | null>(null);
  const [thinking, setThinking] = useState(false);
  const setRunningBoth = (v: boolean) => { runningRef.current = v; setRunning(v); };

  const commit = useCallback((fn: (p: Project) => Project) => {
    if (!ref.current) return;
    ref.current = fn(ref.current);
    setProject(ref.current);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ref.current)); } catch {}
  }, []);

  useEffect(() => {
    // ?mock=1: offline simulation. ?replay=1: recorded real run even when a key is set (demo safety net).
    // No key: replay. Key: live.
    const q = new URLSearchParams(location.search);
    if (q.has("mock")) { client.current = createMockClient(); setMode("mock"); return; }
    if (q.has("replay")) return;
    fetch("/api/aholo/health").then((r) => r.json()).then((h) => {
      if (h.live) {
        client.current = createLiveClient();
        setMode("live");
        setLiveNote(h.ok ? "" : h.message ?? "Could not reach Aholo");
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Project;
        p.steps = p.steps.map((s) => (s.status === "running" ? { ...s, status: "pending", progress: 0 } : s));
        p.chat = p.chat ?? [];
        ref.current = p;
        setProject(p);
      }
    } catch {}
  }, []);

  const log = (msg: string) => (p: Project): Project => ({ ...p, log: [...p.log, { t: Date.now(), msg }] });
  const patchStep = (id: string, patch: Partial<Step>) => (p: Project): Project => ({
    ...p, steps: p.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  });
  const fresh = (kind: Step["kind"]) => ref.current!.steps.find((s) => s.kind === kind)!;

  const createPlan = useCallback(async (prompt: string, referenceName?: string, file?: File | null) => {
    runToken.current++;
    refFile.current = file ?? null;
    qcRuns.current = 0; autoFixed.current = false; lastQc.current = null;
    const intent = await interpret(prompt);
    const p: Project = {
      id: Math.random().toString(36).slice(2, 8), prompt, referenceName,
      // replay plays back the recorded sandstone result, so the plan says so
      steps: planFromIntent(intent).map((s) => (client.current.mode === "replay" && s.kind === "material" ? { ...s, options: { ...s.options, finish: DEMO_FINISH } } : s)),
      approved: false, model: initialModel, files: [], chat: [],
      language: intent.language,
      log: [{ t: Date.now(), msg: `Understood your request (${languageName(intent.language)}, ${intent.source === "llm" ? "AI" : "built-in lexicon"}). Plan created.` }],
    };
    ref.current = p;
    setProject(p);
    setRunningBoth(false);
  }, []);

  const editStep = useCallback((id: string, options: Record<string, string>) => {
    commit((p) => ({ ...p, steps: p.steps.map((s) => (s.id === id ? { ...s, options: { ...s.options, ...options }, task: undefined } : s)) }));
  }, [commit]);

  const removeStep = useCallback((id: string) => {
    commit((p) => ({ ...p, steps: validatePlan(p.steps.filter((s) => s.id !== id || s.kind === "generate")) }));
  }, [commit]);

  const runStep = async (step: Step): Promise<boolean> => {
    const c = client.current;
    commit(patchStep(step.id, { status: "running", progress: 0, error: undefined, attempts: step.attempts + 1, runStartedAt: step.task?.startedAt ?? Date.now() }));
    commit(log(`${step.title}: started${step.attempts ? ` (attempt ${step.attempts + 1})` : ""}`));
    try {
      if (step.kind === "qc") {
        await sleep(500); commit(patchStep(step.id, { progress: 30 }));
        // Judge what is actually on screen: wait until the viewer has drawn the new (15-20 MB) model.
        const shownUrl = ref.current?.model.modelUrl;
        if (shownUrl && c.mode !== "mock") {
          commit(log("Quality check: waiting for the model to finish loading in the viewer"));
          if (!(await waitForRender(shownUrl, 120_000))) {
            lastQc.current = null;
            commit(patchStep(step.id, { status: "skipped", progress: 100 }));
            commit(log("Quality check skipped: the model did not finish loading in the viewer within 2 minutes (slow download). Nothing was regenerated."));
            return true;
          }
          await sleep(600); // let the camera settle
        }
        commit(patchStep(step.id, { progress: 80 }));
        const r = await qualityCheck(getSnapshot(), qcRuns.current++, c.mode === "mock", ref.current?.prompt ?? "");
        if (!r) {
          lastQc.current = null;
          commit(patchStep(step.id, { status: "skipped", progress: 100 }));
          commit(log("Quality check skipped: AI vision is unavailable (set GEMINI_API_KEY) or did not answer. No simulated checks outside mock mode, so nothing is regenerated by guesswork."));
          return true;
        }
        lastQc.current = r;
        commit(log(`Quality check${r.simulated ? " (simulated)" : ""}: score ${Math.round(r.score * 100)}%${r.issues.length ? ` — ${r.issues.join("; ")}` : " — looks good"}`));
      } else {
        // Later steps work on the assembled model: Aholo export fails on the split (multi-part) GLB.
        const meshUrl = ref.current?.model.baseModelUrl ?? ref.current?.model.modelUrl;
        const kind = step.kind as TaskHandle["kind"];
        // Live mode: an Aholo task still in flight from an earlier attempt (or before a page reload) is resumed, not re-bought.
        const saved = c.mode === "live" ? step.task : undefined;
        if (c.mode === "live" && step.kind === "export" && ref.current?.model.stage === "split" && !ref.current.model.baseModelUrl) {
          // Projects split before baseModelUrl existed only have the split GLB, which Aholo export rejects.
          throw new Error("This project was split before the export fix, so the assembled model Aholo needs for export isn't recorded. Start a new project, or skip this step");
        }
        const handle: TaskHandle = saved ? { taskId: saved.id, kind, startedAt: saved.startedAt }
          : step.kind === "generate" ? await c.imageToModel({ image: refFile.current, imageUrl: ref.current?.referenceUrl, imageName: ref.current?.referenceName, prompt: ref.current?.prompt ?? "" })
          : step.kind === "material" ? await c.materialTransfer({ finish: step.options.finish ?? "graphite", meshUrl })
          : step.kind === "split" ? await c.splitParts({ meshUrl })
          : await c.exportFormats({ meshUrl, formats: (step.options.formats || "glb").split(",").filter((f) => f !== "glb") });
        if (handle.imageUrl) commit((p) => ({ ...p, referenceUrl: handle.imageUrl }));
        if (c.mode === "live") commit(patchStep(step.id, { task: { id: handle.taskId, startedAt: handle.startedAt }, runStartedAt: handle.startedAt }));
        commit(log(`${step.title}: ${saved ? "resuming" : ""} Aholo task ${handle.taskId}`.replace(":  ", ": ")));
        let misses = 0;
        for (;;) {
          await sleep(c.pollIntervalMs);
          let s: Awaited<ReturnType<AholoClient["pollTask"]>>;
          try {
            s = await c.pollTask(handle);
            misses = 0;
          } catch (e) {
            // Only Aholo saying "failed" is final. A failed status check (network blip, dev-server reload) is retried.
            if (e instanceof TaskFailedError || ++misses >= MAX_POLL_MISSES) throw e;
            commit(log(`${step.title}: status check failed (${misses}/${MAX_POLL_MISSES}), still waiting on task ${handle.taskId}`));
            continue;
          }
          commit(patchStep(step.id, { progress: s.progress }));
          if (!s.done) continue;
          const r = s.result ?? {};
          if (step.kind === "export") {
            const real = c.mode !== "mock"; // live and replay both carry real Aholo files
            const via = c.mode === "replay" ? "Recorded Aholo run" : "Aholo";
            const fmts = (step.options.formats || "glb").split(",");
            const files: ExportFile[] = real
              ? [
                  ...(meshUrl ? [{ id: "glb", name: "model.glb", format: "glb" as const, note: `Assembled model (${via})`, url: assetUrl(meshUrl) }] : []),
                  ...(ref.current?.model.baseModelUrl && ref.current.model.modelUrl ? splitFiles(ref.current.model.modelUrl, via) : []),
                  ...(r.files ?? []).map((f, i) => ({ id: `f${i}`, name: `model.${f.format}`, format: (["usdz", "obj", "zip", "glb"].includes(f.format) ? f.format : "zip") as ExportFile["format"], note: c.mode === "replay" ? `${f.format.toUpperCase()} from the recorded Aholo export` : `Aholo export (${f.format}) — link expires in about 2 hours`, url: assetUrl(f.url) })),
                ]
              : [
                  ...fmts.map((f) => ({ id: f, name: `model.${f}`, format: f as ExportFile["format"], note: f === "glb" ? "Real GLB exported from the viewer scene" : "Mock placeholder (live mode: Aholo multi-format export)" })),
                  { id: "pkg", name: "project-package.zip", format: "zip" as const, note: "Plan, task log and outputs (mock manifest)" },
                ];
            commit((p) => ({ ...p, files }));
          } else {
            const stage = step.kind === "generate" ? "generated" : step.kind === "material" ? "material" : "split";
            commit((p) => ({ ...p, model: { ...p.model, ...(r.patch ?? {}), ...(c.mode !== "mock" ? {
              stage, modelUrl: r.modelUrl ?? p.model.modelUrl,
              ...(stage === "material" ? { finish: step.options.finish ?? p.model.finish } : {}),
              // show the result of Part Split straight away: parts start apart ("Assemble" puts them back)
              ...(stage === "split" ? { exploded: true } : {}),
              originalModelUrl: stage === "generated" ? (r.modelUrl ?? p.model.modelUrl) : p.model.originalModelUrl,
              // keep the pre-split model for export; any new generate/material result replaces it
              baseModelUrl: stage === "split" ? (p.model.baseModelUrl ?? p.model.modelUrl) : undefined,
            } : {}) } }));
          }
          break;
        }
      }
      commit(patchStep(step.id, { status: "done", progress: 100, task: undefined }));
      commit(log(`${step.title}: done`));
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A task Aholo failed must be re-created on retry; otherwise keep it so retry resumes the same (paid) task.
      const final = e instanceof TaskFailedError || !ref.current?.steps.find((x) => x.id === step.id)?.task;
      commit(patchStep(step.id, { status: "failed", error: msg, ...(final ? { task: undefined } : {}) }));
      commit(log(`${step.title}: FAILED — ${msg}. ${final ? "Completed steps are preserved; retry just this step." : "The Aholo task may still be running: Retry resumes it at no extra cost."}`));
      return false;
    }
  };

  /** Runs every not-yet-done step in order; stops at the first failure. */
  const run = useCallback(async () => {
    if (!ref.current) return;
    const token = ++runToken.current;
    commit((p) => ({ ...p, approved: true }));
    setRunningBoth(true);
    for (const s of [...ref.current.steps]) {
      if (token !== runToken.current) return;
      const cur = ref.current!.steps.find((x) => x.id === s.id);
      if (!cur || cur.status === "done" || cur.status === "skipped") continue;
      if (!(await runStep(cur))) break;

      // quality check clearly failed -> auto-fix once by regenerating, then re-check.
      // Borderline scores (>= 50%) are reported but not acted on: a regeneration costs credits and minutes.
      if (cur.kind === "qc" && lastQc.current && !lastQc.current.pass && lastQc.current.score >= QC_REGENERATE_BELOW) {
        commit(log(`Quality check flagged issues at ${Math.round(lastQc.current.score * 100)}% (borderline), so not regenerating. Ask the Copilot to "regenerate" if you want another attempt.`));
      }
      if (cur.kind === "qc" && lastQc.current && !lastQc.current.pass && lastQc.current.score < QC_REGENERATE_BELOW && !autoFixed.current) {
        autoFixed.current = true;
        commit(log("Auto-fix: regenerating with higher detail, then re-checking."));
        if (!(await runStep(fresh("generate")))) break;
        if (!(await runStep(fresh("qc")))) break;
      }
    }
    if (token === runToken.current) {
      setRunningBoth(false);
      // chat changes that arrived during the run are applied now, in order
      const next = queued.current.shift();
      if (next) void applyRef.current(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = (text: string) => commit((p) => ({ ...p, chat: [...p.chat, { role: "copilot", text }] }));

  /** Applies a chat change now: re-plans the affected steps and runs them. */
  const applyIntent = async (intent: Intent) => {
    if (!ref.current) return;
    const change = planChange(ref.current, intent);
    if (!change) {
      if (intent.explode !== undefined || intent.split) commit((p) => ({ ...p, model: { ...p.model, exploded: intent.explode ?? true } }));
      return;
    }
    commit((p) => ({ ...p, steps: change.steps, files: [], model: { ...p.model, exploded: intent.explode === true } }));
    if (intent.regenerate) { qcRuns.current = 0; autoFixed.current = false; }
    await run();
  };
  applyRef.current = applyIntent;

  /** Applies now, or queues it when a run is in progress. */
  const applyOrQueue = async (intent: Intent) => {
    if (runningRef.current) {
      queued.current.push(intent);
      say("I'll apply this as soon as the current run finishes.");
      return;
    }
    await applyIntent(intent);
  };

  /** Chat in any language: answers questions, applies (or queues) changes, confirms expensive ones first. */
  const sendChat = useCallback(async (text: string): Promise<{ reply: string; language: string } | undefined> => {
    if (!ref.current || !text.trim()) return undefined;
    commit((p) => ({ ...p, chat: [...p.chat, { role: "user", text }] }));

    // answer to "this costs ~N credits, go ahead?"
    const pending = pendingConfirm.current;
    pendingConfirm.current = null;
    if (pending && YES.test(text)) {
      say("Going ahead.");
      void applyOrQueue(pending);
      return { reply: "Going ahead.", language: pending.language };
    }

    setThinking(true);
    let intent: Intent;
    try { intent = await interpret(text, projectContext(ref.current!, client.current.mode, runningRef.current)); }
    finally { setThinking(false); }
    if (client.current.mode === "replay" && intent.finish && intent.finish !== DEMO_FINISH) {
      // a replay can only show what was recorded; say so instead of labelling sandstone as something else
      intent = { ...intent, finish: DEMO_FINISH, reply: `${intent.reply} (Demo replay: this plays back the recorded sandstone finish. Add an Aholo key to apply new finishes for real.)` };
    }
    commit((p) => ({ ...p, language: intent.language, chat: [...p.chat, { role: "copilot", text: intent.reply || "Sorry, I didn't catch that. Try \"make it gold\" or ask me about the project." }] }));
    commit(log(`Chat (${languageName(intent.language)}, ${intent.source === "llm" ? "AI" : "lexicon"}): "${text}"`));

    const change = planChange(ref.current!, intent);
    if (change && client.current.mode === "live" && change.credits >= CONFIRM_CREDITS) {
      pendingConfirm.current = intent;
      const q = `That re-runs ${change.rerun.join(" → ")} and uses about ${change.credits} Aholo credits. Reply "yes" to go ahead.`;
      say(q);
      return { reply: `${intent.reply} ${q}`, language: intent.language };
    }
    void applyOrQueue(intent);
    return { reply: intent.reply, language: intent.language };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, run]);

  const retry = useCallback(() => run(), [run]);
  const skipStep = useCallback((id: string) => {
    commit(patchStep(id, { status: "skipped", error: undefined }));
    commit(log("Step skipped by you."));
    run();
  }, [commit, run]);
  const setExploded = useCallback((exploded: boolean) => commit((p) => ({ ...p, model: { ...p.model, exploded } })), [commit]);
  const reset = useCallback(() => {
    runToken.current++; ref.current = null; setProject(null); setRunningBoth(false); queued.current = []; pendingConfirm.current = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  return { project, running, thinking, mode, liveNote, createPlan, editStep, removeStep, run, retry, skipStep, sendChat, setExploded, reset };
}
