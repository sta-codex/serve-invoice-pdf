import PDFDocument from "pdfkit";
import { formatCurrency, formatNumber, formatPrice } from "../domain/format.js";
import { formatDateEs } from "../domain/values.js";

const PAGE = {
  marginX: 50,
  width: 595.28,
  height: 841.89
};

const DETAIL_ROW_H = 12;
const GROUPED_ROW_H = 14;
const DESCRIPTION_BLOCK_H = 43;
const EDGE_CAPTION_Y = 20;
const LEGAL_LINE_Y = EDGE_CAPTION_Y;
const PAGE_NUMBER_Y = PAGE.height - EDGE_CAPTION_Y - 2;
const FIRST_HEADER_Y = LEGAL_LINE_Y + 40;
const FIRST_TABLE_Y = FIRST_HEADER_Y + 110;
const CONTINUATION_TABLE_Y = LEGAL_LINE_Y + 52;
const FIRST_PAGE_BODY_H = 600;
const FIRST_FINAL_BODY_H = 400;
const CONTINUATION_BODY_H = 694;
const CONTINUATION_FINAL_BODY_H = 498;
const CONTINUATION_BODY_BOTTOM_SAFETY_H = 8;
const LAST_BODY_BOTTOM_SAFETY_H = 4;
const FOOTER_VALUE_X = 245;
const FOOTER_VALUE_RIGHT = PAGE.marginX + 305 + 60 - 4;
const FOOTER_VALUE_W = FOOTER_VALUE_RIGHT - FOOTER_VALUE_X;

export async function renderInvoicePdf(invoice, { mode = "grouped" } = {}) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 44, bottom: 10, left: PAGE.marginX, right: PAGE.marginX },
    bufferPages: true,
    autoFirstPage: false
  });
  const done = collect(doc);

  const lines = mode === "detail" ? invoice.lines : invoice.groupedLines;
  const pages = paginateInvoiceLines(doc, lines, mode);
  const totalPages = pages.length;

  pages.forEach((page, index) => {
    const pageNumber = index + 1;
    const isFirstPage = pageNumber === 1;
    const isLastPage = page.hasFinalBlock;

    doc.addPage();
    if (isFirstPage) {
      drawHeader(doc, invoice);
    } else {
      drawContinuationHeader(doc, invoice);
    }
    drawInvoiceTable(doc, invoice, mode, page.rows, {
      isFirstPage,
      isLastPage
    });
    drawPageNumber(doc, pageNumber, totalPages);

    if (isLastPage) {
      drawFooter(doc, invoice, mode);
    }
  });

  doc.end();
  return done;
}

function drawHeader(doc, invoice) {
  const company = invoice.company;
  drawLegalLine(doc, company.legalLine);

  drawLogo(doc, PAGE.marginX + 8, FIRST_HEADER_Y);

  doc.fillColor("#111111");
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#8d0010");
  doc.text(company.name, 127, FIRST_HEADER_Y);
  doc.font("Helvetica").fontSize(10).fillColor("#111111");
  doc.text(company.address, 127, FIRST_HEADER_Y + 16);
  doc.text(company.city, 127, FIRST_HEADER_Y + 31);
  doc.text(company.phone, 127, FIRST_HEADER_Y + 46);
  doc.text(company.taxId, 127, FIRST_HEADER_Y + 61);

  const customerX = 335;
  const customer = invoice.customer || {};
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111111");
  doc.text(customer.fiscalName || customer.commercialName || "", customerX, FIRST_HEADER_Y + 15, {
    width: 210
  });
  doc.font("Helvetica").fontSize(10);
  doc.text(customer.address || "", customerX, FIRST_HEADER_Y + 31, { width: 210 });
  doc.text(
    [customer.postalCode, customer.city, customer.province, customer.country]
      .filter(Boolean)
      .join(" "),
    customerX,
    FIRST_HEADER_Y + 46,
    { width: 210 }
  );
  doc.text(customer.taxId || "", customerX, FIRST_HEADER_Y + 61, { width: 210 });

  doc.font("Helvetica-Bold").fontSize(8.5);
  doc.text(
    `Commercial Invoice Number: ${invoice.invoiceNumber}`,
    PAGE.marginX,
    FIRST_HEADER_Y + 92
  );
  doc.font("Helvetica").fontSize(8.5);
  doc.text(formatDateEs(invoice.date), 490, FIRST_HEADER_Y + 92, { width: 55, align: "right" });
}

