import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface AnalysisRecord {
  id: number;
  from_date: string;
  emiten: string;
  sector?: string;
  bandar?: string;
  barang_bandar?: number;
  rata_rata_bandar?: number;
  harga?: number;
  target_realistis?: number;
  target_max?: number;
  max_harga?: number;
  real_harga?: number;
  status: string;
  error_message?: string;
}

// --- Shared Helpers and Constants ---

const successGreen: [number, number, number] = [21, 128, 61];
const warningRed: [number, number, number] = [185, 28, 28];
const accentBlue: [number, number, number] = [37, 99, 235];
const darkGray: [number, number, number] = [100, 100, 100];

const formatNumber = (num?: number) => num?.toLocaleString() ?? '-';

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const day = date.getDate();
  const month = date.toLocaleDateString('id-ID', { month: 'short' }).replace('.', '');
  return `${day}-${month}`;
};

const calculateGain = (price: number | undefined, target: number | undefined) => {
  if (!price || !target || price === 0) return '';
  const gain = ((target - price) / price) * 100;
  return `${gain >= 0 ? '+' : ''}${gain.toFixed(1)}%`;
};

const drawPerformanceChart = (doc: any, cell: any, record: any) => {
  const { x, y, width, height } = cell;
  const paddingLeft = 4;
  const paddingRight = 4;
  const chartWidth = width - paddingLeft - paddingRight;
  const centerY = y + (height / 2);

  const prices = [
    record.harga,
    record.target_realistis,
    record.target_max,
    record.max_harga,
    record.real_harga
  ].filter(p => p != null && p > 0) as number[];

  if (prices.length === 0) return;

  const minP = Math.min(...prices) * 0.98;
  const maxP = Math.max(...prices) * 1.02;
  const range = maxP - minP || 1;

  const getX = (price: number) => x + paddingLeft + ((price - minP) / range) * chartWidth;

  // Draw target lines
  if (record.target_realistis) {
    doc.setDrawColor(21, 128, 61);
    doc.setGState(new (doc as any).GState({ opacity: 0.3 }));
    doc.setLineWidth(0.4);
    const tx = getX(record.target_realistis);
    doc.line(tx, y + 2, tx, y + height - 2);
    doc.setGState(new (doc as any).GState({ opacity: 1.0 }));
  }
  if (record.target_max) {
    doc.setDrawColor(185, 28, 28);
    doc.setGState(new (doc as any).GState({ opacity: 0.3 }));
    doc.setLineWidth(0.4);
    const tx = getX(record.target_max);
    doc.line(tx, y + 2, tx, y + height - 2);
    doc.setGState(new (doc as any).GState({ opacity: 1.0 }));
  }

  // Draw dots
  if (record.harga) {
    doc.setFillColor(156, 163, 175);
    doc.circle(getX(record.harga), centerY, 1.1, 'F');
  }
  if (record.max_harga) {
    const isMetMax = record.target_max && record.max_harga >= record.target_max;
    const isMetR1 = record.target_realistis && record.max_harga >= record.target_realistis;
    if (isMetMax) doc.setFillColor(185, 28, 28);
    else if (isMetR1) doc.setFillColor(21, 128, 61);
    else doc.setFillColor(156, 163, 175);
    doc.circle(getX(record.max_harga), centerY, 1.1, 'F');
  }
  if (record.real_harga) {
    const isMetMax = record.target_max && record.real_harga >= record.target_max;
    const isMetR1 = record.target_realistis && record.real_harga >= record.target_realistis;
    if (isMetMax) doc.setFillColor(185, 28, 28);
    else if (isMetR1) doc.setFillColor(21, 128, 61);
    else doc.setFillColor(31, 41, 55);
    doc.circle(getX(record.real_harga), centerY, 1.1, 'F');
  }
};

const getTableColumn = () => [
  'Date',
  'Emiten',
  'Harga',
  'Target R1',
  'Target Max',
  'Max Harga',
  'Close Harga',
  'Bandar',
  'Vol Bandar',
  'Avg Bandar',
  'Performance'
];

