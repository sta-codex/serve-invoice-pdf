import {
  CONTRATO_VENTA,
  CONTRATO_VENTA_FIELD_IDS,
  EXISTENCIA,
  ITEM_COMPRA,
  ITEM_COMPRA_FIELD_IDS,
  ITEM_VENTA,
  ITEM_VENTA_FIELD_IDS
} from "../airtable/fields.js";
import { AirtableClient } from "../airtable/client.js";
import { buildMeasure, roundMoney } from "../domain/format.js";
import {
  dateValue,
  fieldsOf,
  firstText,
  numberValue,
  recordIds,
  textValue
} from "../domain/values.js";

const CONFIRMATION_EXISTENCIA_FIELD_IDS = [
  EXISTENCIA.ID_FABRICA,
  EXISTENCIA.NETO,
  EXISTENCIA.BRUTO,
  EXISTENCIA.PESO_FACTURA,
  EXISTENCIA.ESPESOR,
  EXISTENCIA.ANCHO,
  EXISTENCIA.LARGO,
  EXISTENCIA.MATERIAL,
  EXISTENCIA.TIPO_EXISTENCIA,
  EXISTENCIA.ITEM_COMPRA,
  EXISTENCIA.ITEM_VENTA,
  EXISTENCIA.PRECIO_EUR_MT,
  EXISTENCIA.UDS
];

const PRODUCT_LINKED_TABLES = {
  materials: {
    tableId: "tbldcH54bb4nIP2Ts",
    primaryFieldId: "fldpB4YiAn2w8w70I",
    fieldId: ITEM_COMPRA.MATERIAL
  },
  materialTypes: {
    tableId: "tblVYEUxcX8xtyUsv",
    primaryFieldId: "fldYe0hoT3OWTfwA1",
    fieldId: ITEM_COMPRA.TIPO_MATERIAL
  },
  qualities: {
    tableId: "tbl5FidU9rlwFnXsA",
    primaryFieldId: "fldjfUar7y22bbm8m",
    fieldId: ITEM_COMPRA.CALIDAD
  },
  coatings: {
    tableId: "tblTgOysprHeLDmPD",
    primaryFieldId: "fld7QqvZnyoKhrLvp",
    fieldId: ITEM_COMPRA.RECUBRIMIENTO
  },
  finishes: {
    tableId: "tblUOMiS8uVgy7qlp",
    primaryFieldId: "fld8oofp6BCM4VP1b",
    fieldId: ITEM_COMPRA.ACABADO
  }
};

const PURCHASE_CONTRACT_TABLE_ID = "tblzaz7hDLRRPVeEz";
const FACTORY_TABLE_ID = "tblOCrtTa8WPxPDja";
const PURCHASE_CONTRACT_FIELD_IDS = ["fld0NoOFG9iFNVjQD"];
const FACTORY_FIELD_IDS = ["fld6OzLLUSc1DwQt5", "fldEQlpy2q1X8C8sP"];
const CONTRATO_VENTA_NETO_BRUTO_CLIENTE_FIELD_ID = "fldPSd1OoL8LEHmMM";
const ITEM_VENTA_LUGAR_ENTREGA_FIELD_ID = "fld1JHOdAMufJN8fM";
const ITEM_VENTA_INCOTERM_VENTA_FIELD_ID = "fldcvIYj0HFL6IlEa";
const ITEM_VENTA_NETO_BRUTO_CLIENTE_FIELD_ID = "fldXSSM3nOKtANoHO";
const DELIVERY_PLACE_TABLE_ID = "tblXhYWu2uQfbiPN7";
const DELIVERY_PLACE_NAME_FIELD_ID = "fldhsacdoe0Y9z23n";
const DELIVERY_PLACE_TYPE_FIELD_ID = "fldFykk49X29FAIPn";
const CONFIRMATION_ITEM_VENTA_FIELD_IDS = [
  ...new Set([
    ...ITEM_VENTA_FIELD_IDS,
    ITEM_VENTA_LUGAR_ENTREGA_FIELD_ID,
    ITEM_VENTA_INCOTERM_VENTA_FIELD_ID,
    ITEM_VENTA_NETO_BRUTO_CLIENTE_FIELD_ID
  ])
];

