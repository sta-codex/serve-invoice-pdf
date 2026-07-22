export function formatNumber(value, digits = 3) {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: true
  }).format(value || 0);
}

export function formatCurrency(value) {
  return `${new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true
  }).format(value || 0)} \u20ac`;
}

export function formatPrice(value) {
  return `${new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true
  }).format(value || 0)} \u20ac`;
}

export function roundMoney(value) {
  return Math.round((value || 0) * 100) / 100;
}

export function buildMeasure({ thickness, width, length, fallback }) {
  if (fallback) return normalizeThicknessInMeasure(fallback);
  const parts = [thickness, width, length].filter(
    (part) => part !== undefined && part !== null && part !== ""
  );
  return parts.map((part, index) =>
    index === 0 ? formatThickness(part) : String(part).replace(".", ",")
  ).join(" x ");
}

export function normalizeThicknessInMeasure(value) {
  const text = String(value || "");
  return text.replace(/(\d+(?:[.,]\d+)?)\s*x\s*\d+/i, (match, thickness) =>
    `${formatThickness(thickness)}${match.slice(thickness.length)}`
  );
}

function formatThickness(value) {
  const normalized = String(value).replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed)
    ? formatNumber(parsed, 2)
    : String(value).replace(".", ",");
}
