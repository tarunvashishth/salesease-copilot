import { adapterFromEnv } from "../../src/llm.js";

export default async () =>
  Response.json({ ok: true, mode: adapterFromEnv({ ANTHROPIC_API_KEY: Netlify.env.get("ANTHROPIC_API_KEY") }).mode });

export const config = { path: "/api/health" };
