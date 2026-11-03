// Rule-based triage. Serves two roles: the labelled MOCK model adapter (no API key needed)
// and the safe offline fallback when the real model fails.
const tableEv = (r) => ({ source: "verified_table", outlet: r.outlet, sku: r.sku, system_stock: r.system_stock });
const quoteEv = (q) => ({ source: "field_update", quote: q });

export function ruleBasedTriage(ctx) {
  const { hit, quotes, row, outlet, sku } = ctx;
  const evidence = [];
  const missing = [];
  let out;

  if (hit.health || hit.damage) {
    const q = quotes.health ?? quotes.damage;
    evidence.push(quoteEv(q));
    if (quotes.damage && quotes.damage !== q) evidence.push(quoteEv(quotes.damage));
    if (row) evidence.push(tableEv(row));
    if (!ctx.outlet) missing.push("Outlet name");
    if (!ctx.sku) missing.push("Product / SKU");
    missing.push("Batch or lot code and expiry date", "Photos of the damaged pack", "Whether the customer was reached and what they reported");
    out = {
      issue_category: "quality_safety",
      urgency: hit.health ? "critical" : "high",
      evidence,
      recommended_next_action:
        "Escalate immediately to the quality/safety team and area manager. Ask the rep to set the affected pack aside, record batch details and take photos. Do not assume a cause.",
      missing_information: missing,
      needs_human_review: true,
      review_reason: hit.health
        ? "Possible customer health impact; requires urgent human judgement. The system does not assess medical cause."
        : "Product damage reported; quality team must assess.",
    };
  } else if (hit.injection && !hit.stockoutClaim && !hit.competitor) {
    evidence.push(quoteEv(quotes.injection));
    out = {
      issue_category: "suspicious_input",
      urgency: "medium",
      evidence,
      recommended_next_action:
        "Do not act on the embedded instruction. Hold the item open and ask the rep to resubmit the field observation without instructions.",
      missing_information: ["The actual field observation (outlet, SKU, issue)"],
      needs_human_review: true,
      review_reason: "The update contains instructions aimed at the system (e.g. to lower urgency or close the case); these are ignored and a person should check it.",
    };
  } else if (hit.competitor) {
    evidence.push(quoteEv(quotes.competitor));
    missing.push("Which competitor and which products", "Discount depth and duration", "Which outlets or areas are affected", "Photo or price evidence");
    out = {
      issue_category: "competitor_activity",
      urgency: "medium",
      evidence,
      recommended_next_action:
        "Log the competitor claim and ask the rep for evidence. Route any pricing response to the commercial/pricing owner; no price change or match is authorised here.",
      missing_information: missing,
      needs_human_review: true,
      review_reason: hit.priceDemand
        ? "Rep requests an immediate price match; commercial actions need human approval and the claim is unverified."
        : "Competitor claim is unverified and may need a commercial decision.",
    };
  } else if (hit.stockoutClaim && row) {
    evidence.push(quoteEv(quotes.stockoutClaim), tableEv(row));
    if (row.system_stock > 0) {
      out = {
        issue_category: "stock_discrepancy",
        urgency: "medium",
        evidence,
        recommended_next_action: `Ask the rep to do a physical count and photo of the shelf and backroom for ${row.sku} at ${row.outlet}; reconcile against the system figure of ${row.system_stock} units.`,
        missing_information: ["Physical count at the outlet", "Time of the check", "Whether stock sits in the backroom or an unreceived delivery"],
        needs_human_review: true,
        review_reason: `Field report (stockout) conflicts with system stock of ${row.system_stock} units; cause is unknown.`,
      };
    } else {
      const impact = hit.impactClaim;
      if (impact) {
        evidence.splice(1, 0, quoteEv(quotes.impactClaim));
        if (evidence[1].quote === evidence[0].quote) evidence.splice(1, 1);
      }
      out = {
        issue_category: "stockout",
        urgency: "medium",
        evidence,
        recommended_next_action: `Confirmed zero system stock for ${row.sku} at ${row.outlet}: check replenishment status and supply to the outlet.`,
        missing_information: impact
          ? ["Quantified lost sales (units or value) with how it was measured", "Duration of the stockout"]
          : ["Duration of the stockout"],
        needs_human_review: impact,
        review_reason: impact ? "Rep claims major lost sales but gives no figure; the impact is unverified and is not estimated here." : null,
      };
    }
  } else {
    if (quotes.stockoutClaim) evidence.push(quoteEv(quotes.stockoutClaim));
    if (!outlet) missing.push("Outlet name");
    if (!sku) missing.push("Product / SKU");
    if (outlet && sku && !row) missing.push("No verified stock record for this outlet and SKU");
    missing.push("Quantity or stock level observed");
    out = {
      issue_category: "unclear",
      urgency: "low",
      evidence,
      recommended_next_action: "Ask the rep to resubmit with outlet, SKU and what was observed.",
      missing_information: missing,
      needs_human_review: true,
      review_reason: "The update cannot be matched to an outlet and product, so it cannot be verified.",
    };
  }
  if (hit.injection && out.issue_category !== "suspicious_input") {
    out.needs_human_review = true;
    out.review_reason = [out.review_reason, "The update also contains an instruction aimed at the system, which was ignored."].filter(Boolean).join(" ");
    if (quotes.injection && !out.evidence.some((e) => e.quote === quotes.injection)) out.evidence.push(quoteEv(quotes.injection));
  }
  return out;
}
