/**
 * Calculate Fraksi based on stock price
 * Rules:
 * - < 200: Fraksi 1
 * - 200-499: Fraksi 2
 * - 500-1999: Fraksi 5
 * - 2000-4999: Fraksi 10
 * - >= 5000: Fraksi 25
 */
export function getFraksi(harga: number): number {
  if (harga < 200) return 1;
  if (harga >= 200 && harga < 500) return 2;
  if (harga >= 500 && harga < 2000) return 5;
  if (harga >= 2000 && harga < 5000) return 10;
  return 25; // harga >= 5000
}

/**
 * Calculate target prices based on broker and market data
 */
export function calculateTargets(
  rataRataBandar: number,
  barangBandar: number,
  ara: number,
  arb: number,
  totalBid: number,
  totalOffer: number,
  harga: number
) {
  const safeHarga = Number.isFinite(harga) && harga > 0 ? harga : rataRataBandar;
  // Calculate Fraksi
  const fraksi = getFraksi(safeHarga);

  // Total Papan = (ARA - ARB) / Fraksi
  const rawTotalPapan = (ara - arb) / fraksi;
  const totalPapan = Number.isFinite(rawTotalPapan) && rawTotalPapan > 0 ? rawTotalPapan : 1;

  // Rata rata Bid Ofer = (Total Bid + Total Offer) / Total Papan
  const depth = Math.max(0, totalBid) + Math.max(0, totalOffer);
  const rawAverage = depth > 0 ? depth / totalPapan : null;
  const rataRataBidOfer = rawAverage !== null && Number.isFinite(rawAverage) && rawAverage > 0 ? rawAverage : null;

  // a = Rata rata bandar × 5%
  const a = rataRataBandar * 0.05;

  // p = Barang Bandar / Rata rata Bid Ofer
  const p = rataRataBidOfer !== null && Number.isFinite(barangBandar) && barangBandar >= 0 ? barangBandar / rataRataBidOfer : null;

  // Target Realistis = Rata rata bandar + a + (p/2 × Fraksi)
  const targetRealistis1 = p === null ? null : rataRataBandar + a + ((p / 2) * fraksi);

  // Target Max = Rata rata bandar + a + (p × Fraksi)
  const targetMax = p === null ? null : rataRataBandar + a + (p * fraksi);

  return {
    fraksi,
    totalPapan: Math.round(totalPapan),
    rataRataBidOfer: rataRataBidOfer === null ? null : Math.round(rataRataBidOfer),
    a: Math.round(a),
    p: p === null ? null : Math.round(p),
    targetRealistis1: targetRealistis1 === null ? null : Math.round(targetRealistis1),
    targetMax: targetMax === null ? null : Math.round(targetMax),
  };
}
