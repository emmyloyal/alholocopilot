# Aholo Creator Copilot — project context

Hackathon project: Manycore Aholo Global 3D AI Hackathon (Oct 19 – Nov 19, 2026; rules page was a stub, so prizes/judging are unknown).
Idea: an AI production assistant that turns a product brief (text + reference photo, any language) into an export-ready 3D asset by planning and orchestrating Aholo Lux3D operations.

## Run
    npm install
    cp .env.example .env.local     # add AHOLO_API_KEY (labs.aholo3d.com/api-keys)
    npm run dev                    # http://localhost:3000
No key = MOCK mode (simulated Aholo, material step fails once to demo retry). `?mock=1` forces mock.
Offline test of live mode: `node tools/fake-aholo/server.mjs` (port 4010) then start the app with
AHOLO_API_KEY=test-key AHOLO_BASE_URL=http://localhost:4010/global AHOLO_ASSET_HOSTS=localhost AHOLO_ASSET_TOKEN_URL=http://localhost:4010/global/asset/v1/token

## Stack
Next.js 15 (app router), React 19, TypeScript, Tailwind v4 (CSS-variable themes: midnight/paper/aurora, default paper), React Three Fiber + drei, three.

## Architecture
- `lib/intent.ts` — one Intent contract for planner + chat. Local multilingual lexicon (14 languages) fallback; `app/api/copilot/route.ts` uses Google Gemini (GEMINI_API_KEY, model via GEMINI_MODEL, default gemini-3.5-flash with fallback to gemini-flash-lite-latest; Claude via ANTHROPIC_API_KEY as fallback) for any language and for vision QC judged against the brief.
- `lib/planner.ts` — Intent -> ordered steps: generate, qc, material, split, export.
- `lib/useWorkflow.ts` — workflow engine: runs steps, polls tasks, retry keeps finished work, skip step, QC auto-fix (regenerate once), chat/voice edits re-run only affected steps.
- `lib/aholo/client.ts` — AholoClient interface. `live.ts` (real API), `replay.ts` (plays back a real recorded run from public/demo: default with no key, or `?replay=1`; labelled in the UI) and `mock.ts` (`?mock=1`, procedural phone) implement it.
- `lib/finish.ts` — finishes for any product: presets + AI custom finishes encoded `c:label|#hex|#hex|kind`; `drawSwatch` makes the material-transfer reference image.
- `app/api/aholo/*` + `lib/aholo/server.ts` — server proxy (key never reaches the browser): health, create, task, upload, asset (host-allowlisted GLB proxy).
- `components/Viewer.tsx` (real GLB via GlbModel, exploded view, loading overlay, clay-render QC snapshot; procedural phone only in mock), `Studio.tsx` (UI), `lib/useVoice.ts` (Web Speech API in/out).

## Aholo API facts (from public skill pages, NOT official docs)
Base `https://api.aholo.ai/global`; header `Authorization: <key>` (no Bearer); envelope `{c:"0", d, m}`.
Create: POST `/lux3d/v1/generate/img-to-3d/task/create` {img,version:"G1"|"G1-Turbo"}, `.../text-to-3d/...` {prompt,version,style},
`.../generate/material-transfer/task/create` {img,meshUrl,version:"v3.0-standard",outputFormat}, `/lux3d/v1/multi-format-export/task/create` {modelUrl,outputFormat:[usdz,obj_zip,fbx_zip,stl,3mf]}.
Get task: GET `/lux3d/v1/generate/task/get` (param name assumed `taskid`); status 0/1 running, 3 ok, 4 failed, 6 cancelled; results `d.outputs[].content`; URLs expire in 2h.
Concurrency: Free 2 / Pro 10 shared in-progress tasks (GENERATION_CONCURRENCY_LIMIT_EXCEEDED).

## UNVERIFIED — calibrate on the first real run
1. Part-split VERIFIED live 2026-11-16: `/lux3d/v1/part-split/task/create` {glbUrl}; ~2 min; costs 30 credits; returns one GLB with 8 unnamed root meshes (exploded view works on it). Multi-format export REJECTS the split GLB (fails in ~4 s, refunded), so export uses model.baseModelUrl (pre-split). Export of a GLB to usdz: ~30 s.
2. VERIFIED live 2026-11-15: get-task param `taskid`; token at `/global/asset/v1/token` returns {ousToken,globalDomain,blockSize} with NO envelope; single upload works (uploads land on holo-cos.aholo3d.cn). Health uses `/generate/task/list` (no balance endpoint exists).
3. RESOLVED from the official API spec: `outputFormat` is always an array. G1-Turbo needs outputFormat ["glb"] or it returns only a ZIP. Export with a GLB input needs at least one non-GLB format.
4. Result files are on qhsmodel.kujiale.com (allowed by .kujiale.com); ~17 MB GLB, downloads at ~0.5-1 MB/s. G1-Turbo image-to-3D VERIFIED: ~100 s, 1 credit (G1: 20 credits, our two G1 runs failed after 11-31 min).
Official docs are at labs.aholo.ai (was not reachable from the build sandbox). Verify against them first.

## Status (2026-11-16)
Done and verified on live Aholo: generate (G1-Turbo), material transfer, part split, export (from pre-split model), upload. Gemini chat (questions + edits, queued during runs, credit confirmation for split) and clay-render QC (waits for the model to render; regenerates only below 50%). Demo replay of a real recorded run. Any-product finishes. README + docs/DEMO_SCRIPT.md + docs/screenshots.
E2E: a Playwright script driving installed Edge (needs GPU flags; SwiftShader renders nothing) passes 15/15 checks in replay mode; it lived in the session scratchpad, not the repo.
Known: Gemini free tier rate-limits bursts (QC then skips, chat falls back to lexicon); Gemini QC scores vary run to run. Block upload (>5 MB photos) not implemented. localStorage only.
Not done / ideas: workflow templates (game prop, 3D print); cancel button; variant batch; deployment (only if the submission needs a link).

## Conventions
Keep the Aholo seam (AholoClient) intact; never expose API keys to the browser; don't add simulated checks in live mode (they waste credits).
