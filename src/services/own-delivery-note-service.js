import { AirtableClient } from "../airtable/client.js";
import { CONTRATO_VENTA, EXISTENCIA, ITEM_VENTA } from "../airtable/fields.js";
import { fieldsOf, recordIds, textValue } from "../domain/values.js";

const ALBARAN = { CARGA:"fldphpQv8LKwpAMOI", MATRICULA:"fld4334sjMHctSjz5", EXISTENCIAS:"fldScPqK214RzAQSW", ALBARAN_PROPIO_ID:"fldqxidJFKKnpLFiv", ALBARAN_PROPIO_PDF:"fldjHfCgjTX0Bay6W" };
const CLIENTE = { NOMBRE_COMERCIAL:"fld11Gh5bWcZ0CXiz", NOMBRE_FISCAL:"fldjf0CdOybWQATX4", DOMICILIO_FISCAL:"fldT27pMLegGjsla3", CODIGO_POSTAL:"flddWfBgfWLfYi4Gu", MUNICIPIO:"fldXVJQsu0EgLdUZi", PROVINCIA:"fldJ0d9vpnkSZ1DIb", PAIS:"fldcdR93qizTIeW5s", NIF:"fldJT91Hj8W2J9C0h" };
const COIL_NUMBER = "fldQANgNRiprhR8Hi";
const STOCK_FIELDS = [EXISTENCIA.DESCRIPCION, COIL_NUMBER, EXISTENCIA.NETO, EXISTENCIA.BRUTO, EXISTENCIA.PESO_FACTURA, EXISTENCIA.ITEM_VENTA];
const SALE_FIELDS = [ITEM_VENTA.CONTRATO];
const CONTRACT_FIELDS = [CONTRATO_VENTA.CLIENTE];
const CUSTOMER_FIELDS = Object.values(CLIENTE);

export async function planOwnDeliveryNotes({ config, recordId }) {
  const client = new AirtableClient({ token: config.airtable.token, baseId: config.airtable.baseId });
  const note = await client.getRecord("tblEKrWWzyZQ54pWl", recordId);
  if (!note) throw new Error(`Albarán no encontrado: ${recordId}`);
  const fields = fieldsOf(note);
  const date = textValue(fields[ALBARAN.CARGA]);
  if (!date) throw new Error("El albarán no tiene Carga; no se puede generar su ID.");
  const stock = await client.listRecordsByIds(config.airtable.tables.existencias, recordIds(fields[ALBARAN.EXISTENCIAS]), STOCK_FIELDS);
  if (!stock.length) throw new Error("El albarán no tiene Existencias.");
  const customerByStockId = await customersForStock({ client, config, stock });
  const groups = new Map();
  for (const item of stock) {
    const customer = customerByStockId.get(item.id);
    if (!customer) throw new Error(`La existencia ${item.id} no resuelve un único cliente.`);
    if (!groups.has(customer.id)) groups.set(customer.id, { customer, stock: [] });
    groups.get(customer.id).stock.push(item);
  }
  const sortedGroups = [...groups.values()].sort((a,b) => a.customer.commercialName.localeCompare(b.customer.commercialName, "es"));
  const existing = await client.listRecords("tblEKrWWzyZQ54pWl", { fields: [ALBARAN.ALBARAN_PROPIO_ID] });
  const ids = allocateOwnIdsForDate({
    records: existing,
    recordId,
    date,
    count: sortedGroups.length,
    currentValue: fields[ALBARAN.ALBARAN_PROPIO_ID],
    preserveCurrent: Array.isArray(fields[ALBARAN.ALBARAN_PROPIO_PDF]) && fields[ALBARAN.ALBARAN_PROPIO_PDF].length > 0
  });
  return { date, groups: sortedGroups.map((group, index) => ({ id: ids[index], customer: group.customer, stockIds: group.stock.map(x => x.id), count: group.stock.length })) };
}

export async function loadOwnDeliveryNote({ config, recordId, ownId }) {
  const plan = await planOwnDeliveryNotes({ config, recordId });
  const group = plan.groups.find(item => item.id === ownId);
  if (!group) throw new Error(`El ID ${ownId} no pertenece al plan actual del albarán.`);
  const client = new AirtableClient({ token: config.airtable.token, baseId: config.airtable.baseId });
  const note = await client.getRecord("tblEKrWWzyZQ54pWl", recordId);
  const stock = await client.listRecordsByIds(config.airtable.tables.existencias, group.stockIds, STOCK_FIELDS);
  const fields = fieldsOf(note);
  return { id: ownId, date: textValue(fields[ALBARAN.CARGA]), plate: textValue(fields[ALBARAN.MATRICULA]), customer: group.customer, company: config.company, lines: stock.map(record => { const f=fieldsOf(record); return { description:textValue(f[EXISTENCIA.DESCRIPCION]) || record.id, coilNumber:textValue(f[COIL_NUMBER]), weight: number(f[EXISTENCIA.PESO_FACTURA]) || number(f[EXISTENCIA.NETO]) || number(f[EXISTENCIA.BRUTO]) || 0 }; }) };
}