const getTableRows = (data: AnalysisRecord[]) => data.map(record => {
  const r1Gain = calculateGain(record.harga, record.target_realistis);
  const maxGain = calculateGain(record.harga, record.target_max);
  const maxHargaGain = calculateGain(record.harga, record.max_harga);
  const closeHargaGain = calculateGain(record.harga, record.real_harga);

  let avgGain = '';
  if (record.rata_rata_bandar && record.harga) {
    avgGain = calculateGain(record.rata_rata_bandar, record.harga);
  }

  return [
    formatDate(record.from_date),
    record.emiten,
    formatNumber(record.harga),
    r1Gain ? `${formatNumber(record.target_realistis)}\n${r1Gain}` : formatNumber(record.target_realistis),
    maxGain ? `${formatNumber(record.target_max)}\n${maxGain}` : formatNumber(record.target_max),
    maxHargaGain ? `${formatNumber(record.max_harga)}\n${maxHargaGain}` : formatNumber(record.max_harga),
    closeHargaGain ? `${formatNumber(record.real_harga)}\n${closeHargaGain}` : formatNumber(record.real_harga),
    record.bandar || '-',
    formatNumber(record.barang_bandar),
    avgGain ? `${formatNumber(record.rata_rata_bandar)}\n${avgGain}` : formatNumber(record.rata_rata_bandar),
    '' // Performance chart
  ];
});

const getAutoTableConfig = (doc: any, data: AnalysisRecord[]) => ({
  styles: {
    fontSize: 8,
    cellPadding: { top: 2, right: 1.5, bottom: 2, left: 1.5 } as any,
    valign: 'middle' as any,
    minCellHeight: 10,
  },
  headStyles: {
    fillColor: [20, 20, 31] as any,
    textColor: [255, 255, 255] as any,
    fontStyle: 'bold' as any,
    fontSize: 8,
    halign: 'center' as any,
  },
  columnStyles: {
    0: { cellWidth: 14 }, // Date
    1: { fontStyle: 'bold' as any, textColor: accentBlue, cellWidth: 15 }, // Emiten
    2: { halign: 'right' as any, cellWidth: 14 }, // Harga
    3: { halign: 'right' as any, textColor: successGreen, cellWidth: 17 }, // Target R1
    4: { halign: 'right' as any, textColor: warningRed, cellWidth: 17 }, // Target Max
    5: { halign: 'right' as any, cellWidth: 17 }, // Max Harga
    6: { halign: 'right' as any, cellWidth: 17 }, // Close Harga
    7: { halign: 'left' as any, cellWidth: 14 }, // Bandar
    8: { halign: 'right' as any, fontSize: 7, cellWidth: 16 }, // Vol Bandar
    9: { halign: 'right' as any, cellWidth: 17 }, // Avg Bandar
    10: { cellWidth: 28 }, // Performance Chart
  },
  alternateRowStyles: {
    fillColor: [248, 249, 250] as any,
  },
  willDrawCell: (data: any) => {
    if (data.section === 'body') {
      if ([3, 4, 5, 6, 9].includes(data.column.index)) {
        if (Array.isArray(data.cell.text) && data.cell.text.length > 1) {
          (data.cell as any)._fullText = [...data.cell.text];
          data.cell.text = [];
        }
      }
    }
  },
  didDrawCell: (cellData: any) => {
    if (cellData.section === 'body') {
      const record = data[cellData.row.index];

      if ([3, 4, 5, 6, 9].includes(cellData.column.index)) {
        const fullText = (cellData.cell as any)._fullText;
        if (Array.isArray(fullText) && fullText.length > 1) {
          const primaryText = fullText[0];
          const percentageText = fullText[1];

          const padding = 2;
          const x = cellData.cell.x + cellData.cell.width - padding;
          const centerY = cellData.cell.y + (cellData.cell.height / 2);

          let mainColor = cellData.cell.styles.textColor || [0, 0, 0];
          let isBold = cellData.cell.styles.fontStyle === 'bold';

          if ([5, 6].includes(cellData.column.index)) {
            const val = cellData.column.index === 5 ? record.max_harga : record.real_harga;
            if (val && record.harga) {
              if (record.target_max && val >= record.target_max) {
                mainColor = warningRed;
                isBold = true;
              } else if (record.target_realistis && val >= record.target_realistis) {
                mainColor = successGreen;
                isBold = true;
              } else if (val > record.harga) {
                mainColor = [180, 120, 0]; // Amber
                isBold = true;
              } else {
                mainColor = [40, 40, 40];
                isBold = false;
              }
            }
          }

          const [r, g, b] = Array.isArray(mainColor) ? mainColor : [40, 40, 40];
          doc.setTextColor(r, g, b);
          doc.setFontSize(cellData.cell.styles.fontSize || 8);
          doc.setFont('helvetica', isBold ? 'bold' : 'normal');
          doc.text(primaryText, x, centerY - 1, { align: 'right' });

          doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
          doc.setFontSize(6.5);
          doc.setFont('helvetica', 'normal');
          doc.text(percentageText, x, centerY + 3.5, { align: 'right' });
        }
      }

      if (cellData.column.index === 10) {
        drawPerformanceChart(doc, cellData.cell, record);
      }
    }
  }
});

