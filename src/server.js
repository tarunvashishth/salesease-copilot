import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { triage, MAX_INPUT_CHARS } from "./triage.js";
import { adapterFromEnv } from "./llm.js";

const adapter = adapterFromEnv();
const PORT = Number(process.env.PORT) || 3000;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN) || 20;
const hits = new Map(); // ip -> timestamps (in-memory; single instance demo)

function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE_LIMIT;
}

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type, "x-content-type-options": "nosniff" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};

function readBody(req, max = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error("body too large"), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8");
      return send(res, 200, html, "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true, mode: adapter.mode });
    if (req.method === "POST" && url.pathname === "/api/triage") {
      const ip = (req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
      if (limited(ip)) return send(res, 429, { error: "rate limit exceeded; try again in a minute" });
      let update;
      try { ({ update } = JSON.parse(await readBody(req))); } catch (e) {
        if (e.status) throw e;
        return send(res, 400, { error: 'body must be JSON: {"update": "..."}' });
      }
      try {
        return send(res, 200, await triage(update, adapter));
      } catch (e) {
        if (e instanceof TypeError || e instanceof RangeError) return send(res, 400, { error: e.message, max_chars: MAX_INPUT_CHARS });
        throw e;
      }
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    console.error("request failed:", e.message); // never log request bodies or keys
    send(res, e.status ?? 500, { error: e.status ? e.message : "internal error" });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`SalesEasy copilot on :${PORT} using ${adapter.mode}`));
}
