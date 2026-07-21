import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateOwnIdsForDate,
  formatMaterialHeading
} from "../src/services/own-delivery-note-service.js";

const DATE = "2026-06-29";
const FIELD = "fldqxidJFKKnpLFiv";

function record(id, value) {
  return { id, fields: { [FIELD]: value } };
}

test("starts with A when the date has no other own delivery notes", () => {
  assert.deepEqual(allocate({ records: [] }), ["STA-2026-2906A"]);
});

test("does not increment an ID merely because it belongs to the same record", () => {
  assert.deepEqual(allocate({
    records: [record("current", "STA-2026-2906A")],
    currentValue: "STA-2026-2906A"
  }), ["STA-2026-2906A"]);
});

test("repairs a provisional increment left without a PDF", () => {
  assert.deepEqual(allocate({
    records: [record("current", "STA-2026-2906B")],
    currentValue: "STA-2026-2906B"
  }), ["STA-2026-2906A"]);
});

test("increments when A belongs to another delivery note", () => {
  assert.deepEqual(allocate({
    records: [record("other", "STA-2026-2906A")]
  }), ["STA-2026-2906B"]);
});

test("keeps B when A belongs to another delivery note", () => {
  assert.deepEqual(allocate({
    records: [record("other", "STA-2026-2906A"), record("current", "STA-2026-2906B")],
    currentValue: "STA-2026-2906B"
  }), ["STA-2026-2906B"]);
});

test("preserves a completed current ID even if an earlier ID becomes free", () => {
  assert.deepEqual(allocate({
    records: [record("current", "STA-2026-2906B")],
    currentValue: "STA-2026-2906B",
    preserveCurrent: true
  }), ["STA-2026-2906B"]);
});

test("allocates one unique ID per customer while skipping occupied IDs", () => {
  assert.deepEqual(allocate({
    records: [record("one", "STA-2026-2906A"), record("two", "STA-2026-2906C")],
    count: 3
  }), ["STA-2026-2906B", "STA-2026-2906D", "STA-2026-2906E"]);
});

test("builds the long English material heading from Airtable material data", () => {
  assert.equal(
    formatMaterialHeading("Cold Rolled Steel", "Bobina"),
    "COLD ROLLED STEEL COILS"
  );
  assert.equal(
    formatMaterialHeading("Prepainted Galvanized Steel", "Bobina"),
    "PREPAINTED GALVANIZED STEEL COILS"
  );
  assert.equal(
    formatMaterialHeading("Hot Rolled Plates", "Chapa"),
    "HOT ROLLED PLATES"
  );
});

function allocate(overrides) {
  return allocateOwnIdsForDate({
    records: [],
    recordId: "current",
    date: DATE,
    count: 1,
    currentValue: "",
    preserveCurrent: false,
    ...overrides
  });
}
