// Deterministic analysis of the (untrusted) update. Used to ground the LLM, to build the
// offline fallback, and by policy.js as a floor the LLM can raise but never lower.
import { findOutlet, findSku, lookupRow } from "./data.js";

const SIGNALS = {
  injection: /ignore (all |any |the |your )?(previous |prior |above )?(instructions?|rules)|disregard .{0,30}instructions|system prompt|you are now|\bmark (this |it )?(as )?(resolved|closed)\b|\b(set|mark|rate|classify)\b[^.]{0,30}\b(low|lowest) urgency|override/i,
  health: /unwell|\bsick\b|\bill\b|vomit|nausea|diarrh|allerg|hospital|stomach|poison|fell ill|feeling (unwell|sick|ill)/i,
  damage: /damaged|leak|burst|dent(ed)?\b|expired|expiry|tamper|contaminat|spoil|broken seal|swollen/i,
  stockoutClaim: /out of stock|stock-?out|unavailable|not available|no stock|sold out|ran out|run out/i,
  competitor: /competitor|rival|discounting|price match/i,
  priceDemand: /price match|match (their|the|that) price|match price/i,
  impactClaim: /lost sales|losing sales|major (loss|impact)|revenue/i,
};

// Verbatim clause of the update containing the match, so evidence quotes are always substrings.
function quoteFor(text, re) {
  const m = text.match(re);
  if (!m) return null;
  const start = Math.max(text.lastIndexOf(".", m.index) + 1, text.lastIndexOf(";", m.index) + 1, 0);
  const endCandidates = [".", ";"].map((c) => text.indexOf(c, m.index + m[0].length)).filter((i) => i >= 0);
  const end = endCandidates.length ? Math.min(...endCandidates) + 1 : text.length;
  return text.slice(start, end).trim();
}

export function analyze(update) {
  const text = update.trim();
  const outlet = findOutlet(text);
  const sku = findSku(text);
  const row = outlet && sku ? lookupRow(outlet, sku) : null;
  const hit = Object.fromEntries(Object.entries(SIGNALS).map(([k, re]) => [k, re.test(text)]));
  const quotes = Object.fromEntries(
    Object.entries(SIGNALS).filter(([k]) => hit[k]).map(([k, re]) => [k, quoteFor(text, re)])
  );
  return { text, outlet, sku, row, hit, quotes };
}