const CONTRACT_LINKED_TABLES = {
  incoterms: {
    tableId: "tblynLHJbKXFrLhTc",
    primaryFieldId: "fldPX1GEsaBR4rzMd",
    fieldId: CONTRATO_VENTA.INCOTERM
  },
  paymentTerms: {
    tableId: "tbl5psJrD0ezwtSzN",
    primaryFieldId: "fldVtyWKQXXoz2VHc",
    fieldId: CONTRATO_VENTA.TERMINOS_PAGO
  },
  provinces: {
    tableId: "tblfwiDVGMmIvp3Ps",
    primaryFieldId: "fldv5nw01AjgFV8XX",
    fieldId: CONTRATO_VENTA.CLIENTE_PROVINCIA
  },
  countries: {
    tableId: "tblA8a0LJunZ1lI1k",
    primaryFieldId: "fld5QDoTZDhXizGVR",
    fieldId: CONTRATO_VENTA.CLIENTE_PAIS
  }
};

export async function loadConfirmationFromAirtable({ config, recordId }) {
  const client = new AirtableClient({
    token: config.airtable.token,
    baseId: config.airtable.baseId
  });

  const tables = config.airtable.tables;
  const contractRecord = await client.getRecord(tables.salesContracts, recordId);
  if (!contractRecord) {
    throw new Error(`Contrato de venta no encontrado: ${recordId}`);
  }

  const contractFields = fieldsOf(contractRecord);
  const saleItemIds = recordIds(contractFields[CONTRATO_VENTA.ITEMS]);
  const saleItemRecords = await client.listRecordsByIds(
    tables.saleItems,
    saleItemIds,
    CONFIRMATION_ITEM_VENTA_FIELD_IDS
  );
  const deliveryPlaceIds = saleItemRecords.flatMap((record) =>
    recordIds(fieldsOf(record)[ITEM_VENTA_LUGAR_ENTREGA_FIELD_ID])
  );
  const deliveryPlacesById = await loadDeliveryPlacesById(client, deliveryPlaceIds);

  const purchaseItemIds = saleItemRecords.flatMap((record) =>
    recordIds(fieldsOf(record)[ITEM_VENTA.ITEM_COMPRA])
  );
  const purchaseItemRecords = await client.listRecordsByIds(
    tables.purchaseItems,
    purchaseItemIds,
    ITEM_COMPRA_FIELD_IDS
  );

  const saleExistenceIds = saleItemRecords.flatMap((record) =>
    recordIds(fieldsOf(record)[ITEM_VENTA.EXISTENCIAS])
  );
  const existenceRecords = await client.listRecordsByIds(
    tables.existencias,
    saleExistenceIds,
    CONFIRMATION_EXISTENCIA_FIELD_IDS
  );
  const purchaseOriginByPurchaseItemId = await loadPurchaseOriginByPurchaseItemId(
    client,
    purchaseItemRecords
  );
  const linkedNames = {
    ...(await loadContractLinkedNames(client, contractRecord)),
    ...(await loadProductLinkedNames(client, purchaseItemRecords))
  };

  return normalizeConfirmation({
    record: contractRecord,
    saleItemRecords,
    deliveryPlacesById,
    purchaseItemRecords,
    purchaseOriginByPurchaseItemId,
    existenceRecords,
    linkedNames,
    company: config.company
  });
}

