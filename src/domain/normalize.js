import { FACTURA, EXISTENCIA } from "../airtable/fields.js";
import { buildMeasure, roundMoney } from "./format.js";
import {
  dateValue,
  fieldsOf,
  firstText,
  isAirtableRecordId,
  numberValue,
  recordIds,
  textValue
} from "./values.js";

export function normalizeInvoiceRecord({
  record,
  existenceRecords,
  company,
  linkedNames = {}
}) {
  const fields = fieldsOf(record);
  const lines = existenceRecords.map((existenceRecord) =>
    normalizeExistenciaRecord(existenceRecord, linkedNames)
  );

  return finalizeInvoice({
    recordId: record.id,
    company,
    invoiceNumber: firstText(fields[FACTURA.ID]) || record.id,
    date: dateValue(fields[FACTURA.FECHA]),
    dueDate: dateValue(fields[FACTURA.VENCIMIENTO_ESTIMADO]),
    description: firstText(fields[FACTURA.DESCRIPCION]) || "HOT ROLLED STEEL COILS",
    customer: {
      commercialName: firstText(fields[FACTURA.CLIENTE]),
      fiscalName:
        firstText(fields[FACTURA.CLIENTE_NOMBRE_FISCAL]) ||
        firstText(fields[FACTURA.CLIENTE]),
      address: firstText(fields[FACTURA.CLIENTE_DOMICILIO]),
      postalCode: firstText(fields[FACTURA.CLIENTE_CP]),
      city: firstText(fields[FACTURA.CLIENTE_MUNICIPIO]),
      province: firstText(fields[FACTURA.CLIENTE_PROVINCIA]),
      country: firstText(fields[FACTURA.CLIENTE_PAIS]),
      taxId: firstText(fields[FACTURA.CLIENTE_NIF])
    },
    saleRef:
      namesFromIds(linkedNames.salesContracts, recordIds(fields[FACTURA.VENTA])) ||
      textValue(fields[FACTURA.VENTA]),
    packingList: textValue(fields[FACTURA.PACKING_LIST]),
    deliveryTerms:
      namesFromIds(linkedNames.incoterms, recordIds(fields[FACTURA.INCOTERM])) ||
      textValue(fields[FACTURA.INCOTERM]),
    deliveryId: deliveryLineNamesFromExistences(
      linkedNames.deliveryLines,
      existenceRecords
    ),
    paymentTerms:
      namesFromIds(linkedNames.paymentTerms, recordIds(fields[FACTURA.TERMINOS_PAGO])) ||
      textValue(fields[FACTURA.TERMINOS_PAGO]),
    invoiceValue:
      numberValue(fields[FACTURA.VALOR_FACTURA_SIN_IVA]) ||
      numberValue(fields[FACTURA.VALOR_VENTA]),
    invoiceWeight: numberValue(fields[FACTURA.PESO]),
    existenciaIds: recordIds(fields[FACTURA.EXISTENCIAS]),
    lines
  });
}

export function finalizeInvoice(invoice) {
  const lines = invoice.lines || [];
  const computedSubtotal = roundMoney(
    lines.reduce((total, line) => total + (line.amount || 0), 0)
  );
  const subtotal = computedSubtotal || roundMoney(invoice.invoiceValue || 0);
  const totalQuantity =
    lines.reduce((total, line) => total + (line.quantity || 0), 0) ||
    invoice.invoiceWeight ||
    0;

  return {
    ...invoice,
    lines,
    groupedLines: groupLines(lines),
    subtotal,
    vatRate: 0,
    vatAmount: 0,
    total: subtotal,
    totalQuantity,
    packingList:
      invoice.packingList ||
      unique(lines.map((line) => line.packingList).filter(Boolean)).join(" / "),
    deliveryId:
      invoice.deliveryId ||
      unique(
        lines
          .flatMap((line) => line.deliveryLineIds || [])
          .filter(Boolean)
      ).join(" / ")
  };
}

