/**
 * Zambia-first formatting helpers.
 * Default currency K (Zambian Kwacha), thousands separator, no decimals.
 */
export const formatMoney = (amount: number | null | undefined, currency = "K") => {
  if (amount == null || isNaN(Number(amount))) return `${currency} 0`;
  const n = Number(amount);
  const formatted = new Intl.NumberFormat("en-ZM", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
  return `${currency} ${formatted}`;
};

export const formatNumber = (n: number | null | undefined) => {
  if (n == null) return "0";
  return new Intl.NumberFormat("en-ZM").format(n);
};

/**
 * Friendly phone display: +260977123456 → +260 977 123 456
 */
export const formatPhone = (raw: string | null | undefined) => {
  if (!raw) return "";
  const v = raw.replace(/[^\d+]/g, "");
  if (v.startsWith("+260") && v.length >= 12) {
    return `+260 ${v.slice(4, 7)} ${v.slice(7, 10)} ${v.slice(10)}`;
  }
  return v;
};
