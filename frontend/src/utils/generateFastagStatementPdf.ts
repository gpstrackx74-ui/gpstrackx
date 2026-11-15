import { jsPDF } from 'jspdf';
import { FastagTransaction } from '../types';
import { AXIS_BANK_LOGO_BASE64 } from './axisBankLogoBase64';
import { GPSTRACKX_LOGO_BASE64 } from './gpsTrackXLogoBase64';
import { RUPEE_ICON_BASE64 } from './rupeeIconBase64';

export interface FastagStatementReportData {
  customerName?: string;
  customerMobile?: string;
  truckNumber: string;
  truckOwnerName?: string;
  startDateStr?: string;
  endDateStr?: string;
  transactions: FastagTransaction[];
}

export function formatMobileNumber(mobile?: string | null): string {
  if (!mobile) return '';
  const digits = String(mobile).replace(/\+91/g, '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function formatTransactionId(rawId?: any): string {
  if (!rawId) return '';
  const s = String(rawId).trim();
  return s.includes('.') ? s.split('.')[0] : s;
}

interface ParsedDateTime {
  sortKey: string;      // 'YYYY-MM-DD'
  displayDate: string;  // 'DD/MM/YYYY'
  timeStr: string;      // 'HH:MM:SS' or 'HH:MM'
}

function parseDateParts(str?: string): ParsedDateTime {
  if (!str) return { sortKey: '0000-00-00', displayDate: 'Unknown Date', timeStr: '--:--' };
  str = String(str).trim();
  let timeStr = '--:--';
  let datePart = str;
  if (str.includes('T')) {
    const parts = str.split('T');
    datePart = parts[0];
    timeStr = parts[1].replace('Z', '').split('.')[0].slice(0, 8);
  } else if (str.includes(' ')) {
    const parts = str.split(/\s+/);
    datePart = parts[0];
    timeStr = parts.slice(1).join(' ').slice(0, 8);
  }
  if (datePart.includes('-')) {
    const p = datePart.split('-');
    if (p[0].length === 4) {
      const y = p[0], m = p[1].padStart(2, '0'), d = p[2].padStart(2, '0');
      return { sortKey: `${y}-${m}-${d}`, displayDate: `${d}/${m}/${y}`, timeStr };
    } else if (p[2]?.length === 4) {
      const d = p[0].padStart(2, '0'), m = p[1].padStart(2, '0'), y = p[2];
      return { sortKey: `${y}-${m}-${d}`, displayDate: `${d}/${m}/${y}`, timeStr };
    }
  } else if (datePart.includes('/')) {
    const p = datePart.split('/');
    if (p[2]?.length === 4) {
      let m = parseInt(p[0], 10);
      let d = parseInt(p[1], 10);
      const y = p[2];
      if (m > 12 && d <= 12) {
        const temp = m; m = d; d = temp;
      }
      const mm = String(m).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      return { sortKey: `${y}-${mm}-${dd}`, displayDate: `${dd}/${mm}/${y}`, timeStr };
    }
  }
  return { sortKey: datePart, displayDate: datePart, timeStr };
}

export function formatDurationDate(dateStr?: string): string {
  if (!dateStr) return '';
  const dt = parseDateParts(dateStr);
  if (!dt.sortKey || dt.sortKey === '0000-00-00') return dateStr;
  const parts = dt.sortKey.split('-');
  const y = parts[0].slice(-2);
  const mIdx = parseInt(parts[1], 10) - 1;
  const d = parts[2].padStart(2, '0');
  const fullMonths = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${d} ${fullMonths[mIdx] || ''} ${y}`;
}

export function formatTableDateTime(crossingTime?: string, createdAt?: string): { dateLine: string; timeLine: string } {
  const dt = parseDateParts(crossingTime || createdAt);
  if (!dt.sortKey || dt.sortKey === '0000-00-00') {
    return { dateLine: dt.displayDate || 'Unknown', timeLine: dt.timeStr || '--:--' };
  }
  const parts = dt.sortKey.split('-');
  const y = parts[0].slice(-2);
  const mIdx = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateLine = `${d} ${shortMonths[mIdx] || ''} ${y}`;

  let timeLine = dt.timeStr;
  if (timeLine && timeLine.includes(':')) {
    const tParts = timeLine.split(':');
    let h = parseInt(tParts[0], 10);
    const m = tParts[1].padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    timeLine = `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  }
  return { dateLine, timeLine };
}