function drawContinuationHeader(doc, invoice) {
  drawLegalLine(doc, invoice.company.legalLine);
  doc.fillColor("#111111");
}

function drawLegalLine(doc, legalLine) {
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#999999")
    .text(legalLine, PAGE.marginX, LEGAL_LINE_Y, {
      width: PAGE.width - PAGE.marginX * 2,
      align: "center"
    });
}

function drawLogo(doc, x, y) {
  const colors = ["#be747d", "#a2334c", "#792037", "#4b0719"];
  colors.forEach((color, index) => {
    doc.rect(x, y + index * 15, 58, 10).fill(color);
  });
}

function paginateInvoiceLines(doc, lines, mode) {
  const rows = lines.map((line) => ({
    line,
    height: measureLineHeight(doc, line, mode)
  }));
  const firstPageCapacity = rowAreaForBodyHeight(
    FIRST_PAGE_BODY_H,
    CONTINUATION_BODY_BOTTOM_SAFETY_H,
    true
  );
  const firstFinalCapacity = rowAreaForBodyHeight(
    FIRST_FINAL_BODY_H,
    LAST_BODY_BOTTOM_SAFETY_H,
    true
  );
  const continuationCapacity = rowAreaForBodyHeight(
    CONTINUATION_BODY_H,
    CONTINUATION_BODY_BOTTOM_SAFETY_H,
    false
  );
  const continuationFinalCapacity = rowAreaForBodyHeight(
    CONTINUATION_FINAL_BODY_H,
    LAST_BODY_BOTTOM_SAFETY_H,
    false
  );

  if (!rows.length) {
    return [{ rows: [], hasFinalBlock: true }];
  }

  if (totalRowHeight(rows) <= firstFinalCapacity) {
    return [{ rows, hasFinalBlock: true }];
  }

  const pages = [];
  const firstPageRows = takeRowsUpToHeight(rows, firstPageCapacity);
  pages.push({ rows: firstPageRows, hasFinalBlock: false });
  let index = firstPageRows.length;

  while (totalRowHeight(rows.slice(index)) > continuationFinalCapacity) {
    const pageRows = takeRowsUpToHeight(rows.slice(index), continuationCapacity);
    pages.push({ rows: pageRows, hasFinalBlock: false });
    index += pageRows.length;
  }

  pages.push({ rows: rows.slice(index), hasFinalBlock: true });

  return pages;
}

function rowAreaForBodyHeight(bodyH, bottomSafetyH, hasDescription) {
  return Math.max(
    1,
    bodyH - (hasDescription ? DESCRIPTION_BLOCK_H : 0) - bottomSafetyH
  );
}

function takeRowsUpToHeight(rows, pageCapacity) {
  const pageRows = [];
  let pageHeight = 0;

  for (const row of rows) {
    if (pageRows.length > 0 && pageHeight + row.height > pageCapacity) {
      break;
    }

    pageRows.push(row);
    pageHeight += row.height;
  }

  return pageRows;
}

function totalRowHeight(rows) {
  return rows.reduce((sum, row) => sum + row.height, 0);
}

function measureLineHeight(doc, line, mode) {
  const detail = mode === "detail";
  const descWidth = detail ? 295 : 253;
  const fontSize = detail ? 6.2 : 8;
  const minHeight = rowHeightForMode(mode);

  doc.font("Helvetica").fontSize(fontSize);
  const textHeight = doc.heightOfString(lineDescription(line, detail), {
    width: descWidth,
    lineGap: 0
  });

  return Math.max(minHeight, Math.ceil(textHeight) + 4);
}