// --- Main Export Functions ---

export const exportHistoryToPDF = (data: AnalysisRecord[], filters: any) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  doc.setFontSize(16);
  doc.setTextColor(40);
  doc.text('RIWAYAT COCOKOLOGI (FILTERED)', 14, 15);

  doc.setFontSize(9);
  doc.setTextColor(100);
  let filterText = 'Filters: ';
  if (filters.emiten) filterText += `Emiten: ${filters.emiten} | `;
  if (filters.fromDate) filterText += `From: ${filters.fromDate} | `;
  if (filters.toDate) filterText += `To: ${filters.toDate} | `;
  filterText += `Status: ${filters.status === 'all' ? 'Semua' : filters.status}`;
  doc.text(filterText, 14, 21);

  // Calculate Aggregates
  const stats = data.reduce((acc, r) => {
    const avgG = (r.rata_rata_bandar && r.harga) ? ((r.harga - r.rata_rata_bandar) / r.rata_rata_bandar) * 100 : null;
    if (avgG !== null) {
      if (avgG > 0) acc.bandarPlus++;
      else acc.bandarMinus++;
    }
    const hitR1 = (r.target_realistis && ((r.max_harga && r.max_harga >= r.target_realistis) || (r.real_harga && r.real_harga >= r.target_realistis)));
    const hitMax = (r.target_max && ((r.max_harga && r.max_harga >= r.target_max) || (r.real_harga && r.real_harga >= r.target_max)));
    if (hitR1) acc.hitR1++;
    if (hitMax) acc.hitMax++;
    if (r.bandar) {
      acc.bandarCounts[r.bandar] = (acc.bandarCounts[r.bandar] || 0) + 1;
    }
    return acc;
  }, { bandarMinus: 0, bandarPlus: 0, hitR1: 0, hitMax: 0, bandarCounts: {} as Record<string, number> });

  // Format bandar summary
  const bandarSummary = Object.entries(stats.bandarCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}: ${count}`)
    .join(' | ');

  doc.setFontSize(8.5);
  doc.setTextColor(60);
  doc.text(`Stats: Hit R1: ${stats.hitR1} | Hit Max: ${stats.hitMax} | Avg Bandar Plus: ${stats.bandarPlus} | Avg Bandar Minus-Nol: ${stats.bandarMinus}`, 14, 26);
  doc.text(`Bandar: ${bandarSummary}`, 14, 30.5);

  autoTable(doc, {
    head: [getTableColumn()],
    body: getTableRows(data),
    startY: 34.5,
    ...getAutoTableConfig(doc, data)
  } as any);

  const timestamp = new Date().toISOString().split('T')[0];
  doc.save(`watchlist-filtered-${timestamp}.pdf`);
};

export const exportHistoryByEmitenToPDF = async (
  data: AnalysisRecord[],
  filters: any,
  recordsPerEmiten: number = 10
) => {
  if (!data || data.length === 0) {
    alert('Tidak ada data untuk di-export');
    return;
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // 1. Get ALL unique emitens matching filters (ignoring pagination)
  const fetchParams = new URLSearchParams();
  if (filters.emiten) fetchParams.append('emiten', filters.emiten);
  if (filters.sector !== 'all') fetchParams.append('sector', filters.sector);
  if (filters.fromDate) fetchParams.append('fromDate', filters.fromDate);
  if (filters.toDate) fetchParams.append('toDate', filters.toDate);
  if (filters.status !== 'all') fetchParams.append('status', filters.status);
  fetchParams.append('limit', '5000'); // Fetch enough to cover all unique emitens

  const initialRes = await fetch(`/api/watchlist-history?${fetchParams}`);
  const initialJson = await initialRes.json();
  const allRecords = (initialJson.data || []) as AnalysisRecord[];
  const uniqueEmitens = Array.from(new Set(allRecords.map(r => r.emiten))).sort();
  const groupedData: { [emiten: string]: AnalysisRecord[] } = {};

  await Promise.all(uniqueEmitens.map(async (emiten) => {
    try {
      const params = new URLSearchParams({
        emiten: emiten.toUpperCase(),
        limit: String(recordsPerEmiten),
        sortBy: 'from_date',
        sortOrder: 'desc',
      });
      if (filters.sector && filters.sector !== 'all') params.append('sector', filters.sector);
      if (filters.fromDate) params.append('fromDate', filters.fromDate);
      if (filters.toDate) params.append('toDate', filters.toDate);
      if (filters.status && filters.status !== 'all') params.append('status', filters.status);

      const response = await fetch(`/api/watchlist-history?${params}`);
      const json = await response.json();
      if (json.success) {
        groupedData[emiten] = (json.data || []).reverse();
      }
    } catch (e) {
      console.error(`Failed to fetch history for ${emiten}`, e);
      groupedData[emiten] = data.filter(r => r.emiten === emiten);
    }
  }));

  const emitens = Object.keys(groupedData).sort();
  let isFirstPage = true;

  emitens.forEach((emiten) => {
    const emitenData = groupedData[emiten];
    if (emitenData.length === 0) return;

    if (!isFirstPage) {
      doc.addPage();
    }
    isFirstPage = false;

    doc.setFontSize(16);
    doc.setTextColor(40);
    doc.text(`RIWAYAT ADIMOLOGY ${emiten} (${emitenData.length} TERAKHIR)`, 14, 15);

    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Status: ${filters.status === 'all' ? 'Semua' : filters.status}`, 14, 21);

    // Calculate Aggregates for this local emiten data
    const stats = emitenData.reduce((acc, r) => {
      const avgG = (r.rata_rata_bandar && r.harga) ? ((r.harga - r.rata_rata_bandar) / r.rata_rata_bandar) * 100 : null;
      if (avgG !== null) {
        if (avgG > 0) acc.bandarPlus++;
        else acc.bandarMinus++;
      }
      const hitR1 = (r.target_realistis && ((r.max_harga && r.max_harga >= r.target_realistis) || (r.real_harga && r.real_harga >= r.target_realistis)));
      const hitMax = (r.target_max && ((r.max_harga && r.max_harga >= r.target_max) || (r.real_harga && r.real_harga >= r.target_max)));
      if (hitR1) acc.hitR1++;
      if (hitMax) acc.hitMax++;
      if (r.bandar) {
        acc.bandarCounts[r.bandar] = (acc.bandarCounts[r.bandar] || 0) + 1;
      }
      return acc;
    }, { bandarMinus: 0, bandarPlus: 0, hitR1: 0, hitMax: 0, bandarCounts: {} as Record<string, number> });

    // Format bandar summary
    const bandarSummary = Object.entries(stats.bandarCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}: ${count}`)
      .join(' | ');

    doc.setFontSize(8.5);
    doc.setTextColor(60);
    doc.text(`Stats: Hit R1: ${stats.hitR1} | Hit Max: ${stats.hitMax} | Avg Bandar Plus: ${stats.bandarPlus} | Avg Bandar Minus-Nol: ${stats.bandarMinus}`, 14, 26);
    doc.text(`Bandar: ${bandarSummary}`, 14, 30.5);

    autoTable(doc, {
      head: [getTableColumn()],
      body: getTableRows(emitenData),
      startY: 34.5,
      ...getAutoTableConfig(doc, emitenData)
    } as any);

    const pageCount = emitens.indexOf(emiten) + 1;
    const totalPages = emitens.length;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Halaman ${pageCount} dari ${totalPages}`, doc.internal.pageSize.width - 14, doc.internal.pageSize.height - 10, { align: 'right' });
  });

  const timestamp = new Date().toISOString().split('T')[0];
  doc.save(`watchlist-by-emiten-${timestamp}.pdf`);
};
