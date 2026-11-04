import { analyze } from "./context.js";
import { validateOutput } from "./schema.js";
import { enforce } from "./policy.js";
import { ruleBasedTriage } from "./rules.js";

export const MAX_INPUT_CHARS = 1000;

// Identical updates reuse the last real-model result (per instance), saving free-tier quota.
// Fallback results are never cached, so a transient model error does not stick.
const cache = new Map();
const keyOf = (adapter, text) => `${adapter.mode}|${text.trim().toLowerCase().replace(/\s+/g, " ")}`;

// Returns { result, meta }. Never throws for model problems: worst case is a safe, escalated fallback.
export async function triage(update, adapter) {
  if (typeof update !== "string" || !update.trim()) throw new TypeError("update must be a non-empty string");
  if (update.length > MAX_INPUT_CHARS) throw new RangeError(`update exceeds ${MAX_INPUT_CHARS} characters`);

  const key = keyOf(adapter, update);
  if (cache.has(key)) return { ...cache.get(key), meta: { ...cache.get(key).meta, cached: true } };

  const ctx = analyze(update);
  const meta = { mode: adapter.mode, attempts: 0, fallback_used: false, fallback_reason: null, policy_adjustments: [] };

  let draft = null;
  let lastError = null;
  for (let i = 0; i < 2 && !draft; i++) {
    if (lastError === "model timeout") break; // a second slow call would risk the platform time limit
    if (i > 0 && /HTTP (429|503)/.test(lastError ?? "")) await new Promise((r) => setTimeout(r, 2500)); // free tiers rate-limit/overload
    meta.attempts++;
    try {
      const candidate = await adapter(ctx);
      const errors = validateOutput(candidate);
      if (errors.length) throw new Error(`invalid model output: ${errors.join("; ")}`);
      draft = candidate;
    } catch (e) {
      lastError = e.name === "AbortError" ? "model timeout" : e.message;
    }
  }

  if (!draft) {
    meta.fallback_used = true;
    meta.fallback_reason = lastError;
    draft = ruleBasedTriage(ctx);
    draft.needs_human_review = true;
    draft.review_reason = `Automated model unavailable; deterministic rules applied, so a person should confirm.${draft.review_reason ? " " + draft.review_reason : ""}`;
  }

  const { result, adjustments } = enforce(draft, ctx);
  meta.policy_adjustments = adjustments;
  const errors = validateOutput(result);
  if (errors.length) throw new Error(`internal: final output invalid: ${errors.join("; ")}`);
  const out = { result, meta };
  if (!meta.fallback_used && !adapter.mode.startsWith("mock") && !adapter.mode.startsWith("simulated")) {
    if (cache.size >= 200) cache.clear();
    cache.set(key, out);
  }
  return out;
}