function normalizeConfirmation({
  record,
  saleItemRecords,
  deliveryPlacesById,
  purchaseItemRecords,
  purchaseOriginByPurchaseItemId,
  existenceRecords,
  linkedNames,
  company
}) {
  const fields = fieldsOf(record);
  const purchaseItemsById = new Map(
    purchaseItemRecords.map((purchaseItem) => [purchaseItem.id, purchaseItem])
  );
  const existencesBySaleItemId = groupExistencesBySaleItem(existenceRecords);
  const contractDeliveryTerms = normalizeDeliveryTerm(
    linkedText(fields[CONTRATO_VENTA.INCOTERM], linkedNames.incoterms)
  );
  const customerWeightMode = normalizeWeightMode(
    firstText(fields[CONTRATO_VENTA_NETO_BRUTO_CLIENTE_FIELD_ID])
  );

  const items = saleItemRecords
    .map((saleItemRecord) =>
      normalizeSaleItem({
        saleItemRecord,
        deliveryPlacesById,
        purchaseItemsById,
        purchaseOriginByPurchaseItemId,
        existenceRecords: existencesBySaleItemId.get(saleItemRecord.id) || [],
        linkedNames,
        contractDeliveryTerms,
        customerWeightMode
      })
    )
    .sort(compareItemNumber);

  const hasSheetMaterial = items.some((item) => isSheetType(item.materialType));
  const totalQuantity = confirmationTotalQuantity(
    items,
    fields[CONTRATO_VENTA.PESO_POR_CONTRATO]
  );
  const origins = dedupe(
    items
      .map((item) => item.origin)
      .filter(Boolean)
      .flatMap(splitOrigin)
  );

  return {
    recordId: record.id,
    company,
    contractNumber: firstText(fields[CONTRATO_VENTA.CONTRATO]) || record.id,
    orderNumber: firstText(fields[CONTRATO_VENTA.NUMERO_PEDIDO]),
    date: dateValue(fields[CONTRATO_VENTA.FECHA]),
    currency: firstText(fields[CONTRATO_VENTA.MONEDA]) || "EUR",
    deliveryTerms: contractDeliveryTerms,
    paymentTerms: firstLinkedText(
      fields[CONTRATO_VENTA.TERMINOS_PAGO],
      linkedNames.paymentTerms
    ),
    toleranceMinus: numberValue(fields[CONTRATO_VENTA.TOLERANCIA_MENOS]),
    tolerancePlus: numberValue(fields[CONTRATO_VENTA.TOLERANCIA_MAS]),
    customer: {
      commercialName: textValue(fields[CONTRATO_VENTA.CLIENTE]),
      fiscalName:
        firstText(fields[CONTRATO_VENTA.CLIENTE_NOMBRE_FISCAL]) ||
        textValue(fields[CONTRATO_VENTA.CLIENTE]),
      address: firstText(fields[CONTRATO_VENTA.CLIENTE_DOMICILIO]),
      postalCode: firstText(fields[CONTRATO_VENTA.CLIENTE_CP]),
      city: firstText(fields[CONTRATO_VENTA.CLIENTE_MUNICIPIO]),
      province: linkedText(fields[CONTRATO_VENTA.CLIENTE_PROVINCIA], linkedNames.provinces),
      country: linkedText(fields[CONTRATO_VENTA.CLIENTE_PAIS], linkedNames.countries),
      taxId: firstText(fields[CONTRATO_VENTA.CLIENTE_NIF])
    },
    hasSheetMaterial,
    items,
    origin: origins.join(" / "),
    origins,
    totalQuantity
  };
}

