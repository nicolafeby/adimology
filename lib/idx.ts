export interface IdxListedCompany {
  KodeEmiten: string;
  NamaEmiten: string;
  Sektor?: string | null;
  PapanPencatatan?: string | null;
  EfekEmiten_Saham?: boolean;
}

interface IdxCompanyResponse { recordsTotal?: number; data?: IdxListedCompany[] }

const IDX_COMPANIES_URL = 'https://block.idx.id/primary/ListedCompany/GetCompanyProfiles?start=0&length=2000';

/** Fetch the complete listed-equity universe from the official IDX mirror. */
export async function fetchIdxListedCompanies(): Promise<IdxListedCompany[]> {
  const response = await fetch(IDX_COMPANIES_URL, {
    headers: { accept: 'application/json', 'user-agent': 'Adimology Market Screener/1.0' },
    cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`IDX universe API error: ${response.status} ${response.statusText}`);
  const json = await response.json() as IdxCompanyResponse;
  const rows = (json.data ?? []).filter((row) => row.EfekEmiten_Saham !== false && /^[A-Z0-9]{4,12}$/.test(String(row.KodeEmiten || '').toUpperCase()));
  if (rows.length < 500) throw new Error(`IDX universe tidak lengkap: hanya ${rows.length} emiten diterima`);
  return rows;
}
