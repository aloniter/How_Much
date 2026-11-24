// Currencies a table can use, and a sensible default for this phone (₪ for Israeli users).
export const CURRENCIES = [
  { sym: '₪', code: 'ILS' }, { sym: '$', code: 'USD' }, { sym: '€', code: 'EUR' },
  { sym: '£', code: 'GBP' }, { sym: '¥', code: 'JPY' }, { sym: '₹', code: 'INR' },
];
const EURO = new Set(['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK']);
const BY_REGION = { IL: '₪', US: '$', GB: '£', JP: '¥', IN: '₹' };

/**
 * @param {{languages?: string[], timeZone?: string}} env
 * Israeli users (Hebrew, an -IL locale, or an Israeli time zone) get ₪; others by region; fallback $.
 */
export function defaultCurrency({ languages = [], timeZone = '' } = {}) {
  const langs = languages.filter(Boolean);
  if (langs.some(l => /^(he|iw)\b|[-_]IL\b/i.test(l)) || /Asia\/(Jerusalem|Tel_Aviv)/.test(timeZone)) return '₪';
  for (const l of langs) {
    const region = l.split(/[-_]/)[1]?.toUpperCase();
    if (!region) continue;
    if (BY_REGION[region]) return BY_REGION[region];
    if (EURO.has(region)) return '€';
  }
  return '$';
}

export function browserDefaultCurrency() {
  let timeZone = '';
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* old browser */ }
  return defaultCurrency({ languages: [...(navigator.languages || []), navigator.language], timeZone });
}

export const currencyCode = (sym) => CURRENCIES.find(c => c.sym === sym)?.code || sym;
