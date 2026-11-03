// Vercel serverless entry. Same triage pipeline as src/server.js.
import { triage, MAX_INPUT_CHARS } from "../src/triage.js";
import { adapterFromEnv } from "../src/llm.js";

const adapter = adapterFromEnv();
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN) || 20;
const hits = new Map(); // per warm instance only; use a shared store for real limits

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  if (recent.length > RATE_LIMIT) return res.status(429).json({ error: "rate limit exceeded; try again in a minute" });
  try {
    const update = req.body?.update;
    return res.status(200).json(await triage(update, adapter));
  } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) return res.status(400).json({ error: e.message, max_chars: MAX_INPUT_CHARS });
    console.error("request failed:", e.message);
    return res.status(500).json({ error: "internal error" });
  }
}
