import assert from "node:assert/strict";
import test from "node:test";
import {
  CARRIER_DETAILS_LABEL,
  formatOwnDeliveryNoteDate,
  LICENSE_PLATE_LABEL,
  ownDeliveryNoteTaxId,
  OWN_DELIVERY_NOTE_LABEL,
  renderOwnDeliveryNotePdf
} from "../src/render/own-delivery-note-pdf.js";

test("uses English labels throughout the delivery note template", () => {
  assert.equal(OWN_DELIVERY_NOTE_LABEL, "DELIVERY NOTE:");
  assert.equal(CARRIER_DETAILS_LABEL, "CARRIER DETAILS");
  assert.equal(LICENSE_PLATE_LABEL, "License plate:");
});

test("keeps dates in Spanish day-month-year format", () => {
  assert.equal(formatOwnDeliveryNoteDate("2026-06-29"), "29/06/2026");
});

test("shows both tax IDs without a CIF prefix", () => {
  assert.equal(ownDeliveryNoteTaxId("CIF: B88047790"), "B88047790");
  assert.equal(ownDeliveryNoteTaxId("B06736391"), "B06736391");
});

test("renders an own delivery note as a PDF", async () => {
  const pdf = await renderOwnDeliveryNotePdf({
    id: "STA-2026-2906A",
    date: "2026-06-29",
    plate: "1234-ABC",
    company: {
      legalLine: "Steel Trade Advisors, S.L.",
      name: "STEEL TRADE ADVISORS",
      address: "Address",
      city: "City",
      phone: "+34 000 000 000",
      taxId: "CIF: B00000000"
    },
    customer: {
      commercialName: "Customer",
      fiscalName: "Customer, S.L.",
      address: "Customer address",
      postalCode: "00000",
      city: "City",
      province: "Province",
      country: "Spain",
      taxId: "B11111111"
    },
    materialHeadings: ["PREPAINTED GALVANIZED STEEL COILS"],
    lines: [
      { description: "Steel coil", coilNumber: "COIL-1", weight: 12.345 }
    ]
  });

  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 1000);
});
