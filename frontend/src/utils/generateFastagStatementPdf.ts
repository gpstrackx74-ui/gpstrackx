import { jsPDF } from 'jspdf';
import { AUTHORIZED_SIGNATURE_BASE64 } from '../assets/signatureBase64';
import { ICICI_LOGO_BASE64 } from '../assets/iciciLogoBase64';
import { FastagTransaction } from '../types';

export const generateFastagStatementPdf = (tx: FastagTransaction): jsPDF => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const plate = tx.vehicle_registration_no || 'KL10AL5697';
  const tagAcc = tx.tag_id?.slice(-8) || '27358917';
  const refNo = `100222/${tx.id ? String(184100 + tx.id) : '184102'}/84`;
  const customerId = tx.id ? String(16469000 + tx.id) : '16469495';
  const amount = Number(tx.amount) || 80.0;
  const openingBal = tx.wallet_balance_before || (amount + 305.0);
  const closingBal = openingBal - amount;

  let datePart = '24-01-2022';
  let timePart = '07:00:09';
  if (tx.crossing_time) {
    const parts = tx.crossing_time.split(' ');
    if (parts[0]) {
      const dp = parts[0].split('-');
      if (dp.length === 3) datePart = `${dp[2]}-${dp[1]}-${dp[0]}`;
    }
    if (parts[1]) timePart = parts[1];
  }

  const laneNum = tx.lane_direction?.replace(/[^0-9]/g, '').slice(0, 2) || '03';
  const plazaStr = tx.toll_plaza_name || 'Paliyekkara Toll plaza';
  const txnIdStr = tx.transaction_id && tx.transaction_id.length > 8
    ? tx.transaction_id
    : '0010012201240701279180 / 1390415023';

  // --- HELPER FUNCTIONS ---
  const renderHeader = () => {
    // Orange slanted polygon
    doc.setFillColor(245, 130, 32); // #F58220
    doc.triangle(14, 18, 18, 12, 14, 12, 'F');
    doc.triangle(14, 18, 18, 18, 18, 12, 'F');

    // Title: FASTag E-Statement
    doc.setTextColor(128, 27, 28); // #801B1C
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('FASTag E-Statement', 21, 16.5);

    // ICICI Bank Logo at top right
    try {
      if (ICICI_LOGO_BASE64) {
        doc.addImage(ICICI_LOGO_BASE64, 'JPEG', 142, 10, 54, 11);
      }
    } catch (_) {}

    // Top divider
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(14, 23, 196, 23);
  };

  // ==========================================
  // PAGE 1
  // ==========================================
  renderHeader();

  // Table 1: Bank Details & Customer Details
  // Header bar #A6A6A6
  doc.setFillColor(166, 166, 166);
  doc.rect(14, 25, 182, 5.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Bank Details', 16, 28.8);
  doc.text('Customer Details', 92, 28.8);

  // Border box
  doc.setDrawColor(200, 200, 200);
  doc.rect(14, 30.5, 182, 42);
  doc.line(88, 30.5, 88, 72.5); // Vertical separator

  // Bank details content
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(50, 50, 50);

  doc.text('Statement Reference Number:', 16, 34.5);
  doc.setFont('helvetica', 'normal');
  doc.text(refNo, 16, 37.5);

  doc.setFont('helvetica', 'bold');
  doc.text('Name of ICICI Bank Branch making the supply:', 16, 42);
  doc.setFont('helvetica', 'normal');
  doc.text('ICICI Bank Limited BKC', 16, 45);

  doc.setFont('helvetica', 'bold');
  doc.text('Bill From Address of ICICI:', 16, 49.5);
  doc.setFont('helvetica', 'normal');
  doc.text('ICICI Bank Towers, Bandra Kurla Complex, Mumbai 400051', 16, 52.5);

  doc.setFont('helvetica', 'bold');
  doc.text('GSTIN of ICICI:', 16, 57);
  doc.setFont('helvetica', 'normal');
  doc.text('27AAACI1195H5ZR', 16, 60);

  doc.setDrawColor(230, 230, 230);
  doc.line(16, 63, 86, 63);

  doc.setFont('helvetica', 'bold');
  doc.text('Place of Supply:', 16, 67);
  doc.setFont('helvetica', 'normal');
  doc.text('Kerala', 16, 70);

  doc.setFont('helvetica', 'bold');
  doc.text('State Code:', 55, 67);
  doc.setFont('helvetica', 'normal');
  doc.text('32', 55, 70);

  // Customer details content
  doc.line(146, 30.5, 146, 72.5); // Inner vertical line for address

  doc.setFont('helvetica', 'bold');
  doc.text('Customer ID:', 90, 35);
  doc.setFont('helvetica', 'normal');
  doc.text(customerId, 114, 35);

  doc.setFont('helvetica', 'bold');
  doc.text('Name:', 90, 40);
  doc.setFont('helvetica', 'bold');
  doc.text('MUHAMMED KUTTY P', 114, 40);

  doc.setFont('helvetica', 'bold');
  doc.text('Statement Period:', 90, 45);
  doc.setFont('helvetica', 'normal');
  doc.text('10-01-2022 to 07-02-2022', 114, 45);

  doc.setFont('helvetica', 'bold');
  doc.text('Statement Date:', 90, 50);
  doc.setFont('helvetica', 'normal');
  doc.text('10-02-2022', 114, 50);

  doc.setFont('helvetica', 'bold');
  doc.text('Type of address:', 90, 55);
  doc.setFont('helvetica', 'normal');
  doc.text('Permanent', 114, 55);

  doc.setFont('helvetica', 'bold');
  doc.text('GSTIN Number:', 90, 60);
  doc.setFont('helvetica', 'normal');
  doc.text('N/A', 114, 60);

  // Customer Address
  doc.setFont('helvetica', 'bold');
  doc.text('Address:', 148, 35);
  doc.setFont('helvetica', 'normal');
  doc.text('MUHAMMED KUTTY P', 148, 39);
  doc.text('KAIPPARAMBA', 148, 43);
  doc.text('EKKAPARAMBA,KUZHIMANNA PO,', 148, 47);
  doc.text('KUZHIMANNA,', 148, 51);
  doc.text('MALAPPURAM - 673641,', 148, 55);
  doc.text('Kerala, INDIA', 148, 59);

  // Table 2: Vehicle Summary (Solid Orange Header #F58220)
  const t2Y = 76;
  doc.setFillColor(245, 130, 32);
  doc.rect(14, t2Y, 182, 5.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Vehicle Summary', 16, t2Y + 4);

  // Table 2 Columns header
  const t2HeadY = t2Y + 5.5;
  doc.setFillColor(230, 230, 230);
  doc.rect(14, t2HeadY, 182, 5.5, 'F');
  doc.setTextColor(40, 40, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);

  const t2Cols = [
    { label: 'Tag Account No.', x: 16, w: 26 },
    { label: 'Licence Plate No.', x: 42, w: 26 },
    { label: 'Group', x: 68, w: 18 },
    { label: 'Trip Count', x: 86, w: 16, align: 'center' },
    { label: 'Opening Balance (Rs.)', x: 122, w: 24, align: 'right' },
    { label: 'Credit (Rs.)', x: 144, w: 20, align: 'right' },
    { label: 'Debit (Rs.)', x: 166, w: 22, align: 'right' },
    { label: 'Closing Balance (Rs.)', x: 194, w: 26, align: 'right' }
  ];

  doc.text('Tag Account No.', 16, t2HeadY + 3.8);
  doc.text('Licence Plate No.', 42, t2HeadY + 3.8);
  doc.text('Group', 70, t2HeadY + 3.8);
  doc.text('Trip Count', 87, t2HeadY + 3.8);
  doc.text('Opening Balance (Rs.)', 105, t2HeadY + 3.8);
  doc.text('Credit (Rs.)', 137, t2HeadY + 3.8);
  doc.text('Debit (Rs.)', 158, t2HeadY + 3.8);
  doc.text('Closing Balance (Rs.)', 172, t2HeadY + 3.8);

  // Table 2 Data Row
  const t2RowY = t2HeadY + 5.5;
  doc.rect(14, t2RowY, 182, 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text(tagAcc, 16, t2RowY + 4);
  doc.setFont('helvetica', 'bold');
  doc.text(plate, 42, t2RowY + 4);
  doc.setFont('helvetica', 'normal');
  doc.text('Default', 70, t2RowY + 4);
  doc.text('1', 92, t2RowY + 4);
  doc.text(openingBal.toFixed(2), 115, t2RowY + 4);
  doc.text('0.00', 141, t2RowY + 4);
  doc.text(`- ${amount.toFixed(2)}`, 159, t2RowY + 4);
  doc.setFont('helvetica', 'bold');
  doc.text(closingBal.toFixed(2), 180, t2RowY + 4);

  // Table 2 Total Row
  const t2TotY = t2RowY + 6;
  doc.setFillColor(248, 250, 252);
  doc.rect(14, t2TotY, 182, 5.5, 'F');
  doc.rect(14, t2TotY, 182, 5.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Total', 70, t2TotY + 3.8);
  doc.text('1', 92, t2TotY + 3.8);
  doc.text(openingBal.toFixed(2), 115, t2TotY + 3.8);
  doc.text('0.00', 141, t2TotY + 3.8);
  doc.text(`- ${amount.toFixed(2)}`, 159, t2TotY + 3.8);
  doc.text(closingBal.toFixed(2), 180, t2TotY + 3.8);

  // Table 3: Transaction Details (Solid Maroon Header #9B1B1E)
  const t3Y = t2TotY + 9;
  doc.setFillColor(155, 27, 30);
  doc.rect(14, t3Y, 182, 5.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Transaction Details', 16, t3Y + 4);

  // Sub-bar #F58220
  const t3SubY = t3Y + 5.5;
  doc.setFillColor(245, 130, 32);
  doc.rect(14, t3SubY, 182, 4.5, 'F');
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(`${plate} - ${tagAcc}`, 16, t3SubY + 3.2);

  // Transaction Table Header #E6E6E6
  const t3HeadY = t3SubY + 4.5;
  doc.setFillColor(230, 230, 230);
  doc.rect(14, t3HeadY, 182, 5.5, 'F');
  doc.setTextColor(40, 40, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);

  doc.text('Date & Time', 16, t3HeadY + 3.8);
  doc.text('Activity', 45, t3HeadY + 3.8);
  doc.text('Unique Transaction ID', 82, t3HeadY + 3.8);
  doc.text('Transaction Description', 120, t3HeadY + 3.8);
  doc.text('Amount (Rs.) [CR]', 160, t3HeadY + 3.8);
  doc.text('Amount (Rs.) [DR]', 178, t3HeadY + 3.8);

  // Transaction Table Row
  const t3RowY = t3HeadY + 5.5;
  doc.rect(14, t3RowY, 182, 7.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.text(`${datePart} ${timePart}`, 16, t3RowY + 4.5);
  doc.text('Trip (RRN No: / Trip No)', 45, t3RowY + 4.5);
  doc.text(txnIdStr.slice(0, 30), 82, t3RowY + 4.5);
  doc.text(`Plaza ${plazaStr.slice(0, 22)} - Lane:${laneNum}`, 120, t3RowY + 4.5);
  doc.text('0.00', 168, t3RowY + 4.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(180, 20, 20);
  doc.text(amount.toFixed(2), 184, t3RowY + 4.5);

  // Table 4: CUG Payment Details
  const t4Y = t3RowY + 11;
  doc.setFillColor(245, 130, 32);
  doc.rect(14, t4Y, 182, 4.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('CUG Payment Details', 16, t4Y + 3.2);
  doc.rect(14, t4Y + 4.5, 182, 6);
  doc.setTextColor(200, 120, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('No transaction details to display', 85, t4Y + 8.8);

  // Table 5: GSTIN Details
  const t5Y = t4Y + 13.5;
  doc.setFillColor(155, 27, 30);
  doc.rect(14, t5Y, 182, 4.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('GSTIN Details', 16, t5Y + 3.2);
  doc.rect(14, t5Y + 4.5, 182, 6);
  doc.setTextColor(200, 40, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('No transaction details to display', 85, t5Y + 8.8);

  // Table 6: Load by UPI
  const t6Y = t5Y + 13.5;
  doc.setFillColor(245, 130, 32);
  doc.rect(14, t6Y, 182, 4.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('Load by UPI', 16, t6Y + 3.2);
  doc.rect(14, t6Y + 4.5, 182, 6);
  doc.setTextColor(200, 120, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('No transaction details to display', 85, t6Y + 8.8);

  // Page 1 Footer
  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('1 of 2', 188, 285);

  // ==========================================
  // PAGE 2
  // ==========================================
  doc.addPage();
  renderHeader();

  // Important Messages Heading
  const p2Y = 28;
  doc.setTextColor(155, 27, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Important Messages', 14, p2Y);

  // Red underline #DC2626
  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(0.6);
  doc.line(14, p2Y + 2.5, 196, p2Y + 2.5);

  // Disclaimer text
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(40, 40, 40);
  doc.text(
    'The Agency does not guarantee the accuracy of this information. For up-to-date account information, please contact our Customer Care at 18002670104.',
    14,
    p2Y + 9
  );

  doc.setTextColor(220, 38, 38);
  doc.setFont('helvetica', 'bold');
  doc.text(
    '* Date and Time for Activity type: Trip is the Trip Date & Time, not the Transaction Posting Date & Time',
    14,
    p2Y + 16
  );

  doc.setTextColor(50, 50, 50);
  doc.setFont('helvetica', 'normal');
  doc.text(
    '• With effect from 01/07/2017, Goods and Services Tax will be applicable on the services which include IGST @ 18%, CGST @ 9% and SGST @ 9%.',
    14,
    p2Y + 23
  );
  doc.text(
    '• Our registered office address : ICICI Bank Limited, "Landmark", Race Course Circle, Vadodara - 390 007, Gujarat, India.',
    14,
    p2Y + 30
  );

  // Declaration & Signatory Box
  const declY = p2Y + 50;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.3);
  doc.line(14, declY, 196, declY);

  doc.setTextColor(40, 40, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Declaration', 14, declY + 8);

  const signBoxX = 135;
  doc.text('For ICICI Bank Limited', signBoxX, declY + 8);

  // Authorized signature image
  try {
    if (AUTHORIZED_SIGNATURE_BASE64) {
      doc.addImage(AUTHORIZED_SIGNATURE_BASE64, 'PNG', signBoxX - 2, declY + 11, 46, 17);
    }
  } catch (_) {}

  doc.setFontSize(8);
  doc.text('Authorized Signatory', signBoxX + 4, declY + 32);

  // Page 2 Footer
  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('2 of 2', 188, 285);

  return doc;
};
