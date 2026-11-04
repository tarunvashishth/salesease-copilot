// Netlify Function: same triage pipeline as src/server.js, served at /api/triage.
import { triage, MAX_INPUT_CHARS } from "../../src/triage.js";
import { adapterFromEnv } from "../../src/llm.js";

const adapter = adapterFromEnv({ ANTHROPIC_API_KEY: Netlify.env.get("ANTHROPIC_API_KEY"), GEMINI_API_KEY: Netlify.env.get("GEMINI_API_KEY"), MISTRAL_API_KEY: Netlify.env.get("MISTRAL_API_KEY"), MODEL: Netlify.env.get("MODEL") });
const RATE_LIMIT = Number(Netlify.env.get("RATE_LIMIT_PER_MIN")) || 20;
const hits = new Map(); // per warm instance only; use a shared store for real limits

const json = (body, status = 200) => Response.json(body, { status });

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const now = Date.now();
  const recent = (hits.get(context.ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(context.ip, recent);
  if (hits.size > 5000) hits.clear();
  if (recent.length > RATE_LIMIT) return json({ error: "rate limit exceeded; try again in a minute" }, 429);
  let update;
  try {
    const raw = await req.text();
    if (raw.length > 4096) return json({ error: "body too large" }, 413);
    ({ update } = JSON.parse(raw));
  } catch {
    return json({ error: 'body must be JSON: {"update": "..."}' }, 400);
  }
  try {
    return json(await triage(update, adapter));
  } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) return json({ error: e.message, max_chars: MAX_INPUT_CHARS }, 400);
    console.error("request failed:", e.message);
    return json({ error: "internal error" }, 500);
  }
};

export const config = { path: "/api/triage" };
