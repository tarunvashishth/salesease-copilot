import { adapterFromEnv } from "../src/llm.js";

export default function handler(_req, res) {
  res.status(200).json({ ok: true, mode: adapterFromEnv().mode });
}