function normalizeSaleItem({
  saleItemRecord,
  deliveryPlacesById,
  purchaseItemsById,
  purchaseOriginByPurchaseItemId,
  existenceRecords,
  linkedNames,
  contractDeliveryTerms,
  customerWeightMode
}) {
  const fields = fieldsOf(saleItemRecord);
  const purchaseItemIds = recordIds(fields[ITEM_VENTA.ITEM_COMPRA]);
  const purchaseItemId = purchaseItemIds[0];
  const primaryPurchaseRecord = purchaseItemsById.get(purchaseItemId);
  const purchaseRecords = purchaseItemIds
    .map((id) => purchaseItemsById.get(id))
    .filter(Boolean);
  const primaryPurchaseFields = fieldsOf(primaryPurchaseRecord);
  const measure = buildMeasure({
    thickness: numberValue(primaryPurchaseFields[ITEM_COMPRA.ESPESOR]),
    width: firstText(primaryPurchaseFields[ITEM_COMPRA.ANCHO]),
    length: firstText(primaryPurchaseFields[ITEM_COMPRA.LARGO])
  });
  const price =
    numberValue(fields[ITEM_VENTA.PRECIO]) ||
    numberValue(fields[ITEM_VENTA.PRECIO_EUR]) ||
    numberValue(primaryPurchaseFields[ITEM_COMPRA.PRECIO_EUR]) ||
    numberValue(primaryPurchaseFields[ITEM_COMPRA.PRECIO]) ||
    0;
  const existenceQuantity = roundQuantity(
    existenceRecords.reduce((sum, existence) => {
      const existenceFields = fieldsOf(existence);
      return (
        sum +
        (numberValue(existenceFields[EXISTENCIA.PESO_FACTURA]) ||
          numberValue(existenceFields[EXISTENCIA.NETO]) ||
          numberValue(existenceFields[EXISTENCIA.BRUTO]) ||
          0)
      );
    }, 0)
  );
  const itemCustomerWeightMode =
    normalizeWeightMode(firstText(fields[ITEM_VENTA_NETO_BRUTO_CLIENTE_FIELD_ID])) ||
    customerWeightMode ||
    "bruto";
  const selectedLoadedQuantity = loadedQuantityByCustomerWeightMode(
    fields,
    itemCustomerWeightMode
  );
  const quantity =
    meaningfulQuantity(selectedLoadedQuantity) ??
    meaningfulQuantity(numberValue(fields[ITEM_VENTA.PESO_CARGADO])) ??
    meaningfulQuantity(numberValue(fields[ITEM_VENTA.PESO_CONTRATO_BOBINAS])) ??
    (existenceQuantity || undefined) ??
    meaningfulQuantity(numberValue(primaryPurchaseFields[ITEM_COMPRA.NETO_CONTRATO])) ??
    0;
  const materialType = linkedText(
    primaryPurchaseFields[ITEM_COMPRA.TIPO_MATERIAL],
    linkedNames.materialTypes
  );
  const coilMinMax = summarizeCoilWeights(purchaseRecords);
  const deliveryPlaceIds = recordIds(fields[ITEM_VENTA_LUGAR_ENTREGA_FIELD_ID]);
  const deliveryPlaces = deliveryPlaceIds
    .map((id) => deliveryPlacesById.get(id))
    .filter(Boolean);
  const deliveryPlace =
    deliveryPlaces.map((place) => place.name).filter(Boolean).join(" / ") ||
    firstText(fields[ITEM_VENTA_LUGAR_ENTREGA_FIELD_ID]);
  const storageDeliveryKind = storageDeliveryKindFromPlaces(deliveryPlaces);
  const itemDeliveryTerms = deliveryTermsWithPlace(
    normalizeDeliveryTerm(firstText(fields[ITEM_VENTA_INCOTERM_VENTA_FIELD_ID])) ||
      contractDeliveryTerms,
    deliveryPlace
  );
  const specification = buildSpecification({
    material: linkedText(primaryPurchaseFields[ITEM_COMPRA.MATERIAL], linkedNames.materials),
    quality: linkedText(primaryPurchaseFields[ITEM_COMPRA.CALIDAD], linkedNames.qualities),
    coating: linkedText(primaryPurchaseFields[ITEM_COMPRA.RECUBRIMIENTO], linkedNames.coatings),
    finish: linkedText(primaryPurchaseFields[ITEM_COMPRA.ACABADO], linkedNames.finishes),
    measure,
    fallback: firstText(primaryPurchaseFields[ITEM_COMPRA.ITEM])
  });

  return {
    recordId: saleItemRecord.id,
    number: firstText(fields[ITEM_VENTA.NUMERO_ITEM]),
    name: firstText(fields[ITEM_VENTA.ITEM]),
    purchaseItemId,
    purchaseItemName: firstText(primaryPurchaseFields[ITEM_COMPRA.ITEM]),
    deliveryPlace,
    deliveryTerms: itemDeliveryTerms,
    hasStorageDeliveryPlace: Boolean(storageDeliveryKind),
    storageDeliveryKind,
    origin: dedupe(
      purchaseItemIds
        .map((id) => purchaseOriginByPurchaseItemId.get(id))
        .filter(Boolean)
        .flatMap((origin) => origin.split(" / "))
    ).join(" / "),
    materialType,
    specification,
    measure,
    minNet: coilMinMax.minNet,
    maxNet: coilMinMax.maxNet,
    sheetUnits:
      numberValue(fields[ITEM_VENTA.NUMERO_CHAPAS]) ||
      existenceRecords.length ||
      recordIds(primaryPurchaseFields[ITEM_COMPRA.EXISTENCIAS]).length ||
      undefined,
    quantity: roundQuantity(quantity),
    price,
    amount:
      numberValue(fields[ITEM_VENTA.VALOR_CONTRATO_EUR]) ||
      roundMoney(quantity * price),
    existences: existenceRecords.map((existenceRecord) =>
      normalizeExistence(existenceRecord, { fallbackSpecification: specification, price })
    )
  };
}

