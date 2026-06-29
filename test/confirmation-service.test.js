import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_VENTA } from "../src/airtable/fields.js";
import { loadedQuantityByCustomerWeightMode } from "../src/services/confirmation-service.js";

test("selects loaded net or gross weight by customer mode", () => {
  const fields = {
    [ITEM_VENTA.NETO_CARGADO]: 10.5,
    [ITEM_VENTA.BRUTO_CARGADO]: 11.25
  };

  assert.equal(loadedQuantityByCustomerWeightMode(fields, "Neto"), 10.5);
  assert.equal(loadedQuantityByCustomerWeightMode(fields, "Bruto"), 11.25);
  assert.equal(loadedQuantityByCustomerWeightMode(fields, ""), 10.5);
});
