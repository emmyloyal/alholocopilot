export type StepKind = "generate" | "qc" | "material" | "split" | "export";
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface Step {
  id: string;
  kind: StepKind;
  title: string;
  description: string;
  status: StepStatus;
  progress: number; // 0-100
  attempts: number;
  error?: string;
  /** step-specific options, editable in the plan */
  options: Record<string, string>;
  /** when the current attempt started (drives the elapsed-time counter) */
  runStartedAt?: number;
  /** live mode: the Aholo task in flight, kept so a retry or page reload resumes it instead of paying for a new one */
  task?: { id: string; startedAt: number };
}

/** What the viewer needs to render a model. In real mode this becomes GLB URLs. */
export interface ModelState {
  /** a preset key or a custom finish string (see lib/finish.ts) */
  finish: string;
  exploded: boolean;
  stage: "none" | "generated" | "material" | "split";
  /** live mode: URL of the latest GLB returned by Aholo */
  modelUrl?: string;
  /** live mode: the model before part splitting. Aholo export (and re-splitting) reject the split GLB, so they use this. */
  baseModelUrl?: string;
  /** live/replay: the model exactly as first generated, for the "Original" view */
  originalModelUrl?: string;
}

export interface ExportFile {
  id: string;
  name: string;
  format: "glb" | "usdz" | "obj" | "zip";
  note: string;
  /** live mode: direct (time-limited) URL */
  url?: string;
  /** built in the browser on download: an exploded copy of the split GLB at this URL */
  explodeFrom?: string;
}

export interface Project {
  id: string;
  prompt: string;
  referenceName?: string;
  /** live mode: Aholo URL of the uploaded reference photo, reused on retry and after a reload */
  referenceUrl?: string;
  steps: Step[];
  approved: boolean;
  model: ModelState;
  files: ExportFile[];
  log: { t: number; msg: string }[];
  chat: { role: "user" | "copilot"; text: string }[];
  language?: string;
}

