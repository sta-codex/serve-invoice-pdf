import PDFDocument from "pdfkit";
import { formatNumber } from "../domain/format.js";
import { formatDateEs } from "../domain/values.js";

const PAGE = { width: 595.28, height: 841.89, margin: 50 };
export const OWN_DELIVERY_NOTE_LABEL = "DELIVERY NOTE:";
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
  let y = 170;
  y = drawTable(doc, note.lines, y);
  y += 24;
  doc.font("Helvetica-Bold").fontSize(9).text(CARRIER_DETAILS_LABEL, PAGE.margin, y);
  y += 16;
  doc.font("Helvetica").fontSize(9).text(`${LICENSE_PLATE_LABEL} ${note.plate || "-"}`, PAGE.margin, y);
  doc.end();
  return done;
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
  doc.font("Helvetica-Bold").fontSize(9).text(`${OWN_DELIVERY_NOTE_LABEL} ${note.id}`, PAGE.margin, 145);
  doc.font("Helvetica").text(formatOwnDeliveryNoteDate(note.date), 470, 145, { width: 75, align: "right" });
}

function drawTable(doc, lines, y) {
  const x=PAGE.margin, width=PAGE.width-PAGE.margin*2, descW=300, coilW=110, weightW=width-descW-coilW, head=18;
  doc.lineWidth(.7).rect(x,y,width,head).stroke(); doc.moveTo(x+descW,y).lineTo(x+descW,y+head).stroke(); doc.moveTo(x+descW+coilW,y).lineTo(x+descW+coilW,y+head).stroke();
  doc.font("Helvetica-Bold").fontSize(8); doc.text("Description",x+3,y+5,{width:descW-6,align:"center"}); doc.text("Coil number",x+descW+3,y+5,{width:coilW-6,align:"center"}); doc.text("Weight (MT)",x+descW+coilW+3,y+5,{width:weightW-6,align:"center"}); y+=head;
  for (const line of lines) { doc.font("Helvetica").fontSize(8); const h=Math.max(18,Math.ceil(doc.heightOfString(line.description||"",{width:descW-8}))+8); if(y+h>PAGE.height-95){doc.addPage();y=55;} doc.rect(x,y,width,h).stroke();doc.moveTo(x+descW,y).lineTo(x+descW,y+h).stroke();doc.moveTo(x+descW+coilW,y).lineTo(x+descW+coilW,y+h).stroke();doc.text(line.description||"",x+4,y+4,{width:descW-8});doc.text(line.coilNumber||"-",x+descW+4,y+4,{width:coilW-8,align:"center"});doc.text(formatNumber(line.weight,3),x+descW+coilW+4,y+4,{width:weightW-8,align:"right"});y+=h; }
  return y;
}

function collect(doc) { return new Promise((resolve,reject)=>{ const chunks=[];doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject); }); }
