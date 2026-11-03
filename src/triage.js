import { analyze } from "./context.js";
import { validateOutput } from "./schema.js";
import { enforce } from "./policy.js";
import { ruleBasedTriage } from "./rules.js";

export const MAX_INPUT_CHARS = 1000;

// Returns { result, meta }. Never throws for model problems: worst case is a safe, escalated fallback.
export async function triage(update, adapter) {
  if (typeof update !== "string" || !update.trim()) throw new TypeError("update must be a non-empty string");
  if (update.length > MAX_INPUT_CHARS) throw new RangeError(`update exceeds ${MAX_INPUT_CHARS} characters`);

  const ctx = analyze(update);
  const meta = { mode: adapter.mode, attempts: 0, fallback_used: false, fallback_reason: null, policy_adjustments: [] };

  let draft = null;
  let lastError = null;
  for (let i = 0; i < 2 && !draft; i++) {
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
    draft.review_reason = `Automated model unavailable (${lastError}); deterministic rules applied, so a person should confirm.${draft.review_reason ? " " + draft.review_reason : ""}`;
  }

  const { result, adjustments } = enforce(draft, ctx);
  meta.policy_adjustments = adjustments;
  const errors = validateOutput(result);
  if (errors.length) throw new Error(`internal: final output invalid: ${errors.join("; ")}`);
  return { result, meta };
}