function rowHeightForMode(mode) {
  return mode === "detail" ? DETAIL_ROW_H : GROUPED_ROW_H;
}

function drawInvoiceTable(
  doc,
  invoice,
  mode,
  lines,
  { isFirstPage, isLastPage }
) {
  const x = PAGE.marginX;
  const y = isFirstPage ? FIRST_TABLE_Y : CONTINUATION_TABLE_Y;
  const w = PAGE.width - PAGE.marginX * 2;
  const headerH = 14;
  const bodyH = tableBodyHeight({ isFirstPage, isLastPage });
  const totalsH = 70;
  const totalRowH = 32;
  const descW = 305;
  const qtyW = 60;
  const priceW = 55;
  const amountW = w - descW - qtyW - priceW;
  const tableH = headerH + bodyH + (isLastPage ? totalsH + totalRowH : 0);
  const qtyX = x + descW;
  const priceX = qtyX + qtyW;
  const amountX = priceX + priceW;

  doc.lineWidth(0.7).strokeColor("#000000").rect(x, y, w, tableH).stroke();
  [qtyX, priceX, amountX].forEach((lineX) => {
    doc.moveTo(lineX, y).lineTo(lineX, y + tableH).stroke();
  });
  doc.moveTo(x, y + headerH).lineTo(x + w, y + headerH).stroke();
  doc
    .moveTo(x, y + headerH + bodyH)
    .lineTo(x + w, y + headerH + bodyH)
    .stroke();
  if (isLastPage) {
    doc
      .moveTo(x, y + headerH + bodyH + totalsH)
      .lineTo(x + w, y + headerH + bodyH + totalsH)
      .stroke();
  }

  doc.font("Helvetica-Bold").fontSize(8);
  doc.text("Description", x, y + 3, { width: descW, align: "center" });
  doc.text("Quantity (MT)", qtyX, y + 3, { width: qtyW, align: "center" });
  doc.text("Price (\u20ac/MT)", priceX, y + 3, { width: priceW, align: "center" });
  doc.text("Amount (\u20ac)", amountX, y + 3, {
    width: amountW,
    align: "center"
  });

  let rowY = y + headerH + (isFirstPage ? 18 : 6);

  if (isFirstPage) {
    doc.font("Helvetica").fontSize(8);
    doc.text(invoice.description || "HOT ROLLED STEEL COILS", x + 10, rowY - 2, {
      width: descW - 20
    });
    rowY += 25;
  }

  for (const row of lines) {
    drawLine(doc, row.line, {
      x,
      rowY,
      rowH: row.height,
      descW,
      qtyX,
      qtyW,
      priceX,
      priceW,
      amountX,
      amountW,
      detail: mode === "detail"
    });
    rowY += row.height;
  }

  if (!isLastPage) {
    return;
  }

  const totalsY = y + headerH + bodyH;
  doc.font("Helvetica").fontSize(8);
  doc.text(`VAT ${formatNumber(invoice.vatRate, 2)}%`, x, totalsY + 48, {
    width: descW,
    align: "center"
  });
  doc.text(formatCurrency(invoice.vatAmount), amountX + 3, totalsY + 48, {
    width: amountW - 6,
    align: "right"
  });

  const finalY = y + headerH + bodyH + totalsH;
  doc.font("Helvetica-Bold").fontSize(8.5);
  doc.text("TOTAL", x, finalY + 12, { width: descW, align: "center" });
  doc.text(formatNumber(invoice.totalQuantity, 3), qtyX, finalY + 12, {
    width: qtyW - 4,
    align: "right"
  });
  doc.text(formatCurrency(invoice.total), amountX + 3, finalY + 12, {
    width: amountW - 6,
    align: "right"
  });
}