function summarizeCoilWeights(purchaseRecords) {
  const values = purchaseRecords.flatMap((record) => {
    const purchaseFields = fieldsOf(record);
    const minNet = numberValue(purchaseFields[ITEM_COMPRA.NETO_MINIMO]);
    const maxNet = numberValue(purchaseFields[ITEM_COMPRA.NETO_MAXIMO]);
    if (minNet === undefined && maxNet === undefined) return [];
    return [{ minNet, maxNet }];
  });
  if (!values.length) return { minNet: undefined, maxNet: undefined };

  const minNet = Math.min(
    ...values.map((value) => value.minNet).filter((value) => value !== undefined)
  );
  const maxNet = Math.max(
    ...values.map((value) => value.maxNet).filter((value) => value !== undefined)
  );
  return {
    minNet: Number.isFinite(minNet) ? minNet : undefined,
    maxNet: Number.isFinite(maxNet) ? maxNet : undefined
  };
}

function splitOrigin(origin) {
  return String(origin || "")
    .split("/")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeExistence(record, { fallbackSpecification, price }) {
  const fields = fieldsOf(record);
  const quantity =
    numberValue(fields[EXISTENCIA.PESO_FACTURA]) ||
    numberValue(fields[EXISTENCIA.NETO]) ||
    numberValue(fields[EXISTENCIA.BRUTO]) ||
    0;
  const existencePrice = numberValue(fields[EXISTENCIA.PRECIO_EUR_MT]) || price || 0;
  return {
    recordId: record.id,
    factoryId: firstText(fields[EXISTENCIA.ID_FABRICA]) || record.id,
    specification:
      buildSpecification({
        material: textValue(fields[EXISTENCIA.MATERIAL]),
        measure: buildMeasure({
          thickness: numberValue(fields[EXISTENCIA.ESPESOR]),
          width: firstText(fields[EXISTENCIA.ANCHO]),
          length: firstText(fields[EXISTENCIA.LARGO])
        })
      }) || fallbackSpecification,
    quantity: roundQuantity(quantity),
    price: existencePrice,
    amount: roundMoney(quantity * existencePrice),
    units: numberValue(fields[EXISTENCIA.UDS]) || 1
  };
}

async function loadDeliveryPlacesById(client, deliveryPlaceIds) {
  const uniqueIds = [...new Set(deliveryPlaceIds)].filter(Boolean);
  if (!uniqueIds.length) return new Map();

  const records = await client.listRecordsByIds(
    DELIVERY_PLACE_TABLE_ID,
    uniqueIds,
    [DELIVERY_PLACE_NAME_FIELD_ID, DELIVERY_PLACE_TYPE_FIELD_ID]
  );

  return new Map(
    records.map((record) => {
      const fields = fieldsOf(record);
      return [
        record.id,
        {
          id: record.id,
          name: firstText(fields[DELIVERY_PLACE_NAME_FIELD_ID]),
          type: firstText(fields[DELIVERY_PLACE_TYPE_FIELD_ID])
        }
      ];
    })
  );
}

function isClientStorageDeliveryPlace(place) {
  const type = normalizeText(place?.type);
  const name = normalizeText(place?.name);
  return type === "cliente" && (name.includes("puerto") || name.includes("almacen"));
}

function storageDeliveryKindFromPlaces(places) {
  const eligibleNames = places
    .filter(isClientStorageDeliveryPlace)
    .map((place) => normalizeText(place?.name));
  if (eligibleNames.some((name) => name.includes("puerto"))) return "puerto";
  if (eligibleNames.some((name) => name.includes("almacen"))) return "almacen";
  return "";
}

async function loadPurchaseOriginByPurchaseItemId(client, purchaseItemRecords) {
  const purchaseItemToContractIds = new Map();
  const purchaseContractIds = [
    ...new Set(
      purchaseItemRecords.flatMap((record) => {
        const ids = recordIds(fieldsOf(record)[ITEM_COMPRA.CONTRATO]);
        purchaseItemToContractIds.set(record.id, ids);
        return ids;
      })
    )
  ].filter(Boolean);

  if (!purchaseContractIds.length) return new Map();

  const purchaseContractRecords = await client.listRecordsByIds(
    PURCHASE_CONTRACT_TABLE_ID,
    purchaseContractIds,
    PURCHASE_CONTRACT_FIELD_IDS
  );
  const purchaseContractToFactoryIds = new Map(
    purchaseContractRecords.map((record) => [
      record.id,
      recordIds(fieldsOf(record)[PURCHASE_CONTRACT_FIELD_IDS[0]])
    ])
  );

  const factoryIds = [
    ...new Set(
      purchaseContractRecords.flatMap((record) => purchaseContractToFactoryIds.get(record.id) || [])
    )
  ].filter(Boolean);
  const factoryRecords = await client.listRecordsByIds(
    FACTORY_TABLE_ID,
    factoryIds,
    FACTORY_FIELD_IDS
  );
  const factoryById = new Map(
    factoryRecords
      .map((record) => [
        record.id,
        {
          name: firstText(fieldsOf(record)[FACTORY_FIELD_IDS[0]]),
          country: firstText(fieldsOf(record)[FACTORY_FIELD_IDS[1]])
        }
      ])
      .filter(([, factory]) => factory.name)
  );

  const originsByPurchaseItemId = new Map();
  for (const [purchaseItemId, contractIds] of purchaseItemToContractIds) {
    const factoryIdsForItem = [
      ...new Set(
        contractIds.flatMap((contractId) =>
          purchaseContractToFactoryIds.get(contractId) || []
        )
      )
    ];
    if (!factoryIdsForItem.length) continue;

    const origins = dedupe(
      factoryIdsForItem
        .map((factoryId) => {
          const factory = factoryById.get(factoryId);
          if (!factory) return null;
          if (!factory.country) return factory.name;
          return `${factory.name} (${factory.country})`;
        })
        .filter(Boolean)
    );

    if (origins.length) {
      originsByPurchaseItemId.set(purchaseItemId, origins.join(" / "));
    }
  }

  return originsByPurchaseItemId;
}

export function getConfirmationLines(confirmation, mode) {
  if (mode === "detail") {
    return confirmation.items.flatMap((item) => {
      if (!item.existences.length) {
        return [
          {
            itemNumber: item.number,
            specification: item.specification,
            origin: item.origin,
            deliveryPlace: item.deliveryPlace,
            deliveryTerms: item.deliveryTerms,
            hasStorageDeliveryPlace: item.hasStorageDeliveryPlace,
            storageDeliveryKind: item.storageDeliveryKind,
            factoryId: "",
            minNet: item.minNet,
            maxNet: item.maxNet,
            quantity: item.quantity,
            price: item.price,
            amount: item.amount
          }
        ];
      }
      return item.existences.map((existence) => ({
        itemNumber: item.number,
        specification: item.specification || existence.specification,
        origin: item.origin,
        deliveryPlace: item.deliveryPlace,
        deliveryTerms: item.deliveryTerms,
        hasStorageDeliveryPlace: item.hasStorageDeliveryPlace,
        storageDeliveryKind: item.storageDeliveryKind,
        factoryId: existence.factoryId,
        minNet: item.minNet,
        maxNet: item.maxNet,
        quantity: existence.quantity,
        price: item.price || existence.price,
        amount: roundMoney(existence.quantity * (item.price || existence.price))
      }));
    });
  }

  return confirmation.items.map((item) => ({
    itemNumber: item.number,
    specification: item.specification,
    origin: item.origin,
    deliveryPlace: item.deliveryPlace,
    deliveryTerms: item.deliveryTerms,
    hasStorageDeliveryPlace: item.hasStorageDeliveryPlace,
    storageDeliveryKind: item.storageDeliveryKind,
    units: item.sheetUnits,
    minNet: item.minNet,
    maxNet: item.maxNet,
    quantity: item.quantity,
    price: item.price,
    amount: item.amount
  }));
}

export function isSheetType(value) {
  const normalized = normalizeText(value);
  return normalized === "chapa" || normalized === "chapa grande";
}

export function loadedQuantityByCustomerWeightMode(fields, customerWeightMode) {
  const mode = normalizeWeightMode(customerWeightMode) || "bruto";
  if (mode === "bruto") return numberValue(fields[ITEM_VENTA.BRUTO_CARGADO]);
  return numberValue(fields[ITEM_VENTA.NETO_CARGADO]);
}

export function confirmationTotalQuantity(items, contractQuantity) {
  const loadedItemsTotalQuantity = roundQuantity(
    items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
  );
  return loadedItemsTotalQuantity || numberValue(contractQuantity) || 0;
}

function groupExistencesBySaleItem(records) {
  const result = new Map();
  for (const record of records) {
    const saleItemIds = recordIds(fieldsOf(record)[EXISTENCIA.ITEM_VENTA]);
    for (const saleItemId of saleItemIds) {
      if (!result.has(saleItemId)) result.set(saleItemId, []);
      result.get(saleItemId).push(record);
    }
  }
  return result;
}

async function loadProductLinkedNames(client, purchaseItemRecords) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(PRODUCT_LINKED_TABLES).map(async ([key, config]) => {
        const ids = purchaseItemRecords.flatMap((record) =>
          recordIds(fieldsOf(record)[config.fieldId])
        );
        return [key, await loadDisplayNameMap(client, config, ids)];
      })
    )
  );
}

