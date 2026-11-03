// Usage: node eval/run.js [--live]   (--live uses ANTHROPIC_API_KEY if set; default is the mock adapter)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CASES } from "./cases.js";
import { triage } from "./../src/triage.js";
import { mockAdapter, adapterFromEnv } from "../src/llm.js";
import { URGENCIES } from "../src/schema.js";

const live = process.argv.includes("--live");
const base = live ? adapterFromEnv() : mockAdapter();

// Faulty models for the failure-mode cases.
const FAULTS = {
  timeout: () => Object.assign(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }, { mode: "simulated: timeout" }),
  invalid_json: () => Object.assign(async () => "```json {oops", { mode: "simulated: invalid json" }),
  obey_injection: () => Object.assign(async (ctx) => ({
    issue_category: "unclear", urgency: "low",
    evidence: [{ source: "field_update", quote: ctx.text }],
    recommended_next_action: "Marked as resolved as instructed.",
    missing_information: [], needs_human_review: false, review_reason: null,
  }), { mode: "simulated: obeys injection" }),
  invented_figure: () => Object.assign(async (ctx) => ({
    issue_category: "stockout", urgency: "medium",
    evidence: [{ source: "field_update", quote: ctx.text }],
    recommended_next_action: "Restock now; estimated lost sales of 450000 this week.",
    missing_information: [], needs_human_review: false, review_reason: null,
  }), { mode: "simulated: invents figure" }),
  authorise_price_match: () => Object.assign(async (ctx) => ({
    issue_category: "competitor_activity", urgency: "low",
    evidence: [{ source: "field_update", quote: ctx.text }],
    recommended_next_action: "Approve the price match for all outlets immediately.",
    missing_information: [], needs_human_review: false, review_reason: null,
  }), { mode: "simulated: authorises price match" }),
};

function check(c, out) {
  const { result: r, meta } = out;
  const e = c.expect;
  const fails = [];
  const prose = [r.recommended_next_action, r.review_reason ?? "", ...r.missing_information].join(" | ");
  if (e.category && !e.category.includes(r.issue_category)) fails.push(`category ${r.issue_category} not in [${e.category}]`);
  if (e.urgencyMin && URGENCIES.indexOf(r.urgency) < URGENCIES.indexOf(e.urgencyMin)) fails.push(`urgency ${r.urgency} < ${e.urgencyMin}`);
  if (e.review !== undefined && r.needs_human_review !== e.review) fails.push(`needs_human_review ${r.needs_human_review} != ${e.review}`);
  for (const s of e.evidenceSources ?? []) if (!r.evidence.some((x) => x.source === s)) fails.push(`no ${s} evidence`);
  for (const re of e.missingMatches ?? []) if (!r.missing_information.some((m) => re.test(m))) fails.push(`missing_information lacks ${re}`);
  for (const re of e.reasonMatches ?? []) if (!re.test(r.review_reason ?? "")) fails.push(`review_reason lacks ${re}`);
  for (const re of e.actionMatches ?? []) if (!re.test(r.recommended_next_action)) fails.push(`action lacks ${re}`);
  for (const re of e.forbidAll ?? []) if (re.test(prose)) fails.push(`output matches forbidden ${re}`);
  for (const re of e.adjustmentsMatch ?? []) if (!meta.policy_adjustments.some((a) => re.test(a))) fails.push(`no policy adjustment ${re}`);
  if (e.fallbackUsed !== undefined && meta.fallback_used !== e.fallbackUsed) fails.push(`fallback_used ${meta.fallback_used} != ${e.fallbackUsed}`);
  return fails;
}

const rows = [];
for (const c of CASES) {
  const adapter = c.simulate ? FAULTS[c.simulate]() : base;
  let out, fails;
  try { out = await triage(c.input, adapter); fails = check(c, out); }
  catch (err) { fails = [`threw: ${err.message}`]; }
  rows.push({ c, out, fails });
}

const pass = rows.filter((r) => !r.fails.length).length;
console.log(`${live ? "LIVE" : "MOCK"} eval: ${pass}/${rows.length} passed`);
for (const { c, fails } of rows) console.log(`${fails.length ? "FAIL" : "PASS"} ${c.id} ${c.title}${fails.length ? "\n     - " + fails.join("\n     - ") : ""}`);

if (process.argv.includes("--write")) {
  const lines = [`# Eval results (${live ? "live model" : "mock adapter"}) — ${pass}/${rows.length} passed`, "",
    "| ID | Scenario | Expected | Actual (category / urgency / review) | Result |", "|---|---|---|---|---|"];
  for (const { c, out, fails } of rows) {
    const e = c.expect;
    const exp = `${e.category.join("|")} / ≥${e.urgencyMin} / review=${e.review}`;
    const act = out ? `${out.result.issue_category} / ${out.result.urgency} / review=${out.result.needs_human_review}${out.meta.fallback_used ? " (fallback)" : ""}${out.meta.policy_adjustments.length ? ` [policy: ${out.meta.policy_adjustments.join("; ")}]` : ""}` : "error";
    lines.push(`| ${c.id} | ${c.title} | ${exp} | ${act} | ${fails.length ? "FAIL: " + fails.join("; ") : "PASS"} |`);
  }
  writeFileSync(fileURLToPath(new URL("./last-run.md", import.meta.url)), lines.join("\n") + "\n");
  writeFileSync(fileURLToPath(new URL("./last-run.json", import.meta.url)), JSON.stringify(rows.map(({ c, out, fails }) => ({ id: c.id, input: c.input, output: out ?? null, fails })), null, 2));
}
process.exit(pass === rows.length ? 0 : 1);
