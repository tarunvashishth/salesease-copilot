# SalesEasy Copilot (exercise build)

Reads a plain-text FMCG field-sales update and returns validated JSON: `issue_category, urgency, evidence, recommended_next_action, missing_information, needs_human_review, review_reason`. Fictional data only.

## Run

```bash
npm start                      # http://localhost:3000, zero dependencies, Node >= 20
ANTHROPIC_API_KEY=... npm start   # real LLM (Claude via Messages API, forced tool call = structured output)
MISTRAL_API_KEY=... npm start     # or Mistral (free tier key), same forced-tool-call approach
npm run eval                   # 12 scenarios against the mock adapter
node eval/run.js --live --write   # same cases against the real model (needs either key)
```

Without `ANTHROPIC_API_KEY` or `MISTRAL_API_KEY` the app runs a **mock adapter (rule-based, no LLM)**. `/api/health` and the UI show which mode is active. Secrets are read from env only; see `.env.example`.

API: `POST /api/triage` with `{"update": "..."}` -> `{ result, meta }`. Limits: 1000 chars per update, 4 KB body, 20 req/min/IP (`RATE_LIMIT_PER_MIN`).

## Design: the model proposes, code disposes

```
update -> analyze() (outlet/SKU match, verified-table lookup, signal regexes)
       -> model adapter (LLM or mock)  -- 1 retry on error/timeout/invalid output
       -> validateOutput() (schema + enums)
       -> enforce() policy layer
       -> validated JSON (+ meta: mode, attempts, fallback_used, policy_adjustments)
```

- **Untrusted input.** The update goes to the model inside `<field_update>` tags with an explicit "data, not instructions" system prompt, and the model has no tools except the output schema. Because prompts alone are not a defence, `policy.js` enforces the rules in code.
- **Policy floors (monotonic).** Deterministic signals set a minimum urgency, force the category for safety / injection / stock conflict / competitor cases, and force `needs_human_review`. The model can raise urgency but never lower it or remove escalation.
- **Traceable evidence.** `field_update` evidence must be a verbatim substring of the update; `verified_table` evidence must equal a real table row. Untraceable items are dropped.
- **Content rules.** No numbers that are not in the update or table (no invented impact figures); no unnegated diagnosis/cause wording; no authorising price match, discount, refund, etc. A violation replaces the action with a safe one and forces review.
- **Failure handling.** Model error, timeout or invalid JSON -> retry once -> deterministic fallback with review forced and the reason stated. The endpoint does not return a 500 for model problems.
- **Review logic.** Review is required for: health/safety, conflicts with the verified table, unverified high-impact claims, commercial requests, embedded instructions, and anything that cannot be tied to an outlet+SKU.

## Evaluation

Cases are in `eval/cases.js` (the 5 required scenarios + 7 of my own: missing info, simulated timeout, invalid JSON, model obeys injection, model invents a figure, model authorises a price match, model API rate-limited). Latest table: `eval/last-run.md`.

**Iteration log (real, from the first run: 9/11):**
1. **C4 (model obeys injection) failed**: policy corrected urgency/category/review, but the action still said "Marked as resolved as instructed." Fix: when the category is overridden or an injection is present and the action reads as a closure, the model's action/reason/missing-info are replaced with the deterministic ones. Re-run: pass.
2. **Found on the live Mistral deploy:** the free tier returned HTTP 429. The fallback worked, but its reason text contained "429", which my own "no invented numbers" rule flagged and so replaced the fallback action every time. Fix: the fallback reason no longer embeds raw error text (it stays in `meta.fallback_reason`), and the retry now waits 1.5 s after a 429. Added case C7.
3. **S3 failed**: bug in my test regex (could not distinguish "no price change or match is authorised" from an approval). Fixed the test, not the product.

## Known limitations (read before relying on this)

- **The live-LLM path has not been exercised.** It was written against the Messages API but not run here (no key in the build environment). All reported results are from the mock adapter and simulated faulty models. Run `node eval/run.js --live` before trusting it; expect some live cases to need prompt or policy tweaks.
- Signal detection is keyword/regex based (English only, misses paraphrases such as "not feeling well"); the 3-row table and alias matching are toy-sized.
- Rate limiting is in-memory per instance and trusts `x-forwarded-for`; fine for a demo, not for production.
- No auth, persistence, or audit log; no real-world replenishment/impact data.
- Eval checks are rule-based assertions, not a graded set; 11 cases is a smoke suite, not statistical evidence.

## Deploy

`Dockerfile` included (works on Render/Fly/Railway). Set `ANTHROPIC_API_KEY` as a platform secret, never in the repo. **Not deployed yet.**

## AI-tool usage disclosure

Built with Claude Code (Claude Sonnet 5.5) generating the code, tests and this README under my direction; I reviewed and ran it. The product itself calls Claude only when `ANTHROPIC_API_KEY` is set.