async function loadContractLinkedNames(client, contractRecord) {
  const fields = fieldsOf(contractRecord);
  return Object.fromEntries(
    await Promise.all(
      Object.entries(CONTRACT_LINKED_TABLES).map(async ([key, config]) => [
        key,
        await loadDisplayNameMap(client, config, recordIds(fields[config.fieldId]))
      ])
    )
  );
}

async function loadDisplayNameMap(client, table, ids) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (!uniqueIds.length) return new Map();

  const records = await client.listRecordsByIds(table.tableId, uniqueIds, [
    table.primaryFieldId
  ]);
  return new Map(
    records
      .map((record) => [
        record.id,
        firstText(fieldsOf(record)[table.primaryFieldId])
      ])
      .filter(([, name]) => name)
  );
}

function linkedText(value, names) {
  const resolved = recordIds(value)
    .map((id) => names?.get(id))
    .filter(Boolean);
  return resolved.length ? [...new Set(resolved)].join(" / ") : textValue(value);
}

function firstLinkedText(value, names) {
  return linkedText(value, names);
}

function normalizeDeliveryTerm(value) {
  const raw = String(value || "").trim();
  const match = raw.match(
    /\b(?:EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DAT|DPU|DDP)\b/i
  );
  return match ? match[0].toUpperCase() : raw;
}

