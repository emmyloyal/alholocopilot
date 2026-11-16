import http from "node:http"; import fs from "node:fs";
const tasks = new Map(); let n = 100; const log = [];
const send = (res, obj, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = []; req.on("data", (c) => b.push(c)); req.on("end", () => r(Buffer.concat(b))); });
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  log.push(`${req.method} ${u.pathname}${u.search} auth=${req.headers.authorization ?? "-"}`);
  if (u.pathname === "/__log") return send(res, log);
  if (u.pathname.startsWith("/files/")) { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(fs.readFileSync("model.glb")); }
  if (u.pathname === "/global/lux3d/v1/generate/task/list") return send(res, { c: "0", d: { items: [], total: 0, page: 1, pageSize: 1 } });
  if (u.pathname === "/global/asset/v1/token") return send(res, { ousToken: "tok", globalDomain: "http://localhost:4010", blockSize: 5242880 }); // real API: no envelope
  if (u.pathname === "/ous/api/v2/single/upload") { await body(req); return send(res, { c: "0", d: { status: 5, url: "http://localhost:4010/files/ref.png" } }); }
  const m = u.pathname.match(/^\/global(\/lux3d\/v1\/.*)\/task\/create$/);
  if (m && req.method === "POST") {
    if (req.headers.authorization !== "test-key") return send(res, { c: "-1", m: "bad key" });
    const b = JSON.parse((await body(req)).toString()); const id = String(++n);
    tasks.set(id, { path: m[1], b, t: Date.now() }); log.push(`  body ${JSON.stringify(b)}`);
    return send(res, { c: "0", d: id });
  }
  if (u.pathname === "/global/lux3d/v1/generate/task/get") {
    const t = tasks.get(u.searchParams.get("taskid")); if (!t) return send(res, { c: "-1", m: "no task" });
    const done = Date.now() - t.t > 2500;
    const exp = t.path.includes("multi-format-export");
    const outputs = !done ? [] : exp ? [{ content: "http://localhost:4010/files/model.usdz" }, { content: "http://localhost:4010/files/model.zip" }] : [{ content: "http://localhost:4010/files/model.zip" }, { content: "http://localhost:4010/files/model.glb?sig=1" }];
    return send(res, { c: "0", d: { status: done ? 3 : 1, outputs } });
  }
  send(res, { c: "-1", m: "unknown " + u.pathname }, 404);
}).listen(4010, () => console.log("fake aholo on 4010"));
