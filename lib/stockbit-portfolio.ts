import { getSessionValue, upsertSession } from './supabase';

const EXODUS = 'https://exodus.stockbit.com';
const CARINA = 'https://carina.stockbit.com';
const ACCESS_KEY = 'stockbit_securities_token';
const REFRESH_KEY = 'stockbit_securities_refresh_token';

const browserHeaders = (token?: string): HeadersInit => ({
  accept: 'application/json',
  'content-type': 'application/json',
  origin: 'https://stockbit.com',
  referer: 'https://stockbit.com/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/144 Safari/537.36',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

function findString(value: unknown, keys: RegExp): string | undefined {
  const seen = new Set<object>();
  const walk = (node: unknown): string | undefined => {
    if (!node || typeof node !== 'object' || seen.has(node as object)) return undefined;
    seen.add(node as object);
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (keys.test(key) && typeof child === 'string' && child) return child;
      const nested = walk(child); if (nested) return nested;
    }
  };
  return walk(value);
}

function tokenExpiry(token: string): Date | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { exp?: number };
    return payload.exp ? new Date(payload.exp * 1000) : undefined;
  } catch { return undefined; }
}

async function json(response: Response, context: string) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = findString(body, /^(message|error|detail)$/i) || `${context} gagal (${response.status})`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body;
}

async function saveTokens(body: unknown) {
  const access = findString(body, /^(access_?token|token)$/i);
  const refresh = findString(body, /^refresh_?token$/i);
  if (!access) throw new Error('Stockbit tidak mengembalikan access token sekuritas.');
  await upsertSession(ACCESS_KEY, access, tokenExpiry(access));
  if (refresh) await upsertSession(REFRESH_KEY, refresh);
  return access;
}

export async function connectStockbitSecurities(pin: string) {
  if (!/^\d{4,8}$/.test(pin)) throw Object.assign(new Error('PIN trading harus terdiri dari 4–8 digit.'), { status: 400 });
  const mainToken = await getSessionValue('stockbit_token');
  if (!mainToken) throw Object.assign(new Error('Token utama Stockbit belum terhubung.'), { status: 401 });
  const grantBody = await json(await fetch(`${EXODUS}/sekuritas/auth/token`, {
    headers: browserHeaders(mainToken), cache: 'no-store', redirect: 'error',
  }), 'Mengambil izin sekuritas');
  // Stockbit currently returns the grant as `data.token`; older web bundles
  // named the same value `login_token`. Accept both response generations.
  const loginToken = findString(grantBody, /^(login_?token|token)$/i);
  if (!loginToken) throw new Error('Login token sekuritas tidak ditemukan. Perbarui token Stockbit utama.');
  const loginBody = await json(await fetch(`${CARINA}/auth/v2/login`, {
    method: 'POST', headers: browserHeaders(), body: JSON.stringify({ login_token: loginToken, pin }),
    cache: 'no-store', redirect: 'error',
  }), 'Login sekuritas');
  await saveTokens(loginBody);
}

let securitiesRefreshInFlight: Promise<string | null> | null = null;

async function performSecuritiesRefresh() {
  const refresh = await getSessionValue(REFRESH_KEY);
  if (!refresh) return null;
  const response = await fetch(`${CARINA}/auth/refresh`, {
    method: 'POST', headers: browserHeaders(), body: JSON.stringify({ refresh_token: refresh }),
    cache: 'no-store', redirect: 'error',
  });
  if (!response.ok) return null;
  return saveTokens(await response.json());
}

function refreshSecuritiesToken() {
  if (securitiesRefreshInFlight) return securitiesRefreshInFlight;
  securitiesRefreshInFlight = performSecuritiesRefresh().finally(() => {
    securitiesRefreshInFlight = null;
  });
  return securitiesRefreshInFlight;
}

async function carinaGet(path: string) {
  let access = await getSessionValue(ACCESS_KEY);
  if (!access) throw Object.assign(new Error('Sesi sekuritas belum terhubung.'), { status: 401, code: 'SECURITIES_AUTH_REQUIRED' });
  let response = await fetch(`${CARINA}${path}`, { headers: browserHeaders(access), cache: 'no-store', redirect: 'error' });
  if (response.status === 401) {
    access = await refreshSecuritiesToken();
    if (!access) throw Object.assign(new Error('Sesi sekuritas kedaluwarsa. Hubungkan kembali dengan PIN trading.'), { status: 401, code: 'SECURITIES_AUTH_REQUIRED' });
    response = await fetch(`${CARINA}${path}`, { headers: browserHeaders(access), cache: 'no-store', redirect: 'error' });
  }
  return json(response, 'Mengambil data portofolio');
}

type Row = Record<string, unknown>;
const num = (row: Row, keys: string[]) => { for (const key of keys) { const value = Number(row[key]); if (Number.isFinite(value)) return value; } return undefined; };
const text = (row: Row, keys: string[]) => { for (const key of keys) if (typeof row[key] === 'string' && row[key]) return String(row[key]); return undefined; };
function payload(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const first = (body as Row).data;
  return first && typeof first === 'object' && !Array.isArray(first) && 'data' in (first as Row) ? (first as Row).data : first;
}
function rows(body: unknown): Row[] {
  const value = payload(body); if (Array.isArray(value)) return value as Row[];
  if (!value || typeof value !== 'object') return [];
  const object = value as Row;
  for (const key of ['list', 'results', 'result', 'items', 'rows', 'portfolio', 'positions', 'data']) if (Array.isArray(object[key])) return object[key] as Row[];
  return [];
}

