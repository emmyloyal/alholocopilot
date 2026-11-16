import type { Intent } from "./intent";
import type { Step } from "./types";

const uid = () => Math.random().toString(36).slice(2, 8);

export const makeStep = (kind: Step["kind"], options: Record<string, string> = {}): Step => {
  const meta: Record<Step["kind"], [string, string]> = {
    generate: ["Generate 3D model", "Aholo Lux3D builds a textured 3D model from your reference photo and brief."],
    qc: ["Quality check", "AI inspects the model against your brief and regenerates once if it falls short."],
    material: ["Apply finish", "Aholo Material Transfer applies the chosen finish to the model."],
    split: ["Split into parts", "Aholo Part Split separates the model into its main components for an exploded view."],
    export: ["Export & package", "Exports GLB, USDZ (Apple AR) and OBJ for online stores, AR and 3D tools."],
  };
  return { id: uid(), kind, title: meta[kind][0], description: meta[kind][1], status: "pending", progress: 0, attempts: 0, options };
};

/**
 * Natural language (any language, via the intent layer) -> ordered steps.
 * A brief that asks for a new finish without naming one gets matte black.
 */
export function planFromIntent(intent: Intent): Step[] {
  const steps: Step[] = [makeStep("generate"), makeStep("qc")];
  if (intent.material || intent.finish) {
    const finish = intent.finish ?? "graphite";
    steps.push(makeStep("material", { finish }));
  }
  if (intent.split) steps.push(makeStep("split"));
  steps.push(makeStep("export", { formats: "glb,usdz,obj" }));
  return validatePlan(steps);
}

export const STEP_ORDER: Step["kind"][] = ["generate", "qc", "material", "split", "export"];

/** Enforce dependency rules: generate first, export last, no duplicates. */
export function validatePlan(steps: Step[]): Step[] {
  const seen = new Set<string>();
  return steps
    .filter((s) => (seen.has(s.kind) ? false : (seen.add(s.kind), true)))
    .sort((a, b) => STEP_ORDER.indexOf(a.kind) - STEP_ORDER.indexOf(b.kind));
}