function tableBodyHeight({ isFirstPage, isLastPage }) {
  if (isFirstPage && isLastPage) return FIRST_FINAL_BODY_H;
  if (isFirstPage) return FIRST_PAGE_BODY_H;
  if (isLastPage) return CONTINUATION_FINAL_BODY_H;
  return CONTINUATION_BODY_H;
}

function drawLine(doc, line, box) {
  const desc = lineDescription(line, box.detail);
  const left = box.detail ? box.x + 4 : box.x + 32;
  const descWidth = box.detail ? box.descW - 10 : box.descW - 52;

  doc.font("Helvetica").fontSize(box.detail ? 6.2 : 8).fillColor("#111111");
  doc.text(desc, left, box.rowY, {
    width: descWidth,
    align: "left",
    lineGap: 0
  });
  doc.font("Helvetica").fontSize(7.5);
  doc.text(formatNumber(line.quantity, 3), box.qtyX, box.rowY, {
    width: box.qtyW - 4,
    align: "right"
  });
  doc.text(formatPrice(line.price), box.priceX, box.rowY, {
    width: box.priceW - 4,
    align: "right"
  });
  doc.text(formatCurrency(line.amount), box.amountX, box.rowY, {
    width: box.amountW - 6,
    align: "right"
  });
}

function lineDescription(line, detail) {
  return String(
    detail ? line.detailDescription || line.description || "" : line.description || ""
  );
}

function drawFooter(doc, invoice, mode) {
  const x = PAGE.marginX + 2;
  let y = 704;
  doc.font("Helvetica").fontSize(7.5).fillColor("#111111");

  if (mode === "grouped") {
    drawFooterRow(doc, "Packing List:", truncate(invoice.packingList, 62), x, y);
    y += 10;
  }
  drawFooterRow(doc, "Internal order number:", invoice.saleRef, x, y);
  y += 10;
  drawFooterRow(doc, "Customer order number:", "", x, y, true);
  y += 10;
  drawFooterRow(doc, "Delivery terms:", invoice.deliveryTerms, x, y);
  y += 10;
  doc.font("Helvetica-Bold").text("Payment terms:", x, y);
  y += 10;

  const payment = invoice.paymentTerms || "Transferencia a la vista fecha factura";
  doc.font("Helvetica").text(`- ${payment}`, x + 18, y);
  y += 10;
  drawFooterRow(doc, "- Down payment:", formatCurrency(0), x + 18, y);
  y += 10;
  doc.font("Helvetica-Bold").text("- Balance to be paid:", x + 18, y);
  drawFooterValue(doc, formatCurrency(invoice.total), y, true);
  y += 10;
  drawFooterRow(doc, "- Due date:", formatDateEs(invoice.dueDate || invoice.date), x + 18, y);
  y += 10;
  doc.font("Helvetica-Bold").text(`- ${invoice.company.bank}`, x + 18, y);
}

function drawFooterRow(doc, label, value, x, y, boldLabel = false) {
  doc.font(boldLabel ? "Helvetica-Bold" : "Helvetica").text(label, x, y);
  drawFooterValue(doc, value || "-", y);
}

function drawFooterValue(doc, value, y, bold = false) {
  doc
    .font(bold ? "Helvetica-Bold" : "Helvetica")
    .text(value || "-", FOOTER_VALUE_X, y, {
      width: FOOTER_VALUE_W,
      align: "right"
    });
}

function drawPageNumber(doc, pageNumber, totalPages) {
  if (totalPages <= 1) {
    return;
  }

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor("#666666")
    .text(`Page ${pageNumber} of ${totalPages}`, PAGE.marginX, PAGE_NUMBER_Y, {
      width: PAGE.width - PAGE.marginX * 2,
      align: "center",
      lineBreak: false
    })
    .fillColor("#111111");
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function collect(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}
