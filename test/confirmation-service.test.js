import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_VENTA } from "../src/airtable/fields.js";
import {
  confirmationTotalQuantity,
  loadedQuantityByCustomerWeightMode,
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
});
