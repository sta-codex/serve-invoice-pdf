import PDFDocument from "pdfkit";
import { formatNumber } from "../domain/format.js";
import { formatDateEs } from "../domain/values.js";

const PAGE = { width: 595.28, height: 841.89, margin: 50 };
export const OWN_DELIVERY_NOTE_LABEL = "DELIVERY NOTE:";
export const COIL_NUMBER_LABEL = "Coil number";
export const PLATE_NUMBER_LABEL = "Plate number";
export const MIXED_IDENTIFIER_LABEL = "Coil / Plate number";
export const TOTAL_LABEL = "TOTAL";
export const CARRIER_DETAILS_LABEL = "CARRIER DETAILS";
export const LICENSE_PLATE_LABEL = "License plate:";

export function formatOwnDeliveryNoteDate(value) {
  return formatDateEs(value);
}

export function ownDeliveryNoteTaxId(value) {
  return String(value || "").replace(/^\s*CIF\s*:\s*/i, "").trim();
}

export async function renderOwnDeliveryNotePdf(note) {
  const doc = new PDFDocument({ size: "A4", margins: { top: 44, bottom: 36, left: PAGE.margin, right: PAGE.margin }, bufferPages: true });
  const done = collect(doc);
  drawHeader(doc, note);
  let y = 202;
  y = drawMaterialHeadings(doc, note.materialHeadings, y);
  y = drawTable(doc, note.lines, y, note.identifierLabel);
  y += 24;
  doc.font("Helvetica-Bold").fontSize(9).text(CARRIER_DETAILS_LABEL, PAGE.margin, y);
  y += 16;
  doc.font("Helvetica").fontSize(9).text(`${LICENSE_PLATE_LABEL} ${note.plate || "-"}`, PAGE.margin, y);
  doc.end();
  return done;
}

function drawMaterialHeadings(doc, headings, y) {
  const values = Array.isArray(headings) ? headings.filter(Boolean) : [];
  if (!values.length) return y;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#111111");
  for (const heading of values) {
    const height = doc.heightOfString(heading, { width: PAGE.width - PAGE.margin * 2 });
    doc.text(heading, PAGE.margin, y, { width: PAGE.width - PAGE.margin * 2 });
    y += height + 5;
  }
  return y + 8;
}

function drawHeader(doc, note) {
  doc.font("Helvetica").fontSize(8).fillColor("#999999").text(note.company.legalLine, PAGE.margin, 20, { width: PAGE.width - PAGE.margin * 2, align: "center" });
  ["#be747d", "#a2334c", "#792037", "#4b0719"].forEach((color, i) => doc.rect(PAGE.margin + 8, 60 + i * 15, 58, 10).fill(color));
  doc.fillColor("#8d0010").font("Helvetica-Bold").fontSize(11).text(note.company.name, 127, 60);
  doc.fillColor("#111111").font("Helvetica").fontSize(10);
  doc.text(note.company.address, 127, 76); doc.text(note.company.city, 127, 91); doc.text(note.company.phone, 127, 106); doc.text(ownDeliveryNoteTaxId(note.company.taxId), 127, 121);
  const c = note.customer;
  doc.font("Helvetica-Bold").text(c.fiscalName || c.commercialName || "", 335, 76, { width: 210 });
  doc.font("Helvetica").text(c.address || "", 335, 91, { width: 210 });
  doc.text([c.postalCode, c.city, c.province, c.country].filter(Boolean).join(" "), 335, 106, { width: 210 }); doc.text(ownDeliveryNoteTaxId(c.taxId), 335, 121, { width: 210 });
  doc.font("Helvetica-Bold").fontSize(12).text(`${OWN_DELIVERY_NOTE_LABEL} ${note.id}`, PAGE.margin, 168);
  doc.font("Helvetica").fontSize(9).text(formatOwnDeliveryNoteDate(note.date), 470, 170, { width: 75, align: "right" });
}

function drawTable(doc, lines, y, identifierLabel) {
  const columns = tableColumns();
  y = drawTableHeader(doc, columns, y, identifierLabel);
  for (const line of lines) {
    doc.font("Helvetica").fontSize(8);
    const h = Math.max(18, Math.ceil(doc.heightOfString(line.description || "", { width: columns.descW - 8 })) + 8);
    if (y + h > PAGE.height - 130) {
      doc.addPage();
      y = drawTableHeader(doc, columns, 55, identifierLabel);
    }
    drawTableRow(doc, columns, y, h, line);
    y += h;
  }

  const totalH = 22;
  if (y + totalH > PAGE.height - 110) {
    doc.addPage();
    y = drawTableHeader(doc, columns, 55, identifierLabel);
  }
  drawTotalRow(doc, columns, y, totalH, totalWeight(lines));
  return y + totalH;
}

function tableColumns() {
  const x = PAGE.margin;
  const width = PAGE.width - PAGE.margin * 2;
  const descW = 300;
  const factoryW = 110;
  return { x, width, descW, factoryW, weightW: width - descW - factoryW, head: 18 };
}

function drawTableHeader(doc, columns, y, identifierLabel) {
  const { x, width, descW, factoryW, weightW, head } = columns;
  drawTableGrid(doc, columns, y, head);
  doc.font("Helvetica-Bold").fontSize(8);
  doc.text("Description", x + 3, y + 5, { width: descW - 6, align: "center" });
  doc.text(identifierLabel || MIXED_IDENTIFIER_LABEL, x + descW + 3, y + 5, { width: factoryW - 6, align: "center" });
  doc.text("Weight (MT)", x + descW + factoryW + 3, y + 5, { width: weightW - 6, align: "center" });
  return y + head;
}

function drawTableRow(doc, columns, y, height, line) {
  const { x, descW, factoryW, weightW } = columns;
  drawTableGrid(doc, columns, y, height);
  doc.font("Helvetica").fontSize(8);
  doc.text(line.description || "", x + 4, y + 4, { width: descW - 8 });
  doc.text(line.factoryId || "-", x + descW + 4, y + 4, { width: factoryW - 8, align: "center" });
  doc.text(formatNumber(line.weight, 3), x + descW + factoryW + 4, y + 4, { width: weightW - 8, align: "right" });
}

function drawTotalRow(doc, columns, y, height, weight) {
  const { x, descW, factoryW, weightW } = columns;
  drawTableGrid(doc, columns, y, height);
  doc.font("Helvetica-Bold").fontSize(8.5);
  doc.text(TOTAL_LABEL, x + 4, y + 7, { width: descW - 8, align: "center" });
  doc.text(formatNumber(weight, 3), x + descW + factoryW + 4, y + 7, { width: weightW - 8, align: "right" });
}

function drawTableGrid(doc, columns, y, height) {
  const { x, width, descW, factoryW } = columns;
  doc.lineWidth(0.7).rect(x, y, width, height).stroke();
  doc.moveTo(x + descW, y).lineTo(x + descW, y + height).stroke();
  doc.moveTo(x + descW + factoryW, y).lineTo(x + descW + factoryW, y + height).stroke();
}

export function totalWeight(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((sum, line) => sum + (Number(line?.weight) || 0), 0);
}

function collect(doc) { return new Promise((resolve,reject)=>{ const chunks=[];doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject); }); }