function objectAt(row: Row, key: string): Row {
  const value = row[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

export async function fetchStockbitPortfolio() {
  const [listResult, summaryResult, cashResult] = await Promise.allSettled([
    carinaGet('/portfolio/v2/list'), carinaGet('/portfolio/v2/summary'), carinaGet('/balance/cash'),
  ]);
  if (listResult.status === 'rejected') throw listResult.reason;
  const holdings = rows(listResult.value).map((row, index) => {
    const company = objectAt(row, 'company');
    const quantity = objectAt(row, 'qty');
    const balance = objectAt(quantity, 'balance');
    const available = objectAt(quantity, 'available');
    const priceData = objectAt(row, 'price');
    const averageData = objectAt(priceData, 'average');
    const asset = objectAt(row, 'asset');
    const unrealised = objectAt(asset, 'unrealised');
    const lots = num(balance, ['lot']) ?? num(row, ['lot', 'lots', 'total_lot', 'totalLot', 'lot_balance', 'balance_lot']) ?? 0;
    const shares = num(row, ['shares', 'share', 'balance', 'total_balance', 'quantity', 'qty', 'volume']);
    return {
      id: text(row, ['id', 'company_id']) || `${text(row, ['symbol', 'stock_code', 'stockCode', 'code', 'ticker'])}-${index}`,
      symbol: text(row, ['symbol', 'stock_code', 'stockCode', 'code', 'ticker']) || 'N/A',
      name: text(company, ['name']) || text(row, ['name', 'company_name', 'companyName']) || '',
      lots: lots || (shares && shares % 100 === 0 ? shares / 100 : 0),
      availableLots: num(available, ['lot']) ?? num(row, ['available_lot', 'availableLot', 'sellable_lot', 'lot_available']) ?? 0,
      average: num(averageData, ['price']) ?? num(row, ['average_price', 'avg_price', 'avgPrice', 'averagePrice', 'price_avg', 'buy_average']) ?? 0,
      price: num(priceData, ['latest']) ?? num(row, ['current_price', 'last_price', 'lastPrice', 'market_price', 'marketPrice', 'close_price', 'last']) ?? 0,
      invested: num(asset, ['amount_invested']) ?? num(row, ['total_cost', 'cost', 'investment_value', 'buy_value', 'average_value']),
      marketValue: num(unrealised, ['market_value']) ?? num(row, ['market_value', 'marketValue', 'current_value', 'value']),
      profit: num(unrealised, ['profit_loss']) ?? num(row, ['unrealized_pnl', 'unrealized_pl', 'potential_gain', 'gain_loss', 'profit_loss', 'pl']),
      percentage: (() => {
        const gainRatio = num(unrealised, ['gain']);
        return gainRatio !== undefined
          ? gainRatio * 100
          : num(row, ['unrealized_pnl_percent', 'unrealized_pl_percent', 'gain_loss_percent', 'profit_loss_percent', 'pl_percent', 'percentage']);
      })(),
    };
  });
  const summaryPayload = summaryResult.status === 'fulfilled' && payload(summaryResult.value) && typeof payload(summaryResult.value) === 'object' ? payload(summaryResult.value) as Row : {};
  const summary = Object.keys(objectAt(summaryPayload, 'aggregated_portfolio_summary')).length
    ? objectAt(summaryPayload, 'aggregated_portfolio_summary')
    : objectAt(payload(listResult.value) as Row, 'summary');
  const summaryTrading = objectAt(summary, 'trading');
  const summaryAmount = objectAt(summary, 'amount');
  const summaryProfit = objectAt(summary, 'profit_loss');
  const cash = cashResult.status === 'fulfilled' && payload(cashResult.value) && typeof payload(cashResult.value) === 'object' ? payload(cashResult.value) as Row : {};
  return {
    holdings,
    totals: {
      tradingBalance: num(summaryTrading, ['balance']) ?? num(cash, ['available_cash_on_hand', 'buying_power', 'buyingPower', 'trading_limit', 'balance', 'cash_balance', 'cash']),
      invested: num(summaryAmount, ['invested']) ?? num(summary, ['total_cost', 'investment_value', 'cost', 'buy_value']),
      open: num(summaryAmount, ['allocated']) ?? num(summary, ['open', 'open_order', 'open_orders']),
      profit: num(summaryProfit, ['net']) ?? num(summary, ['unrealized_pnl', 'unrealized_pl', 'potential_gain', 'gain_loss', 'profit_loss']),
      percentage: num(summary, ['gain']) !== undefined
        ? num(summary, ['gain'])! * 100
        : num(summary, ['unrealized_pnl_percent', 'gain_loss_percent', 'profit_loss_percent', 'percentage']),
      equity: num(summary, ['equity']) ?? num(summary, ['total_equity', 'totalEquity', 'net_asset_value', 'total_asset', 'market_value', 'total_market_value']),
    },
    updatedAt: new Date().toISOString(),
  };
}
