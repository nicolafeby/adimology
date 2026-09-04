import type { KeyStatsData, KeyStatsItem } from './types';

const normalize = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const empty = (): KeyStatsData => ({ currentValuation: [], incomeStatement: [], balanceSheet: [], profitability: [], growth: [] });

function asItem(value: unknown, fallbackId: string): KeyStatsItem | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const nested = row.fitem ?? row.item;
  if (nested && nested !== value) return asItem(nested, fallbackId);
  const name = row.name ?? row.fin_name ?? row.label ?? row.title;
  const itemValue = row.value ?? row.fin_value ?? row.display_value ?? row.current_value;
  if (typeof name !== 'string' || !['string', 'number'].includes(typeof itemValue)) return null;
  return { id: String(row.id ?? row.fitem_id ?? fallbackId), name, value: String(itemValue) };
}

type Section = keyof Omit<KeyStatsData, 'warning'>;
function categorySection(value: unknown): Section | null {
  const name = normalize(value);
  if (/valu|market multiple|price ratio/.test(name)) return 'currentValuation';
  if (/income|laba rugi|earnings/.test(name)) return 'incomeStatement';
  if (/balance|neraca|financial position/.test(name)) return 'balanceSheet';
  if (/profit|margin|return ratio/.test(name)) return 'profitability';
  if (/growth|pertumbuhan/.test(name)) return 'growth';
  return null;
}

function itemSection(name: string): Section | null {
  const key = normalize(name);
  if (/\b(pe|pbv|ev|yield|valuation)\b|market cap|price to|p sales/.test(key)) return 'currentValuation';
  if (/revenue|gross profit|ebitda|net income|operating income/.test(key)) return 'incomeStatement';
  if (/asset|liabilit|equity|cash|debt|working capital/.test(key)) return 'balanceSheet';
  if (/margin|return on|\broa\b|\broe\b|\broic\b/.test(key)) return 'profitability';
  if (/growth|cagr|yoy/.test(key)) return 'growth';
  return null;
}

/** Parse supported Stockbit variants without fabricating missing financial values. */
export function parseKeyStatsResponse(json: unknown): KeyStatsData {
  const output = empty();
  const root = json && typeof json === 'object' ? json as Record<string, unknown> : {};
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
  const candidate = data.closure_fin_items_results ?? data.fin_items_results ?? data.keystats ?? data.results;
  const categories = Array.isArray(candidate) ? candidate : [];
  const uncategorized: KeyStatsItem[] = [];
  categories.forEach((raw, categoryIndex) => {
    if (!raw || typeof raw !== 'object') return;
    const category = raw as Record<string, unknown>;
    const section = categorySection(category.keystats_name ?? category.name ?? category.title ?? category.category);
    const rows = category.fin_name_results ?? category.items ?? category.fin_items ?? category.data;
    if (!Array.isArray(rows)) return;
    const items = rows.map((row, index) => asItem(row, `${categoryIndex}-${index}`)).filter((row): row is KeyStatsItem => row !== null);
    if (section) output[section].push(...items); else uncategorized.push(...items);
  });
  for (const item of uncategorized) { const section = itemSection(item.name); if (section) output[section].push(item); }
  for (const section of ['currentValuation', 'incomeStatement', 'balanceSheet', 'profitability', 'growth'] as const) output[section] = [...new Map(output[section].map((item) => [`${normalize(item.name)}:${item.value}`, item])).values()];
  const count = output.currentValuation.length + output.incomeStatement.length + output.balanceSheet.length + output.profitability.length + output.growth.length;
  if (!count) output.warning = 'Key Stats tidak tersedia dari Stockbit untuk emiten ini atau format respons belum didukung.';
  return output;
}