async function customersForStock({ client, config, stock }) {
  const saleItems = await client.listRecordsByIds(config.airtable.tables.saleItems, stock.flatMap(x => recordIds(fieldsOf(x)[EXISTENCIA.ITEM_VENTA])), SALE_FIELDS);
  const sales = await client.listRecordsByIds(config.airtable.tables.salesContracts, saleItems.flatMap(x => recordIds(fieldsOf(x)[ITEM_VENTA.CONTRATO])), CONTRACT_FIELDS);
  const customers = await client.listRecordsByIds("tbliyYuo9mWCnHGUG", sales.flatMap(x => recordIds(fieldsOf(x)[CONTRATO_VENTA.CLIENTE])), CUSTOMER_FIELDS);
  const customerById = new Map(customers.map(x => [x.id, normalizeCustomer(x)]));
  const salesById = new Map(sales.map(x => [x.id, recordIds(fieldsOf(x)[CONTRATO_VENTA.CLIENTE]) ]));
  const saleItemById = new Map(saleItems.map(x => [x.id, recordIds(fieldsOf(x)[ITEM_VENTA.CONTRATO]) ]));
  const out = new Map();
  for (const item of stock) { const customerIds=[...new Set(recordIds(fieldsOf(item)[EXISTENCIA.ITEM_VENTA]).flatMap(id => (saleItemById.get(id)||[]).flatMap(saleId => salesById.get(saleId)||[])))]; if(customerIds.length===1 && customerById.has(customerIds[0])) out.set(item.id, customerById.get(customerIds[0])); }
  return out;
}

function normalizeCustomer(record) { const f=fieldsOf(record); return { id:record.id, commercialName:textValue(f[CLIENTE.NOMBRE_COMERCIAL]) || record.id, fiscalName:textValue(f[CLIENTE.NOMBRE_FISCAL]), address:textValue(f[CLIENTE.DOMICILIO_FISCAL]), postalCode:textValue(f[CLIENTE.CODIGO_POSTAL]), city:textValue(f[CLIENTE.MUNICIPIO]), province:textValue(f[CLIENTE.PROVINCIA]), country:textValue(f[CLIENTE.PAIS]), taxId:textValue(f[CLIENTE.NIF]) }; }
export function allocateOwnIdsForDate({ records, recordId, date, count, currentValue, preserveCurrent = false }) {
  const prefix = `STA-${date.slice(0,4)}-${date.slice(8,10)}${date.slice(5,7)}`;
  const occupied = new Set();
  for (const record of records) {
    if (record.id === recordId) continue;
    for (const index of idIndexes(textValue(fieldsOf(record)[ALBARAN.ALBARAN_PROPIO_ID]), prefix)) occupied.add(index);
  }

  const candidateIndexes = [];
  for (let index = 0; candidateIndexes.length < count; index += 1) {
    if (!occupied.has(index)) candidateIndexes.push(index);
  }

  const currentIndexes = [...new Set(idIndexes(textValue(currentValue), prefix))].sort((a, b) => a - b);
  const currentIsUsable = currentIndexes.length === count && currentIndexes.every((index) => !occupied.has(index));
  const currentMatchesCandidate = currentIsUsable && currentIndexes.every((index, position) => index === candidateIndexes[position]);
  const selected = currentIsUsable && (preserveCurrent || currentMatchesCandidate) ? currentIndexes : candidateIndexes;
  return selected.map((index) => ownId(date, index));
}

function idIndexes(value, prefix) {
  const pattern = new RegExp(`^${prefix}([A-Z]+)$`);
  return String(value || "").split(/,\s*/).map((id) => id.match(pattern)).filter(Boolean).map((match) => lettersToIndex(match[1]));
}
function ownId(date, index) { return `STA-${date.slice(0,4)}-${date.slice(8,10)}${date.slice(5,7)}${indexToLetters(index)}`; }
function lettersToIndex(value) { return [...value].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1; }
function indexToLetters(index) { let n=index+1, out=""; while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);} return out; }
function number(value) { const n=Number(value); return Number.isFinite(n)?n:0; }
