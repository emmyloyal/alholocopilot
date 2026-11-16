import { TaskFailedError, type AholoClient, type OutputFile, type TaskHandle } from "./client";
import { drawSwatch, resolveFinish } from "../finish";

// Image/text-to-3D engine. G1-Turbo is much faster; set NEXT_PUBLIC_AHOLO_GEN_VERSION=G1 for full quality.
const GEN_VERSION = process.env.NEXT_PUBLIC_AHOLO_GEN_VERSION === "G1" ? "G1" : "G1-Turbo";
// G1-Turbo returns only a ZIP unless GLB is requested explicitly (official API spec); the viewer needs the GLB.
const GEN_OUTPUT = ["glb"];
const LOCAL_GLB_ONLY = "local:glb-only";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j as T;
}

async function create(op: string, body: Record<string, unknown>, kind: TaskHandle["kind"]): Promise<TaskHandle> {
  const { taskId } = await api<{ taskId: string }>("/api/aholo/create", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, body }),
  });
  return { taskId, kind, startedAt: Date.now() };
}

async function upload(blob: Blob, name: string): Promise<string> {
  const fd = new FormData();
  fd.set("file", blob, name);
  const { url } = await api<{ url: string }>("/api/aholo/upload", { method: "POST", body: fd });
  return url;
}

/** Material reference image for material transfer: the finish colour with a surface pattern for its kind. */
async function finishSwatch(finish: string): Promise<Blob> {
  const c = drawSwatch(resolveFinish(finish));
  return new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
}

const fmt = (url: string): string => (url.split("?")[0].split(".").pop() || "file").toLowerCase();
const EXPECTED_MS: Record<TaskHandle["kind"], number> = { generate: 150_000, material: 120_000, split: 90_000, export: 40_000 };
const EXPORT_MAP: Record<string, string> = { usdz: "usdz", obj: "obj_zip", fbx: "fbx_zip", stl: "stl", "3mf": "3mf" };

export function createLiveClient(): AholoClient {
  return {
    mode: "live",
    pollIntervalMs: 6000,
    async imageToModel({ image, imageUrl, prompt }) {
      const img = imageUrl ?? (image ? await upload(image, image.name) : undefined);
      if (img) return { ...(await create("image-to-3d", { img, version: GEN_VERSION, outputFormat: GEN_OUTPUT }, "generate")), imageUrl: img };
      return create("text-to-3d", { prompt, version: GEN_VERSION, style: "photorealistic", outputFormat: GEN_OUTPUT }, "generate");
    },
    async materialTransfer({ finish, meshUrl }) {
      if (!meshUrl) throw new Error("No model to apply the finish to");
      const img = await upload(await finishSwatch(finish), "finish-swatch.png");
      return create("material-transfer", { img, meshUrl, version: "v3.0-standard", outputFormat: ["glb"] }, "material");
    },
    async splitParts({ meshUrl }) {
      if (!meshUrl) throw new Error("No model to split");
      return create("part-split", { glbUrl: meshUrl }, "split");
    },
    async exportFormats({ meshUrl, formats }) {
      if (!meshUrl) throw new Error("No model to export");
      const outputFormat = formats.map((f) => EXPORT_MAP[f]).filter(Boolean);
      // GLB is the base result and cannot be requested; with nothing else to convert, skip the paid call.
      if (!outputFormat.length) return { taskId: LOCAL_GLB_ONLY, kind: "export", startedAt: Date.now() };
      return create("export", { modelUrl: meshUrl, outputFormat }, "export");
    },
    async pollTask(h) {
      if (h.taskId === LOCAL_GLB_ONLY) return { done: true, progress: 100, result: { files: [] } };
      const t = await api<{ state: "running" | "done" | "failed"; outputs: string[]; message?: string }>(`/api/aholo/task?id=${encodeURIComponent(h.taskId)}`);
      if (t.state === "failed") throw new TaskFailedError(`Aholo task ${h.taskId} failed${t.message ? `: ${t.message}` : ""}`);
      if (t.state === "running") {
        // Eases toward 95% and never stalls: ~63% at the expected time, ~86% at twice it.
        const pct = Math.round(95 * (1 - Math.exp(-(Date.now() - h.startedAt) / EXPECTED_MS[h.kind])));
        return { done: false, progress: pct };
      }
      const files: OutputFile[] = t.outputs.map((url) => ({ format: fmt(url), url }));
      const glb = files.find((f) => f.format === "glb");
      return { done: true, progress: 100, result: { modelUrl: glb?.url ?? (h.kind === "export" ? undefined : files[0]?.url), files } };
    },
  };
}
