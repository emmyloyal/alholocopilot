import type { ModelState } from "../types";

/**
 * The seam between the Copilot and Aholo. The mock and the live client both implement it.
 */
export interface TaskHandle {
  taskId: string;
  kind: "generate" | "material" | "split" | "export";
  startedAt: number;
  /** generate only: URL of the uploaded reference image, so callers can reuse it. */
  imageUrl?: string;
}

export interface OutputFile { format: string; url: string }

export interface TaskResult {
  /** live: URL of the produced GLB. */
  modelUrl?: string;
  files?: OutputFile[];
  /** mock: model state patch. */
  patch?: Partial<ModelState>;
}

/** Aholo reported the task itself as failed or cancelled. Retrying must create a new task. */
export class TaskFailedError extends Error {}

export interface AholoClient {
  /** live: real Aholo. replay: a recorded real run (no credits). mock: offline simulation. */
  readonly mode: "mock" | "live" | "replay";
  /** Suggested delay between polls. */
  readonly pollIntervalMs: number;
  /** imageUrl: an already-uploaded reference image (skips the upload). */
  imageToModel(input: { image?: File | null; imageUrl?: string; imageName?: string; prompt: string }): Promise<TaskHandle>;
  materialTransfer(input: { finish: string; meshUrl?: string }): Promise<TaskHandle>;
  splitParts(input: { meshUrl?: string }): Promise<TaskHandle>;
  exportFormats(input: { meshUrl?: string; formats: string[] }): Promise<TaskHandle>;
  /**
   * Poll a task. progress is 0-100. Throws TaskFailedError when the task failed;
   * any other error is a failed status check (network, server restart) and may be retried.
   */
  pollTask(handle: TaskHandle): Promise<{ done: boolean; progress: number; result?: TaskResult }>;
}
