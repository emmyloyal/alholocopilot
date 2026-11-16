import { encodeCustom } from "../finish";
import type { AholoClient, TaskHandle, TaskResult } from "./client";

/**
 * Demo replay: plays back a REAL recorded Aholo Lux3D run (files in /public/demo, recorded 2026-11-16)
 * with shortened timings. Used when no AHOLO_API_KEY is set, or forced with ?replay=1 as a safety net
 * for live demos. It spends no credits, and the UI labels it as a replay; nothing here is simulated geometry.
 */
export const DEMO_FINISH = encodeCustom({ label: "Sandstone", color: "#b6ac97", accent: "#6f6656", kind: "stone" });

export const DEMO_BRIEF =
  "A carved decorative sculpture for our home-décor store. Turn it into a 3D model for the product page, give it a sandstone finish, and separate its main parts so customers can inspect it.";

const RECORDING: Record<TaskHandle["kind"], { ms: number; result: TaskResult }> = {
  generate: { ms: 9000, result: { modelUrl: "/demo/generated.glb", files: [{ format: "glb", url: "/demo/generated.glb" }] } },
  material: { ms: 7000, result: { modelUrl: "/demo/material.glb", files: [{ format: "glb", url: "/demo/material.glb" }] } },
  split: { ms: 8000, result: { modelUrl: "/demo/parts.glb", files: [{ format: "glb", url: "/demo/parts.glb" }] } },
  export: { ms: 4000, result: { files: [{ format: "usdz", url: "/demo/model.usdz" }] } },
};

export function createReplayClient(): AholoClient {
  let n = 0;
  const start = (kind: TaskHandle["kind"]): TaskHandle => ({ taskId: `replay_${kind}_${++n}`, kind, startedAt: Date.now() });
  return {
    mode: "replay",
    pollIntervalMs: 400,
    async imageToModel() { return start("generate"); },
    async materialTransfer() { return start("material"); },
    async splitParts() { return start("split"); },
    async exportFormats() { return start("export"); },
    async pollTask(h) {
      const { ms, result } = RECORDING[h.kind];
      const frac = Math.min(1, (Date.now() - h.startedAt) / ms);
      return { done: frac >= 1, progress: Math.round(frac * 100), result: frac >= 1 ? result : undefined };
    },
  };
}
