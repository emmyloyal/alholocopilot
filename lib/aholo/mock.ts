import { TaskFailedError, type AholoClient, type TaskHandle, type TaskResult } from "./client";
import type { ModelState } from "../types";

interface MockTask { startedAt: number; durationMs: number; result: TaskResult; failOnce: boolean }

/** Mock Aholo: used when no AHOLO_API_KEY is configured. The material step fails once to show retry. */
export function createMockClient(opts: { failMaterialOnce?: boolean } = { failMaterialOnce: true }): AholoClient {
  const tasks = new Map<string, MockTask>();
  let n = 0;
  let materialFailed = false;

  const start = (kind: TaskHandle["kind"], durationMs: number, result: TaskResult, failOnce = false): TaskHandle => {
    const taskId = `mock_${++n}`;
    tasks.set(taskId, { startedAt: Date.now(), durationMs, result, failOnce });
    return { taskId, kind, startedAt: Date.now() };
  };

  return {
    mode: "mock",
    pollIntervalMs: 300,
    async imageToModel() { return start("generate", 4200, { patch: { stage: "generated" } as Partial<ModelState> }); },
    async materialTransfer({ finish }) {
      const shouldFail = !!opts.failMaterialOnce && !materialFailed;
      if (shouldFail) materialFailed = true;
      return start("material", 3200, { patch: { stage: "material", finish: finish as ModelState["finish"] } }, shouldFail);
    },
    async splitParts() { return start("split", 3600, { patch: { stage: "split" } }); },
    async exportFormats({ formats }) {
      return start("export", 1250, { files: formats.map((f) => ({ format: f, url: "" })) });
    },
    async pollTask({ taskId }) {
      const t = tasks.get(taskId);
      if (!t) throw new TaskFailedError(`Unknown task ${taskId}`);
      const frac = Math.min(1, (Date.now() - t.startedAt) / t.durationMs);
      if (t.failOnce && frac > 0.6) throw new TaskFailedError("Material transfer task failed: upstream worker timeout (simulated)");
      return { done: frac >= 1, progress: Math.round(frac * 100), result: frac >= 1 ? t.result : undefined };
    },
  };
}