function normalizeExistenciaRecord(record, linkedNames) {
  const fields = fieldsOf(record);
  const rawDescription = firstText(fields[EXISTENCIA.DESCRIPCION]);
  const material =
    textValue(fields[EXISTENCIA.MATERIAL]) || inferMaterial(rawDescription);
  const quality = textValue(fields[EXISTENCIA.CALIDAD]);
  const measure = buildMeasure({
    thickness: numberValue(fields[EXISTENCIA.ESPESOR]),
    width: firstText(fields[EXISTENCIA.ANCHO]),
    length: firstText(fields[EXISTENCIA.LARGO]),
    fallback: firstText(fields[EXISTENCIA.MEDIDA])
  });
  const quantity =
    numberValue(fields[EXISTENCIA.PESO_FACTURA]) ||
    numberValue(fields[EXISTENCIA.NETO]) ||
    numberValue(fields[EXISTENCIA.BRUTO]) ||
    0;
  const price = numberValue(fields[EXISTENCIA.PRECIO_EUR_MT]) || 0;
  const factoryId = firstText(fields[EXISTENCIA.ID_FABRICA]);
  const packingList = firstText(fields[EXISTENCIA.PACKING_LIST]);
  const purchaseItemIds = recordIds(fields[EXISTENCIA.ITEM_COMPRA]);

  return {
    recordId: record.id,
    factoryId,
    productType: textValue(fields[EXISTENCIA.TIPO_EXISTENCIA]),
    material,
    measure,
    thickness: numberValue(fields[EXISTENCIA.ESPESOR]),
    width: firstText(fields[EXISTENCIA.ANCHO]),
    length: firstText(fields[EXISTENCIA.LARGO]),
    quality,
    purchaseItemIds,
    purchaseItemName: namesFromIds(linkedNames.purchaseItems, purchaseItemIds),
    saleItemIds: recordIds(fields[EXISTENCIA.ITEM_VENTA]),
    invoiceIds: recordIds(fields[EXISTENCIA.FACTURA]),
    deliveryLineIds: recordIds(fields[EXISTENCIA.LINEAS_ALBARAN]),
    quantity,
    net: numberValue(fields[EXISTENCIA.NETO]) || quantity,
    gross: numberValue(fields[EXISTENCIA.BRUTO]) || quantity,
    units: numberValue(fields[EXISTENCIA.UDS]) || 1,
    price,
    amount: roundMoney(quantity * price),
    packingList,
    description:
      [material, measure, quality].filter(Boolean).join(" ") ||
      rawDescription,
    detailDescription: [
      material,
      measure,
      quality,
      factoryId,
      packingList
    ]
      .filter(Boolean)
      .join(" ")
  };
}

function inferMaterial(description) {
  const firstToken = String(description || "").trim().split(/\s+/)[0];
  if (!firstToken || /^[\d.,]+$/.test(firstToken) || isAirtableRecordId(firstToken)) {
    return "";
  }
  return firstToken;
}

function groupLines(lines) {
  const groups = new Map();
  for (const line of lines) {
    const purchaseKey = line.purchaseItemIds[0] || line.description;
    const key = `${purchaseKey}|${line.price}|${line.description}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        description: [line.measure, line.quality].filter(Boolean).join(" "),
        material: line.material,
        measure: line.measure,
        quality: line.quality,
        purchaseItemId: line.purchaseItemIds[0],
        purchaseItemName: line.purchaseItemName,
        price: line.price,
        quantity: 0,
        amount: 0,
        lines: []
      });
    }
    const group = groups.get(key);
    group.quantity += line.quantity || 0;
    group.amount += line.amount || 0;
    group.lines.push(line);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    quantity: roundQuantity(group.quantity),
    amount: roundMoney(group.amount)
  }));
}

function deliveryLineNamesFromExistences(nameMap, existenceRecords) {
  if (!nameMap || !existenceRecords?.length) return "";

  const lineIdGroups = existenceRecords
    .map((existenceRecord) =>
      recordIds(fieldsOf(existenceRecord)[EXISTENCIA.LINEAS_ALBARAN])
    )
    .filter((ids) => ids.length > 0);

  if (!lineIdGroups.length) return "";

  const commonIds = intersectMany(lineIdGroups);
  const selectedIds = commonIds.length
    ? commonIds
    : unique(lineIdGroups.flat());

  return namesFromIds(nameMap, selectedIds);
}

function namesFromIds(nameMap, ids) {
  if (!nameMap || !ids?.length) return "";
  return ids.map((id) => nameMap.get(id)).filter(Boolean).join(" / ");
}

function intersectMany(groups) {
  const [first, ...rest] = groups;
  return unique(first).filter((id) =>
    rest.every((group) => group.includes(id))
  );
}

function roundQuantity(value) {
  return Math.round((value || 0) * 1000) / 1000;
}

function unique(values) {
  return [...new Set(values)];
}
