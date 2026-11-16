import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { Object3D } from "three";

let target: Object3D | null = null;
export const registerExportTarget = (o: Object3D | null) => { target = o; };

export function exportGLB(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!target) return reject(new Error("No model in the viewer yet"));
    new GLTFExporter().parse(
      target,
      (res) => resolve(new Blob([res as ArrayBuffer], { type: "model/gltf-binary" })),
      (err) => reject(err),
      { binary: true },
    );
  });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

let snapshotFn: (() => string) | null = null;
/** The viewer registers how to capture a JPEG of the current model (see Viewer Capture). */
export const registerSnapshot = (fn: (() => string) | null) => {
  snapshotFn = fn;
  // dev only: lets tests and you inspect exactly what the quality check sends to the AI
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as Record<string, unknown>).__qcSnapshot = getSnapshot;
};
export function getSnapshot(): string | null {
  try { return snapshotFn ? snapshotFn() : null; } catch { return null; }
}

// "This model is on screen" signal. Result GLBs are 15-20 MB, so a snapshot taken when a step finishes
// would show an empty viewer; the quality check waits for this instead.
const rendered = new Set<string>();
const waiters = new Map<string, Array<() => void>>();
export function markRendered(url: string) {
  rendered.add(url);
  waiters.get(url)?.forEach((f) => f());
  waiters.delete(url);
}
/** Resolves true once the viewer has drawn `url`, or false after timeoutMs. */
export function waitForRender(url: string, timeoutMs: number): Promise<boolean> {
  if (rendered.has(url)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => {
      waiters.set(url, (waiters.get(url) ?? []).filter((f) => f !== done));
      resolve(false);
    }, timeoutMs);
    waiters.set(url, [...(waiters.get(url) ?? []), done]);
  });
}