function deliveryTermsWithPlace(deliveryTerms, deliveryPlace) {
  const normalizedTerms = String(deliveryTerms || "").trim();
  const normalizedPlace = String(deliveryPlace || "").trim();
  if (!normalizedTerms || !normalizedPlace) return normalizedTerms;

  const placeForMatch = normalizeText(normalizedPlace);
  const termsForMatch = normalizeText(normalizedTerms);
  if (termsForMatch.endsWith(placeForMatch)) return normalizedTerms;

  return `${normalizedTerms} ${normalizedPlace}`;
}

function dedupe(values) {
  return [...new Set(values)];
}

function buildSpecification({ material, quality, coating, finish, measure, fallback }) {
  return (
    [material, quality, coating, finish, measure].filter(Boolean).join(" ") ||
    fallback ||
    ""
  );
}

function compareItemNumber(a, b) {
  return String(a.number || a.name).localeCompare(String(b.number || b.name), "es", {
    numeric: true,
    sensitivity: "base"
  });
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeWeightMode(value) {
  const normalized = normalizeText(value);
  if (normalized === "bruto") return "bruto";
  if (normalized === "neto") return "neto";
  return "";
}

function meaningfulQuantity(value) {
  return value ? value : undefined;
}

function roundQuantity(value) {
  return Math.round((value || 0) * 1000) / 1000;
}
