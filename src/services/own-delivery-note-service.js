import { AirtableClient } from "../airtable/client.js";
import { CONTRATO_VENTA, EXISTENCIA, ITEM_VENTA } from "../airtable/fields.js";
import { normalizeThicknessInMeasure } from "../domain/format.js";
import { fieldsOf, recordIds, textValue } from "../domain/values.js";

const ALBARAN = { CARGA:"fldphpQv8LKwpAMOI", MATRICULA:"fld4334sjMHctSjz5", EXISTENCIAS:"fldScPqK214RzAQSW", LINEAS:"fldxLftcZyUdc0EQN", ALBARAN_PROPIO_ID:"fldqxidJFKKnpLFiv", ALBARAN_PROPIO_PDF:"fldjHfCgjTX0Bay6W" };
const LINEA_ALBARAN_TABLE = "tbl1m6HjYXJXZhIaj";
const LINEA_ALBARAN = { EXISTENCIAS:"flddftUO5cin39AY2", TIPO_DESTINO:"fldamKV8278oeI3Mu" };
const CLIENTE = { NOMBRE_COMERCIAL:"fld11Gh5bWcZ0CXiz", NOMBRE_FISCAL:"fldjf0CdOybWQATX4", DOMICILIO_FISCAL:"fldT27pMLegGjsla3", CODIGO_POSTAL:"flddWfBgfWLfYi4Gu", MUNICIPIO:"fldXVJQsu0EgLdUZi", PROVINCIA:"fldJ0d9vpnkSZ1DIb", PAIS:"fldcdR93qizTIeW5s", NIF:"fldJT91Hj8W2J9C0h" };
const MATERIAL_TABLE = "tbldcH54bb4nIP2Ts";
const MATERIAL = { CODE:"fldpB4YiAn2w8w70I", NAME:"fldDclRe2H0kqZw48", TYPE:"fld9l2c0MW70BKlzb" };
const MATERIAL_TYPE_TABLE = "tblVYEUxcX8xtyUsv";
const MATERIAL_TYPE = { NAME:"fldYe0hoT3OWTfwA1" };
const STOCK_FIELDS = [EXISTENCIA.DESCRIPCION, EXISTENCIA.ID_FABRICA, EXISTENCIA.NETO, EXISTENCIA.BRUTO, EXISTENCIA.PESO_FACTURA, EXISTENCIA.ITEM_VENTA, EXISTENCIA.MATERIAL];
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
  const noteStockIds = recordIds(fields[ALBARAN.EXISTENCIAS]);
  const deliveryLines = await client.listRecordsByIds(
    LINEA_ALBARAN_TABLE,
    recordIds(fields[ALBARAN.LINEAS]),
    Object.values(LINEA_ALBARAN)
  );
  const eligibleStockIds = clientDestinationStockIds({ deliveryLines, noteStockIds });
  if (!eligibleStockIds.length) {
    throw new Error("El albarán no tiene existencias en líneas cuyo Tipo de destino sea Cliente.");
  }
  const stock = await client.listRecordsByIds(config.airtable.tables.existencias, eligibleStockIds, STOCK_FIELDS);
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

export function clientDestinationStockIds({ deliveryLines, noteStockIds }) {
  const allowed = new Set(Array.isArray(noteStockIds) ? noteStockIds : []);
  const eligible = [];
  const seen = new Set();

  for (const line of Array.isArray(deliveryLines) ? deliveryLines : []) {
    const fields = fieldsOf(line);
    const destinationTypes = textValue(fields[LINEA_ALBARAN.TIPO_DESTINO], "\n")
      .split("\n")
      .map((value) => value.trim().toLocaleLowerCase("es"))
      .filter(Boolean);
    if (!destinationTypes.includes("cliente")) continue;

    for (const stockId of recordIds(fields[LINEA_ALBARAN.EXISTENCIAS])) {
      if (!allowed.has(stockId) || seen.has(stockId)) continue;
      seen.add(stockId);
      eligible.push(stockId);
    }
  }

  return eligible;
}

