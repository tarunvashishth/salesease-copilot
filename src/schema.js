// Output contract. One definition drives the LLM tool schema and the runtime validator.
export const CATEGORIES = [
  "stockout", // verified out of stock at the outlet
  "stock_discrepancy", // rep's claim conflicts with the verified table
  "competitor_activity",
  "quality_safety", // damaged product and/or customer health
  "suspicious_input", // update tries to instruct the system
  "unclear", // cannot ground the update
];
export const URGENCIES = ["low", "medium", "high", "critical"];
export const SOURCES = ["field_update", "verified_table"];

export const OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "issue_category", "urgency", "evidence", "recommended_next_action",
    "missing_information", "needs_human_review", "review_reason",
  ],
  properties: {
    issue_category: { type: "string", enum: CATEGORIES },
    urgency: { type: "string", enum: URGENCIES },
    evidence: {
      type: "array",
      description: "Each item is either a verbatim quote from the field update or an exact verified-table row.",
      items: {
        type: "object",
        properties: {
          source: { type: "string", enum: SOURCES },
          quote: { type: "string", description: "field_update only: verbatim substring of the update" },
          outlet: { type: "string" },
          sku: { type: "string" },
          system_stock: { type: "integer" },
        },
        required: ["source"],
      },
    },
    recommended_next_action: { type: "string", description: "One concrete, non-commercial next step." },
    missing_information: { type: "array", items: { type: "string" } },
    needs_human_review: { type: "boolean" },
    review_reason: { type: ["string", "null"], description: "Required when needs_human_review is true, else null." },
  },
};

export function validateOutput(o) {
  const errors = [];
  const isObj = o && typeof o === "object" && !Array.isArray(o);
  if (!isObj) return ["output is not an object"];
  const keys = OUTPUT_JSON_SCHEMA.required;
  for (const k of keys) if (!(k in o)) errors.push(`missing field: ${k}`);
  for (const k of Object.keys(o)) if (!keys.includes(k)) errors.push(`unexpected field: ${k}`);
  if (!CATEGORIES.includes(o.issue_category)) errors.push("issue_category not allowed");
  if (!URGENCIES.includes(o.urgency)) errors.push("urgency not allowed");
  if (!Array.isArray(o.evidence)) errors.push("evidence must be an array");
  else
    o.evidence.forEach((e, i) => {
      if (!e || !SOURCES.includes(e.source)) return errors.push(`evidence[${i}].source invalid`);
      if (e.source === "field_update" && (typeof e.quote !== "string" || !e.quote.trim()))
        errors.push(`evidence[${i}] needs a quote`);
      if (e.source === "verified_table" &&
          (typeof e.outlet !== "string" || typeof e.sku !== "string" || !Number.isInteger(e.system_stock)))
        errors.push(`evidence[${i}] needs outlet, sku, integer system_stock`);
    });
  if (typeof o.recommended_next_action !== "string" || !o.recommended_next_action.trim())
    errors.push("recommended_next_action must be a non-empty string");
  if (!Array.isArray(o.missing_information) || o.missing_information.some((m) => typeof m !== "string"))
    errors.push("missing_information must be an array of strings");
  if (typeof o.needs_human_review !== "boolean") errors.push("needs_human_review must be boolean");
  if (o.needs_human_review === true && !(typeof o.review_reason === "string" && o.review_reason.trim()))
    errors.push("review_reason required when needs_human_review is true");
  if (o.needs_human_review === false && o.review_reason != null) errors.push("review_reason must be null when no review");
  return errors;
}