export function parseDescriptionLines(desc?: string): { line1: string; line2: string } {
  if (!desc) return { line1: 'Issuer Debit Transaction for toll fare -', line2: 'Toll Plaza' };
  const raw = String(desc).trim();
  if (raw.includes('\n')) {
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length >= 2) {
      return { line1: lines[0], line2: lines.slice(1).join(' ') };
    }
  }
  const match = raw.match(/^(Issuer Debit Transaction for toll fare\s*-\s*)(.+)$/i);
  if (match) {
    return {
      line1: 'Issuer Debit Transaction for toll fare -',
      line2: match[2].trim()
    };
  }
  if (raw.toLowerCase().startsWith('issuer debit')) {
    const idx = raw.indexOf('-');
    if (idx !== -1) {
      return {
        line1: raw.slice(0, idx + 1).trim(),
        line2: raw.slice(idx + 1).trim()
      };
    }
  }
  return {
    line1: 'Issuer Debit Transaction for toll fare -',
    line2: raw
  };
}

function drawLogoBox(doc: jsPDF, x: number, y: number, w: number, h: number) {
  // Rounded outer box
  doc.setDrawColor(218, 224, 233);
  doc.setLineWidth(0.3);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');

  // Axis Bank Logo Image (Official logo)
  try {
    doc.addImage(AXIS_BANK_LOGO_BASE64, 'PNG', x + 2.5, y + 2.2, 24, 7.6);
  } catch (e) {
    doc.setFillColor(151, 20, 77); // #97144D
    doc.triangle(x + 4, y + h - 3, x + 8, y + 3, x + 11.5, y + h - 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(151, 20, 77);
    doc.text('AXIS BANK', x + 13.5, y + h / 2 + 1.2);
  }

  // Center vertical divider
  const divX = x + 30;
  doc.setDrawColor(220, 226, 235);
  doc.setLineWidth(0.3);
  doc.line(divX, y + 1.8, divX, y + h - 1.8);

  // GpsTrackX Brand Logo (Matching BlackBuck size and position in official statement)
  try {
    doc.addImage(GPSTRACKX_LOGO_BASE64, 'PNG', divX + 3, y + 2.5, 26, 7.0);
  } catch (e) {
    doc.setFillColor(230, 0, 18);
    doc.circle(divX + 4.5, y + h / 2, 2.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(255, 255, 255);
    doc.text('G', divX + 3.4, y + h / 2 + 1);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(17, 24, 39);
    doc.text('GPSTRACK', divX + 8.5, y + h / 2 + 1.2);
    doc.setTextColor(230, 0, 18);
    doc.text('X', divX + 23.5, y + h / 2 + 1.2);
  }
}

const colW = [28, 18, 18, 22, 58, 36]; // Total width = 180mm

function drawTableHeaders(doc: jsPDF, marginX: number, y: number): number {
  const hH = 11; // 11mm height for 2-line headers matching RJ22GB7999.pdf
  doc.setFillColor(235, 241, 248); // Soft light blue #EBF1F8
  doc.rect(marginX, y, 180, hH, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.2);
  doc.rect(marginX, y, 180, hH, 'S');

  // Vertical column divider lines in header
  let curX = marginX;
  colW.forEach((w, idx) => {
    if (idx > 0) doc.line(curX, y, curX, y + hH);
    curX += w;
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(20, 25, 35);

  // Col 0: Transaction Time
  doc.text('Transaction', marginX + colW[0] / 2, y + 4.5, { align: 'center' });
  doc.text('Time', marginX + colW[0] / 2, y + 8.5, { align: 'center' });

  // Col 1: Nature (C/D)
  const c1X = marginX + colW[0] + colW[1] / 2;
  doc.text('Nature', c1X, y + 4.5, { align: 'center' });
  doc.text('(C/D)', c1X, y + 8.5, { align: 'center' });

  // Col 2: Amount
  const c2X = marginX + colW[0] + colW[1] + colW[2] / 2;
  doc.text('Amount', c2X, y + 6.8, { align: 'center' });

  // Col 3: Closing Balance
  const c3X = marginX + colW[0] + colW[1] + colW[2] + colW[3] / 2;
  doc.text('Closing', c3X, y + 4.5, { align: 'center' });
  doc.text('Balance', c3X, y + 8.5, { align: 'center' });

  // Col 4: Description
  const c4X = marginX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] / 2;
  doc.text('Description', c4X, y + 6.8, { align: 'center' });

  // Col 5: Transaction ID
  const c5X = marginX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5] / 2;
  doc.text('Transaction ID', c5X, y + 6.8, { align: 'center' });

  return y + hH;
}

/**
 * Generates the Official 100% Exact Replica FASTAG ACCOUNT SUMMARY Multi-Page PDF
 * Matches RJ22GB7999.pdf 100% exactly (typography, layout, dimensions, and pure integer Transaction IDs).
 */
export const generateFastagStatementPdf = (input: FastagTransaction | FastagStatementReportData): jsPDF => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Normalize input
  let data: FastagStatementReportData;
  if ('transactions' in input && Array.isArray(input.transactions)) {
    data = input;
  } else {
    const singleTx = input as FastagTransaction;
    data = {
      customerName: singleTx.customer_name || singleTx.driver_name || 'Ramniwas',
      customerMobile: formatMobileNumber(singleTx.customer_mobile || singleTx.driver_phone) || '8094249011',
      truckNumber: singleTx.vehicle_registration_no || 'RJ22GB7999',
      truckOwnerName: singleTx.truck_owner_name || 'Rajendra Kumar',
      transactions: [singleTx]
    };
  }

  const txs = [...data.transactions];
  // Sort chronologically ascending
  txs.sort((a, b) => {
    const sA = parseDateParts(a.crossing_time || a.created_at);
    const sB = parseDateParts(b.crossing_time || b.created_at);
    if (sA.sortKey !== sB.sortKey) return sA.sortKey.localeCompare(sB.sortKey);
    return sA.timeStr.localeCompare(sB.timeStr);
  });

  const totalDebit = txs.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  // Compute duration strings matching "DD Month YY – DD Month YY"
  let startDur = data.startDateStr ? formatDurationDate(data.startDateStr) : '';
  let endDur = data.endDateStr ? formatDurationDate(data.endDateStr) : '';
  if (!startDur && txs.length > 0) {
    startDur = formatDurationDate(txs[0].crossing_time || txs[0].created_at);
  }
  if (!endDur && txs.length > 0) {
    endDur = formatDurationDate(txs[txs.length - 1].crossing_time || txs[txs.length - 1].created_at);
  }
  const durationText = startDur && endDur ? `${startDur} – ${endDur}` : (startDur || endDur || '03 August 26 – 31 August 26');

  const marginX = 15;

  // --- PAGE 1 HEADER ---
  // Top Title: FASTAG ACCOUNT SUMMARY
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text('FASTAG ACCOUNT SUMMARY', marginX, 22);

  // Top Right Logo Box: AXIS BANK | GPSTRACKX (Exact size & position matching official PDF)
  const logoX = 132, logoY = 13.5, logoW = 63, logoH = 12.5;
  drawLogoBox(doc, logoX, logoY, logoW, logoH);

  // Customer Details Section
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  const customerName = data.customerName || txs[0]?.customer_name || txs[0]?.driver_name || 'Ramniwas';
  const rawMobile = data.customerMobile || txs[0]?.customer_mobile || txs[0]?.driver_phone || '8094249011';
  const customerMobile = formatMobileNumber(rawMobile) || '8094249011';
  const truckNumber = data.truckNumber || txs[0]?.vehicle_registration_no || 'RJ22GB7999';
  const truckOwnerName = data.truckOwnerName || txs[0]?.truck_owner_name || 'Rajendra Kumar';

  const colonX = marginX + 34;
  const valueX = colonX + 2.5;

  // Customer Name (Label regular, Value bold)
  doc.setFont('helvetica', 'normal');
  doc.text('Customer Name', marginX, 33);
  doc.text(':', colonX, 33);
  doc.setFont('helvetica', 'bold');
  doc.text(customerName, valueX, 33);

  // Customer Mobile (Label regular, Value bold, clean number without +91 or spaces)
  doc.setFont('helvetica', 'normal');
  doc.text('Customer Mobile', marginX, 39);
  doc.text(':', colonX, 39);
  doc.setFont('helvetica', 'bold');
  doc.text(customerMobile, valueX, 39);

  // Truck Number (Label regular, Value bold)
  doc.setFont('helvetica', 'normal');
  doc.text('Truck Number', marginX, 45);
  doc.text(':', colonX, 45);
  doc.setFont('helvetica', 'bold');
  doc.text(truckNumber, valueX, 45);

  // Truck Owner Name (Label regular, Value bold)
  doc.setFont('helvetica', 'normal');
  doc.text('Truck Owner Name', marginX, 51);
  doc.text(':', colonX, 51);
  doc.setFont('helvetica', 'bold');
  doc.text(truckOwnerName, valueX, 51);

  // Statement Duration (Label unbold, dates bold)
  doc.setFont('helvetica', 'normal');
  doc.text('Statement Duration :', marginX, 59.5);
  const durLabelW = doc.getTextWidth('Statement Duration : ');
  doc.setFont('helvetica', 'bold');
  doc.text(durationText, marginX + durLabelW, 59.5);

  // Summary Box: Credit 0 | Debit {totalDebit}
  const boxW = 180;
  const colHalf = 90;
  const sBoxY = 65;
  const sHeaderH = 7;
  const sTotalH = 14;

  doc.setFillColor(235, 241, 248); // Light soft blue #EBF1F8
  doc.rect(marginX, sBoxY, boxW, sHeaderH, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.rect(marginX, sBoxY, boxW, sTotalH, 'S');
  doc.line(marginX + colHalf, sBoxY, marginX + colHalf, sBoxY + sTotalH);
  doc.line(marginX, sBoxY + sHeaderH, marginX + boxW, sBoxY + sHeaderH);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(20, 25, 35);

  const iconW = 2.0;
  const iconH = 2.8;
  const gap = 1.0;

  // Left col: Credit (Recharge) in ₹
  const txt1 = 'Credit (Recharge) in';
  const w1 = doc.getTextWidth(txt1);
  const totalW1 = w1 + gap + iconW;
  const x1 = marginX + colHalf / 2 - totalW1 / 2;
  doc.text(txt1, x1, sBoxY + 4.8);
  try {
    doc.addImage(RUPEE_ICON_BASE64, 'PNG', x1 + w1 + gap, sBoxY + 4.8 - 2.4, iconW, iconH);
  } catch (e) {
    doc.text('Rs.', x1 + w1 + gap, sBoxY + 4.8);
  }

  // Right col: Debit (Swipe) in ₹
  const txt2 = 'Debit (Swipe) in';
  const w2 = doc.getTextWidth(txt2);
  const totalW2 = w2 + gap + iconW;
  const x2 = marginX + colHalf + colHalf / 2 - totalW2 / 2;
  doc.text(txt2, x2, sBoxY + 4.8);
  try {
    doc.addImage(RUPEE_ICON_BASE64, 'PNG', x2 + w2 + gap, sBoxY + 4.8 - 2.4, iconW, iconH);
  } catch (e) {
    doc.text('Rs.', x2 + w2 + gap, sBoxY + 4.8);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text('0', marginX + colHalf / 2, sBoxY + sHeaderH + 4.8, { align: 'center' });
  doc.text(totalDebit.toLocaleString('en-IN'), marginX + colHalf + colHalf / 2, sBoxY + sHeaderH + 4.8, { align: 'center' });

  // Table Starts on Page 1 (Exactly 12 rows on Page 1, 19 on subsequent pages)
  const rowH = 13.5;
  let curY = drawTableHeaders(doc, marginX, 84);
  let rowsOnCurrentPage = 0;
  const maxPage1Rows = 12;
  const maxOtherPageRows = 19;

  txs.forEach((tx) => {
    const isPage1 = doc.getNumberOfPages() === 1;
    const maxRows = isPage1 ? maxPage1Rows : maxOtherPageRows;

    if (rowsOnCurrentPage >= maxRows) {
      doc.addPage();
      // On subsequent pages, NO table header - matching RJ22GB7999.pdf
      curY = 20;
      rowsOnCurrentPage = 0;
    }

    // Row Outer Border & Vertical Dividers
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.rect(marginX, curY, 180, rowH, 'S');

    let colX = marginX;
    colW.forEach((w, cIdx) => {
      if (cIdx > 0) doc.line(colX, curY, colX, curY + rowH);
      colX += w;
    });

    const dt = formatTableDateTime(tx.crossing_time, tx.created_at);

    // Col 0: Transaction Time (Center aligned)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(20, 25, 35);
    doc.text(dt.dateLine, marginX + colW[0] / 2, curY + 5.2, { align: 'center' });
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(dt.timeLine, marginX + colW[0] / 2, curY + 9.5, { align: 'center' });

    // Col 1: Nature (C/D)
    doc.setFontSize(8);
    doc.setTextColor(20, 25, 35);
    doc.text('Debit', marginX + colW[0] + colW[1] / 2, curY + 7.5, { align: 'center' });

    // Col 2: Amount
    const amtStr = Number(tx.amount || 0).toLocaleString('en-IN');
    doc.text(amtStr, marginX + colW[0] + colW[1] + colW[2] / 2, curY + 7.5, { align: 'center' });

    // Col 3: Closing Balance
    let balStr = '-';
    if (tx.wallet_balance_after != null) {
      const balNum = Number(tx.wallet_balance_after);
      balStr = balNum.toLocaleString('en-IN');
    }
    doc.text(balStr, marginX + colW[0] + colW[1] + colW[2] + colW[3] / 2, curY + 7.5, { align: 'center' });

    // Col 4: Description (2 lines, both centered matching original statement)
    const descText = tx.description || tx.toll_plaza_name || 'Issuer Debit Transaction for toll fare';
    const parsedDesc = parseDescriptionLines(descText);
    doc.setFontSize(7.5);
    doc.setTextColor(20, 25, 35);
    const descCenterX = marginX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] / 2;
    doc.text(parsedDesc.line1, descCenterX, curY + 5.2, { align: 'center' });
    doc.text(parsedDesc.line2, descCenterX, curY + 9.5, { align: 'center' });

    // Col 5: Transaction ID (15 digits, pure integer, center aligned, NO DECIMAL POINT)
    const txnIdText = formatTransactionId(tx.transaction_id);
    doc.setFontSize(8);
    doc.setTextColor(20, 25, 35);
    doc.text(txnIdText, marginX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5] / 2, curY + 7.5, { align: 'center' });

    curY += rowH;
    rowsOnCurrentPage++;
  });

  return doc;
};
