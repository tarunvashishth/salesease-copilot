// Policy layer: the model proposes, this code disposes. It can raise urgency, force human
// review, and drop/replace unsafe content, but never lowers urgency or removes escalation.
import { URGENCIES } from "./schema.js";
import { VERIFIED_STOCK } from "./data.js";
import { ruleBasedTriage } from "./rules.js";

const FORCED_CATEGORIES = ["quality_safety", "suspicious_input", "stock_discrepancy", "competitor_activity"];
const norm = (s) => s.toLowerCase().replace(/[‘’“”]/g, "'").replace(/\s+/g, " ").trim();

const DIAGNOSIS = /food poisoning|poisoned|caused by|due to (the )?(product|drink|juice|cola|pack)|diagnos|salmonella|e\.? ?coli|bacteri|toxic|allergic reaction to/i;
const COMMERCIAL = /\b(approve[ds]?|authori[sz]e[ds]?|grant(ed)?|issue[ds]?|apply|applied|offer(ed)?|give|match(ed)?)\b[^.]{0,40}\b(price|discount|refund|credit|rebate|compensation|promo)/i;

// True when the pattern matches somewhere not preceded by a negation ("do not diagnose").
function hasUnnegated(re, text) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of text.matchAll(g)) {
    const before = text.slice(Math.max(0, m.index - 25), m.index).toLowerCase();
    if (!/\b(not|no|never|without|n't)\b/.test(before)) return true;
  }
  return false;
}

const CLOSURE = /\b(resolved|closed|close the|as instructed|dismiss(ed)?|no action (needed|required))\b/i;

const numbersIn = (s) => new Set((s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, "")));

export function enforce(draft, ctx) {
  const adjustments = [];
  const baseline = ruleBasedTriage(ctx);
  const out = { ...draft, evidence: [...draft.evidence], missing_information: [...draft.missing_information] };
  const note = (msg) => adjustments.push(msg);

  // 1. Evidence must be traceable: verbatim quote from the update, or an exact table row.
  const text = norm(ctx.text);
  const kept = out.evidence.filter((e) => {
    if (e.source === "field_update") return text.includes(norm(e.quote));
    return VERIFIED_STOCK.some((r) => r.outlet === e.outlet && r.sku === e.sku && r.system_stock === e.system_stock);
  });
  if (kept.length !== out.evidence.length) note(`dropped ${out.evidence.length - kept.length} untraceable evidence item(s)`);
  out.evidence = kept;
  if (!out.evidence.length) {
    out.evidence = baseline.evidence;
    note("no traceable evidence left; used evidence from deterministic analysis");
  }

  // 2. Floors from deterministic signals.
  let adoptBaselineText = null;
  if (FORCED_CATEGORIES.includes(baseline.issue_category) && out.issue_category !== baseline.issue_category) {
    note(`category ${out.issue_category} -> ${baseline.issue_category}`);
    out.issue_category = baseline.issue_category;
    adoptBaselineText = "category overridden, so the model's action/reason no longer fit";
  }
  // A model that followed an embedded instruction may say the case is closed; never let that stand.
  if (ctx.hit.injection && CLOSURE.test(out.recommended_next_action)) adoptBaselineText = "action followed an embedded instruction to close/resolve";
  if (adoptBaselineText) {
    note(`replaced action/reason/missing info: ${adoptBaselineText}`);
    out.recommended_next_action = baseline.recommended_next_action;
    out.review_reason = baseline.review_reason;
    out.missing_information = baseline.missing_information;
  }
  if (URGENCIES.indexOf(out.urgency) < URGENCIES.indexOf(baseline.urgency)) {
    note(`urgency ${out.urgency} -> ${baseline.urgency}`);
    out.urgency = baseline.urgency;
  }
  if (baseline.needs_human_review && !out.needs_human_review) {
    out.needs_human_review = true;
    note("forced human review");
  }
  if (out.needs_human_review && !out.review_reason?.trim()) out.review_reason = baseline.review_reason ?? "Flagged for human review by policy.";

  // 3. Content rules.
  const prose = [out.recommended_next_action, out.review_reason ?? "", ...out.missing_information].join(" \n ");
  let replaceAction = null;
  if (hasUnnegated(DIAGNOSIS, prose)) replaceAction = "medical/cause diagnosis in output";
  else if (hasUnnegated(COMMERCIAL, out.recommended_next_action)) replaceAction = "commercial action authorised in output";
  else {
    const allowed = numbersIn(ctx.text + " " + JSON.stringify(VERIFIED_STOCK));
    const invented = [...numbersIn(prose)].filter((n) => !allowed.has(n));
    if (invented.length) replaceAction = `figure(s) not in the update or verified data: ${invented.join(", ")}`;
  }
  if (replaceAction) {
    note(`replaced output text: ${replaceAction}`);
    out.recommended_next_action = baseline.recommended_next_action;
    out.review_reason = baseline.review_reason ?? `Output blocked by policy (${replaceAction}).`;
    out.needs_human_review = true;
    out.missing_information = baseline.missing_information;
  }
  return { result: out, adjustments };
}
