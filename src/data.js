// Fictional verified data (from the exercise brief). The only source of truth for stock.
export const VERIFIED_STOCK = [
  { outlet: "Indiranagar Mart", sku: "Cola 500ml", system_stock: 0 },
  { outlet: "Metro Fresh", sku: "Cola 500ml", system_stock: 48 },
  { outlet: "City Corner", sku: "Juice 1L", system_stock: 12 },
];

const OUTLET_ALIASES = {
  "Indiranagar Mart": ["indiranagar mart", "indranagar mart", "indira nagar mart"],
  "Metro Fresh": ["metro fresh"],
  "City Corner": ["city corner"],
};
const SKU_ALIASES = {
  "Cola 500ml": ["cola 500ml", "cola 500 ml", "cola"],
  "Juice 1L": ["juice 1l", "juice 1 l", "juice 1 litre", "juice"],
};

const find = (aliases, text) =>
  Object.keys(aliases).find((k) => aliases[k].some((a) => text.includes(a))) ?? null;

export const findOutlet = (text) => find(OUTLET_ALIASES, text.toLowerCase());
export const findSku = (text) => find(SKU_ALIASES, text.toLowerCase());
export const lookupRow = (outlet, sku) =>
  VERIFIED_STOCK.find((r) => r.outlet === outlet && r.sku === sku) ?? null;
