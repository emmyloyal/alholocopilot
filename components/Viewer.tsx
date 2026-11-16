"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls, RoundedBox, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Box3, Color, MeshStandardMaterial, Vector3, type Group, type Object3D } from "three";

const CLAY = new MeshStandardMaterial({ color: "#b9b9bd", roughness: 0.85, metalness: 0 });
import { markRendered, registerExportTarget, registerSnapshot } from "@/lib/exporter";
import type { ModelState } from "@/lib/types";
import { resolveFinish } from "@/lib/finish";
import { assetUrl } from "@/lib/assets";

/** Snapshot for the AI quality check: one clay render on light grey (shape only, independent of texture). */
function Capture() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    registerSnapshot(() => {
      // Clay render: one uniform grey material, so shape is judged even when the texture is black.
      const prev = scene.background, prevOverride = scene.overrideMaterial;
      scene.background = new Color("#e4e5ea");
      scene.overrideMaterial = CLAY;
      gl.render(scene, camera);
      const data = gl.domElement.toDataURL("image/jpeg", 0.8);
      scene.background = prev;
      scene.overrideMaterial = prevOverride;
      gl.render(scene, camera);
      return data;
    });
    return () => registerSnapshot(null);
  }, [gl, scene, camera]);
  return null;
}

function Phone({ model }: { model: ModelState }) {
  const root = useRef<Group>(null);
  const parts = useRef<Record<string, Group | null>>({});
  const spec = resolveFinish(model.finish);
  const f = { frame: spec.color, back: spec.accent };
  const ex = model.exploded;

  useEffect(() => { registerExportTarget(root.current); return () => registerExportTarget(null); }, []);

  // ease each part toward its (exploded or assembled) z/x offset
  useFrame(() => {
    const targets: Record<string, number> = { back: ex ? -0.55 : 0, frame: 0, screen: ex ? 0.45 : 0, camera: ex ? -0.95 : 0 };
    for (const [k, g] of Object.entries(parts.current)) {
      if (g) g.position.z += ((targets[k] ?? 0) - g.position.z) * 0.12;
    }
  });
  const set = (k: string) => (g: Group | null) => { parts.current[k] = g; };

  return (
    <group ref={root} rotation={[0, -0.5, 0]} name="smartphone">
      <group ref={set("frame")} name="frame">
        <RoundedBox args={[1.5, 3.1, 0.14]} radius={0.17} smoothness={6}>
          <meshStandardMaterial color={f.frame} metalness={0.95} roughness={0.28} />
        </RoundedBox>
      </group>
      <group ref={set("back")} name="back_glass" position={[0, 0, -0.04]}>
        <RoundedBox args={[1.4, 3.0, 0.07]} radius={0.14} smoothness={6}>
          <meshStandardMaterial color={f.back} metalness={0.2} roughness={0.15} />
        </RoundedBox>
      </group>
      <group ref={set("screen")} name="display" position={[0, 0, 0.075]}>
        <RoundedBox args={[1.38, 2.98, 0.03]} radius={0.13} smoothness={6}>
          <meshStandardMaterial color="#05060a" metalness={0.15} roughness={0.35} emissive="#0c1020" />
        </RoundedBox>
      </group>
      <group ref={set("camera")} name="camera_module" position={[-0.38, 1.05, -0.1]}>
        <RoundedBox args={[0.62, 0.66, 0.06]} radius={0.12} smoothness={6}>
          <meshStandardMaterial color={f.frame} metalness={0.9} roughness={0.3} />
        </RoundedBox>
        {[[-0.14, 0.15], [0.14, 0.15], [0, -0.14]].map(([x, y], i) => (
          <group key={i} position={[x, y, -0.05]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.11, 0.11, 0.06, 32]} /><meshStandardMaterial color="#111" metalness={0.8} roughness={0.2} /></mesh>
            <mesh position={[0, 0, -0.035]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.07, 0.07, 0.01, 32]} /><meshStandardMaterial color="#1b2a44" metalness={1} roughness={0.05} /></mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/** Renders a real GLB returned by Aholo, fitted to view. Exploded view pushes each part away from the centre. */
function GlbModel({ url, exploded, onReady }: { url: string; exploded: boolean; onReady: (url: string) => void }) {
  const gltf = useGLTF(assetUrl(url));
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  const root = useRef<Group>(null);
  // the viewer panel is often portrait, so fit to the narrower of width and height
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const info = useMemo(() => {
    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    let node: Object3D = scene;
    for (let d = 0; d < 4 && node.children.length === 1; d++) node = node.children[0];
    const parts = node.children.map((ch) => {
      const pc = new Box3().setFromObject(ch).getCenter(new Vector3());
      return { ch, base: ch.position.clone(), dir: pc.sub(center).normalize() };
    });
    return { center, scale: (2.3 * Math.min(1, aspect * 1.15)) / Math.max(size.x, size.y, size.z, 1e-6), parts, reach: size.length() * 0.14 }; // keeps exploded parts inside the frame
  }, [scene, aspect]);

  useEffect(() => { registerExportTarget(root.current); return () => registerExportTarget(null); }, []);
  // This component only mounts after the GLB has downloaded (Suspense); a few frames later it is on screen.
  useEffect(() => {
    let n = 0, id = 0;
    const tick = () => { if (++n < 4) id = requestAnimationFrame(tick); else { markRendered(url); onReady(url); } };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  useFrame(() => {
    for (const p of info.parts) {
      const target = p.base.clone().addScaledVector(p.dir, exploded ? info.reach : 0);
      p.ch.position.lerp(target, 0.12);
    }
  });
  return (
    <group ref={root} scale={info.scale} rotation={[0, -0.5, 0]}>
      <group position={[-info.center.x, -info.center.y, -info.center.z]}><primitive object={scene} /></group>
    </group>
  );
}

export default function Viewer({ model, bg = "#0b0d12" }: { model: ModelState; bg?: string }) {
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const loading = !!model.modelUrl && model.stage !== "none" && readyUrl !== model.modelUrl;
  return (
    <div className="relative h-full w-full">
    {loading && (
      <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
        <span className="pill animate-pulse">Loading model… large files take 15–30 s</span>
      </div>
    )}
    <Canvas camera={{ position: [0, 0.3, 6], fov: 35 }} gl={{ preserveDrawingBuffer: true }}>
      <color attach="background" args={[bg]} />
      <Capture />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 5]} intensity={1.6} />
      {/* soft front fill so dark products (matte black, walnut) still read clearly */}
      <directionalLight position={[-2, 1.5, 6]} intensity={0.9} />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={4} position={[0, 5, 4]} scale={[10, 3, 1]} />
        <Lightformer form="rect" intensity={2.5} position={[-5, 1, 2]} scale={[2, 8, 1]} />
        <Lightformer form="rect" intensity={2.5} position={[5, 1, -2]} scale={[2, 8, 1]} />
        <Lightformer form="rect" intensity={1.5} position={[0, -4, 3]} scale={[8, 2, 1]} />
      </Environment>
      {model.stage !== "none" && (model.modelUrl
        ? <Suspense fallback={null}><GlbModel url={model.modelUrl} exploded={model.exploded} onReady={setReadyUrl} /></Suspense>
        : <Phone model={model} />)}
      <ContactShadows position={[0, -1.8, 0]} opacity={0.5} scale={8} blur={2.5} />
      <OrbitControls autoRotate autoRotateSpeed={1.2} enablePan={false} minDistance={3} maxDistance={10} />
    </Canvas>
    </div>
  );
}
