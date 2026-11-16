/**
 * Finishes for any product. A finish is stored as a string:
 *  - a preset key ("graphite", "oak", ...), or
 *  - a custom finish "c:<label>|<#color>|<#accent>|<kind>", produced by the AI from free text ("matte terracotta").
 * The material-transfer step turns it into a reference swatch image for Aholo.
 */
export type FinishKind = "metal" | "matte" | "gloss" | "wood" | "stone" | "fabric";
export interface FinishSpec { label: string; color: string; accent: string; kind: FinishKind }

export const FINISH_PRESETS: Record<string, FinishSpec> = {
  // keys kept from the first version so saved projects still load
  titanium: { label: "Brushed silver", color: "#c9c7c2", accent: "#7d7f84", kind: "metal" },
  midnight: { label: "Navy blue", color: "#2e3a52", accent: "#141a2a", kind: "gloss" },
  desert: { label: "Gold", color: "#d4b16a", accent: "#7a5a22", kind: "metal" },
  graphite: { label: "Matte black", color: "#3a3c40", accent: "#121315", kind: "matte" },
  white: { label: "Matte white", color: "#f1f0ec", accent: "#c9c7c0", kind: "matte" },
  red: { label: "Signal red", color: "#c8282d", accent: "#6e1014", kind: "gloss" },
  green: { label: "Forest green", color: "#2f5d3a", accent: "#173020", kind: "matte" },
  bronze: { label: "Bronze", color: "#a8713a", accent: "#4f3018", kind: "metal" },
  copper: { label: "Copper", color: "#c56a3f", accent: "#6b3016", kind: "metal" },
  oak: { label: "Oak wood", color: "#c39a63", accent: "#8a6233", kind: "wood" },
  walnut: { label: "Walnut wood", color: "#6b4528", accent: "#3a2414", kind: "wood" },
  marble: { label: "White marble", color: "#eeece8", accent: "#9a9894", kind: "stone" },
  concrete: { label: "Concrete", color: "#9b9a96", accent: "#5f5e5b", kind: "stone" },
  linen: { label: "Natural linen", color: "#d9cdb4", accent: "#a89878", kind: "fabric" },
};

/** Presets offered as one-click swatches in the plan. */
export const PICKER_PRESETS = ["graphite", "white", "red", "desert", "bronze", "oak", "walnut", "marble"];

const KINDS: FinishKind[] = ["metal", "matte", "gloss", "wood", "stone", "fabric"];
const HEX = /^#[0-9a-f]{6}$/i;

export function encodeCustom(spec: Partial<FinishSpec> & { label: string; color: string }): string {
  const clean = (s: string) => s.replace(/[|]/g, " ").trim().slice(0, 40);
  const color = HEX.test(spec.color) ? spec.color : "#808080";
  const accent = spec.accent && HEX.test(spec.accent) ? spec.accent : shade(color, -0.45);
  const kind = KINDS.includes(spec.kind as FinishKind) ? spec.kind : "matte";
  return `c:${clean(spec.label)}|${color}|${accent}|${kind}`;
}

export function resolveFinish(finish: string | undefined): FinishSpec {
  if (finish && FINISH_PRESETS[finish]) return FINISH_PRESETS[finish];
  if (finish?.startsWith("c:")) {
    const [label, color, accent, kind] = finish.slice(2).split("|");
    if (label && HEX.test(color ?? "")) {
      return { label, color, accent: HEX.test(accent ?? "") ? accent : shade(color, -0.45), kind: KINDS.includes(kind as FinishKind) ? (kind as FinishKind) : "matte" };
    }
  }
  return FINISH_PRESETS.graphite;
}

export const finishLabel = (finish: string | undefined) => resolveFinish(finish).label;

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(Math.min(255, Math.max(0, amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Deterministic pseudo-random numbers, so a swatch looks the same every time. */
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

/**
 * Draws a 512x512 material reference for Aholo material transfer: the colour plus a surface pattern
 * that matches the kind (grain for wood, sheen for metal, veins for stone, weave for fabric).
 */
export function drawSwatch(spec: FinishSpec): HTMLCanvasElement {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const rand = rng(spec.color.length * 97 + parseInt(spec.color.slice(1), 16));
  g.fillStyle = spec.color;
  g.fillRect(0, 0, S, S);

  if (spec.kind === "metal" || spec.kind === "gloss") {
    const grad = g.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, shade(spec.color, 0.35));
    grad.addColorStop(0.45, spec.color);
    grad.addColorStop(0.55, shade(spec.color, spec.kind === "metal" ? 0.25 : 0.12));
    grad.addColorStop(1, spec.accent);
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    if (spec.kind === "metal") {
      g.globalAlpha = 0.08; // brushed lines
      for (let y = 0; y < S; y += 2) { g.fillStyle = rand() > 0.5 ? "#fff" : "#000"; g.fillRect(0, y, S, 1); }
      g.globalAlpha = 1;
    }
  } else if (spec.kind === "wood") {
    for (let i = 0; i < 46; i++) {
      g.strokeStyle = rand() > 0.5 ? spec.accent : shade(spec.color, 0.12);
      g.globalAlpha = 0.25 + rand() * 0.4;
      g.lineWidth = 1 + rand() * 4;
      const y0 = rand() * S, amp = 6 + rand() * 18, freq = 0.004 + rand() * 0.01;
      g.beginPath();
      for (let x = 0; x <= S; x += 8) g.lineTo(x, y0 + Math.sin(x * freq + i) * amp);
      g.stroke();
    }
    g.globalAlpha = 1;
  } else if (spec.kind === "stone") {
    for (let i = 0; i < 9000; i++) { // speckle
      g.fillStyle = rand() > 0.5 ? shade(spec.color, 0.1) : shade(spec.color, -0.12);
      g.globalAlpha = 0.5;
      g.fillRect(rand() * S, rand() * S, 2, 2);
    }
    g.strokeStyle = spec.accent; // veins
    for (let v = 0; v < 5; v++) {
      g.globalAlpha = 0.35 + rand() * 0.3;
      g.lineWidth = 1 + rand() * 2;
      g.beginPath();
      let x = rand() * S, y = 0;
      g.moveTo(x, y);
      while (y < S) { x += (rand() - 0.5) * 60; y += 20 + rand() * 30; g.lineTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
  } else if (spec.kind === "fabric") {
    g.globalAlpha = 0.18;
    for (let i = 0; i < S; i += 4) {
      g.fillStyle = spec.accent; g.fillRect(i, 0, 1, S);
      g.fillStyle = shade(spec.color, 0.2); g.fillRect(0, i, S, 1);
    }
    g.globalAlpha = 1;
  } else {
    const grad = g.createLinearGradient(0, 0, 0, S); // matte: soft falloff only
    grad.addColorStop(0, shade(spec.color, 0.06));
    grad.addColorStop(1, shade(spec.color, -0.08));
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  }
  return c;
}
