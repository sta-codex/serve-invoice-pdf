import { AirtableClient } from "../airtable/client.js";
import { LINKED_TABLES } from "../airtable/linked-tables.js";
import { normalizeInvoiceRecord } from "../domain/normalize.js";
import { EXISTENCIA, FACTURA } from "../airtable/fields.js";
import { fieldsOf, recordIds, textValue } from "../domain/values.js";

export async function loadInvoiceFromAirtable({ config, recordId, invoiceNumber }) {
  const client = new AirtableClient({
    token: config.airtable.token,
    baseId: config.airtable.baseId
  });

  const facturasTable = config.airtable.tables.facturas;
  const existenciasTable = config.airtable.tables.existencias;

  const invoiceRecord = recordId
    ? await client.getRecord(facturasTable, recordId)
    : await client.findInvoiceByNumber(facturasTable, invoiceNumber);

  if (!invoiceRecord) {
    throw new Error(`Invoice not found: ${invoiceNumber || recordId}`);
  }

  const existenciaIds = recordIds(fieldsOf(invoiceRecord)[FACTURA.EXISTENCIAS]);
  const existenceRecords = await client.listExistenciasByIds(
    existenciasTable,
    existenciaIds
  );
  const linkedNames = await loadLinkedNames(client, invoiceRecord, existenceRecords);

  return normalizeInvoiceRecord({
    record: invoiceRecord,
    existenceRecords,
    company: config.company,
    linkedNames
  });
}

async function loadLinkedNames(client, invoiceRecord, existenceRecords) {
  const invoiceFields = fieldsOf(invoiceRecord);
  const existenceFields = existenceRecords.map(fieldsOf);

  const groups = {
    salesContracts: recordIds(invoiceFields[FACTURA.VENTA]),
    incoterms: recordIds(invoiceFields[FACTURA.INCOTERM]),
    paymentTerms: recordIds(invoiceFields[FACTURA.TERMINOS_PAGO]),
    purchaseItems: existenceFields.flatMap((fields) =>
      recordIds(fields[EXISTENCIA.ITEM_COMPRA])
    ),
    deliveryLines: existenceFields.flatMap((fields) =>
      recordIds(fields[EXISTENCIA.LINEAS_ALBARAN])
    )
  };

  return Object.fromEntries(
    await Promise.all(
      Object.entries(groups).map(async ([key, ids]) => [
        key,
        await loadDisplayNameMap(client, LINKED_TABLES[key], ids)
      ])
    )
  );
}

async function loadDisplayNameMap(client, table, ids) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (!uniqueIds.length) return new Map();

  const records = table.fieldName
    ? await client.listRecordsByIdsWithFieldNames(table.tableId, uniqueIds, [
        table.fieldName
      ])
    : await client.listRecordsByIds(table.tableId, uniqueIds, [
        table.primaryFieldId
      ]);
  const displayField = table.fieldName || table.primaryFieldId;

  return new Map(
    records
      .map((record) => [
        record.id,
        textValue(fieldsOf(record)[displayField])
      ])
      .filter(([, name]) => name)
  );
}
