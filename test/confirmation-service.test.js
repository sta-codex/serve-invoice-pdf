import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_VENTA } from "../src/airtable/fields.js";
import {
  confirmationTotalQuantity,
  loadedQuantityByCustomerWeightMode,
  normalizeQuantitySource,
  selectConfirmationQuantity,
  storageDeliveryKindFromPlaces
} from "../src/services/confirmation-service.js";

test("selects loaded net or gross weight by customer mode", () => {
  const fields = {
    [ITEM_VENTA.NETO_CARGADO]: 10.5,
    [ITEM_VENTA.BRUTO_CARGADO]: 11.25
  };

  assert.equal(loadedQuantityByCustomerWeightMode(fields, "Neto"), 10.5);
  assert.equal(loadedQuantityByCustomerWeightMode(fields, "Bruto"), 11.25);
  assert.equal(loadedQuantityByCustomerWeightMode(fields, ""), 11.25);
});

test("uses loaded item total before theoretical contract weight", () => {
  assert.equal(
    confirmationTotalQuantity([{ quantity: 65.66 }], 88),
    65.66
  );
  assert.equal(confirmationTotalQuantity([{ quantity: 0 }], 88), 88);
});

test("selects contract sale coil weight when requested", () => {
  assert.equal(
    selectConfirmationQuantity({
      quantitySource: "contract-sale-coils",
      selectedLoadedQuantity: 11,
      loadedQuantity: 12,
      contractSaleCoilsQuantity: 10.25,
      existenceQuantity: 9.75,
      purchaseContractNetQuantity: 13
    }),
    10.25
  );
});

test("selects assigned stock weight when requested", () => {
  assert.equal(
    selectConfirmationQuantity({
      quantitySource: "assigned-stock",
      selectedLoadedQuantity: 11,
      loadedQuantity: 12,
      contractSaleCoilsQuantity: 10.25,
      existenceQuantity: 9.75,
      purchaseContractNetQuantity: 13
    }),
    9.75
  );
});

test("normalizes Airtable button quantity source labels", () => {
  assert.equal(normalizeQuantitySource("Peso contrato venta bobinas"), "contract-sale-coils");
  assert.equal(normalizeQuantitySource("Existencias asignadas"), "assigned-stock");
  assert.equal(normalizeQuantitySource(""), "default");
});

test("uses only DDP delivery place types for storage kind", () => {
  assert.equal(
    storageDeliveryKindFromPlaces([{ type: "DDP Puerto", name: "Puerto de Sagunto" }]),
    "puerto"
  );
  assert.equal(
    storageDeliveryKindFromPlaces([{ type: "DDP Almacén", name: "Almacén Telemix" }]),
    "almacen"
  );
  assert.equal(
    storageDeliveryKindFromPlaces([{ type: "Cliente", name: "Puerto de Sagunto" }]),
    ""
  );
  assert.equal(
    storageDeliveryKindFromPlaces([{ type: "Almacén", name: "ALMACÉN TELEMIX" }]),
    ""
  );
  assert.equal(
    storageDeliveryKindFromPlaces([{ type: "Almacén", name: "Mobiliario (Paterna)" }], "DDP Mobiliario (Paterna)"),
    "almacen"
  );
  assert.equal(
    storageDeliveryKindFromPlaces([{ type: "Puerto", name: "Puerto de Sagunto" }], "DDP Puerto de Sagunto"),
    "puerto"
  );
});