export async function loadOwnDeliveryNote({ config, recordId, ownId }) {
  const plan = await planOwnDeliveryNotes({ config, recordId });
  const group = plan.groups.find(item => item.id === ownId);
  if (!group) throw new Error(`El ID ${ownId} no pertenece al plan actual del albarán.`);
  const client = new AirtableClient({ token: config.airtable.token, baseId: config.airtable.baseId });
  const note = await client.getRecord("tblEKrWWzyZQ54pWl", recordId);
  const stock = await client.listRecordsByIds(config.airtable.tables.existencias, group.stockIds, STOCK_FIELDS);
  const material = await materialDetailsForStock({ client, stock });
  const fields = fieldsOf(note);
  return { id: ownId, date: textValue(fields[ALBARAN.CARGA]), plate: textValue(fields[ALBARAN.MATRICULA]), customer: group.customer, company: config.company, materialHeadings: material.headings, identifierLabel: identifierLabelForMaterialTypes(material.types), lines: stock.map(record => { const f=fieldsOf(record); return { description:normalizeThicknessInMeasure(textValue(f[EXISTENCIA.DESCRIPCION])) || record.id, factoryId:textValue(f[EXISTENCIA.ID_FABRICA]), weight: number(f[EXISTENCIA.PESO_FACTURA]) || number(f[EXISTENCIA.NETO]) || number(f[EXISTENCIA.BRUTO]) || 0 }; }) };
}

async function materialDetailsForStock({ client, stock }) {
  const materialIds = [...new Set(stock.flatMap((record) => recordIds(fieldsOf(record)[EXISTENCIA.MATERIAL])) )];
  const materials = await client.listRecordsByIds(MATERIAL_TABLE, materialIds, Object.values(MATERIAL));
  const typeIds = [...new Set(materials.flatMap((record) => recordIds(fieldsOf(record)[MATERIAL.TYPE])) )];
  const types = await client.listRecordsByIds(MATERIAL_TYPE_TABLE, typeIds, [MATERIAL_TYPE.NAME]);
  const typeById = new Map(types.map((record) => [record.id, textValue(fieldsOf(record)[MATERIAL_TYPE.NAME])]));
  const materialById = new Map(materials.map((record) => {
    const fields = fieldsOf(record);
    const name = textValue(fields[MATERIAL.NAME]) || textValue(fields[MATERIAL.CODE]);
    const type = recordIds(fields[MATERIAL.TYPE]).map((id) => typeById.get(id)).filter(Boolean)[0] || "";
    return [record.id, { heading: formatMaterialHeading(name, type), type }];
  }));
  const headings = [...new Set([...materialById.values()].map((material) => material.heading).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en"));
  const stockTypes = stock.flatMap((record) => recordIds(fieldsOf(record)[EXISTENCIA.MATERIAL]).map((id) => materialById.get(id)?.type).filter(Boolean));
  return { headings, types: stockTypes };
}

export function formatMaterialHeading(name, type) {
  const heading = String(name || "").trim().toUpperCase();
  if (!heading) return "";
  const suffix = { Bobina:"COILS", Fleje:"STRIPS", Hoja:"SHEETS", Chapa:"PLATES", "Chapa grande":"PLATES" }[String(type || "").trim()] || "";
  if (!suffix || heading.endsWith(suffix) || heading.endsWith(suffix.slice(0, -1))) return heading;
  return `${heading} ${suffix}`;
}

export function identifierLabelForMaterialTypes(types) {
  const labels = new Set();
  for (const type of Array.isArray(types) ? types : []) {
    const normalized = String(type || "").trim();
    if (["Bobina", "Fleje"].includes(normalized)) labels.add("Coil number");
    else if (["Chapa", "Chapa grande", "Hoja"].includes(normalized)) labels.add("Plate number");
    else labels.add("Coil / Plate number");
  }
  return labels.size === 1 ? [...labels][0] : "Coil / Plate number";
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
