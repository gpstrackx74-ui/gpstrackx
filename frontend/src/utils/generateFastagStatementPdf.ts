import { jsPDF } from 'jspdf';
import { FastagTransaction } from '../types';

export interface FastagStatementReportData {
  customerName?: string;
  customerMobile?: string;
  truckNumber: string;
  truckOwnerName?: string;
  startDateStr?: string;
  endDateStr?: string;
  transactions: FastagTransaction[];
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

function drawLogoBox(doc: jsPDF, x: number, y: number, w: number, h: number) {
  // Rounded outer box
  doc.setDrawColor(220, 226, 235);
  doc.setLineWidth(0.3);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');

  // Axis Bank Burgundy Triangle Emblem
  doc.setFillColor(151, 20, 77); // #97144D
  doc.triangle(x + 4, y + h - 3, x + 8, y + 3, x + 11.5, y + h - 3, 'F');
  // Inner white chevron cutout
  doc.setFillColor(255, 255, 255);
  doc.triangle(x + 5.5, y + h - 3.5, x + 8, y + 5.5, x + 10, y + h - 3.5, 'F');

  // AXIS BANK text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(151, 20, 77);
  doc.text('AXIS BANK', x + 13.5, y + h / 2 + 1.2);

  // Center vertical divider
  const divX = x + 34;
  doc.setDrawColor(220, 226, 235);
  doc.setLineWidth(0.3);
  doc.line(divX, y + 2, divX, y + h - 2);

  // BlackBuck Horns (Orange/Red)
  doc.setFillColor(232, 65, 37); // #E84125
  doc.triangle(divX + 3.5, y + h - 3.5, divX + 5.5, y + 3.5, divX + 7.5, y + h - 3.5, 'F');
  doc.triangle(divX + 6.5, y + h - 3.5, divX + 8.5, y + 3.5, divX + 10.5, y + h - 3.5, 'F');

  // BLACKBUCK text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(17, 24, 39);
  doc.text('BLACKBUCK', divX + 12.5, y + h / 2 + 1.2);
}

const colW = [28, 18, 18, 22, 58, 36]; // Total width = 180mm

function drawTableHeaders(doc: jsPDF, marginX: number, y: number): number {
  const hH = 8;
  doc.setFillColor(232, 239, 247); // Light soft blue #E8EFF7
  doc.rect(marginX, y, 180, hH, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.2);
  doc.rect(marginX, y, 180, hH, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(20, 25, 35);

  let curX = marginX;
  const headers = ['Transaction Time', 'Nature (C/D)', 'Amount', 'Closing Balance', 'Description', 'Transaction ID'];
  headers.forEach((h, idx) => {
    if (idx > 0) doc.line(curX, y, curX, y + hH);
    if (idx === 1 || idx === 2 || idx === 3 || idx === 5) {
      doc.text(h, curX + colW[idx] / 2, y + 5.5, { align: 'center' });
    } else {
      doc.text(h, curX + 2, y + 5.5);
    }
    curX += colW[idx];
  });
  return y + hH;
}

/**
 * Generates the Official 100% Replica FASTAG ACCOUNT SUMMARY (AXIS BANK | BLACKBUCK) Multi-Page PDF
 * Exactly matching the attached statement PDF.
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
      customerMobile: singleTx.customer_mobile || singleTx.driver_phone || '8094249011',
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

  // Compute duration strings
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

  // Top Right Logo Box: AXIS BANK | BLACKBUCK
  const logoX = 135, logoY = 14, logoW = 60, logoH = 12;
  drawLogoBox(doc, logoX, logoY, logoW, logoH);

  // Customer Details Section
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  const customerName = data.customerName || txs[0]?.customer_name || txs[0]?.driver_name || 'Ramniwas';
  const customerMobile = data.customerMobile || txs[0]?.customer_mobile || txs[0]?.driver_phone || '8094249011';
  const truckNumber = data.truckNumber || txs[0]?.vehicle_registration_no || 'RJ22GB7999';
  const truckOwnerName = data.truckOwnerName || txs[0]?.truck_owner_name || 'Rajendra Kumar';

  doc.text(`Customer Name     : ${customerName}`, marginX, 33);
  doc.text(`Customer Mobile   : ${customerMobile}`, marginX, 39);
  doc.text(`Truck Number      : ${truckNumber}`, marginX, 45);
  doc.text(`Truck Owner Name  : ${truckOwnerName}`, marginX, 51);

  doc.setFont('helvetica', 'bold');
  doc.text(`Statement Duration : ${durationText}`, marginX, 60);

  // Summary Box: Credit 0 | Debit {totalDebit}
  const boxW = 180;
  const colHalf = 90;
  const sBoxY = 66;
  const sHeaderH = 7;
  const sTotalH = 14;

  doc.setFillColor(232, 239, 247); // Light blue
  doc.rect(marginX, sBoxY, boxW, sHeaderH, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.rect(marginX, sBoxY, boxW, sTotalH, 'S');
  doc.line(marginX + colHalf, sBoxY, marginX + colHalf, sBoxY + sTotalH);
  doc.line(marginX, sBoxY + sHeaderH, marginX + boxW, sBoxY + sHeaderH);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(20, 25, 35);
  doc.text('Credit (Recharge) in ₹', marginX + colHalf / 2, sBoxY + 5, { align: 'center' });
  doc.text('Debit (Swipe) in ₹', marginX + colHalf + colHalf / 2, sBoxY + 5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('0', marginX + colHalf / 2, sBoxY + sHeaderH + 5, { align: 'center' });
  doc.text(totalDebit.toLocaleString('en-IN'), marginX + colHalf + colHalf / 2, sBoxY + sHeaderH + 5, { align: 'center' });

  // Table Starts on Page 1
  let curY = drawTableHeaders(doc, marginX, 85);

  // Render Rows
  txs.forEach((tx) => {
    const rowH = 12.5;
    // Check if new page is needed
    if (curY + rowH > 280) {
      doc.addPage();
      curY = drawTableHeaders(doc, marginX, 15);
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

    // Col 0: Transaction Time (Date on top, Time below)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(20, 25, 35);
    doc.text(dt.dateLine, marginX + 3, curY + 5);
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(dt.timeLine, marginX + 3, curY + 9.5);

    // Col 1: Nature (C/D)
    doc.setFontSize(7.5);
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

    // Col 4: Description
    const descText = tx.description || tx.toll_plaza_name || 'FASTag Toll Deduction';
    const descLines = doc.splitTextToSize(descText, 54);
    doc.text(descLines, marginX + colW[0] + colW[1] + colW[2] + colW[3] + 2, curY + 5);

    // Col 5: Transaction ID
    const txnIdText = String(tx.transaction_id || '');
    doc.text(txnIdText, marginX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5] / 2, curY + 7.5, { align: 'center' });

    curY += rowH;
  });

  return doc;
};
