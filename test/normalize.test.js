import test from "node:test";
import assert from "node:assert/strict";
import { finalizeInvoice, normalizeInvoiceRecord } from "../src/domain/normalize.js";
import { EXISTENCIA, FACTURA } from "../src/airtable/fields.js";

test("groups invoice lines by purchase item, description and price", () => {
  const invoice = finalizeInvoice({
    invoiceNumber: "T-1",
    lines: [
      line("A", "2,10 x 1250 S235JR", 10, 485),
      line("A", "2,10 x 1250 S235JR", 15, 485),
      line("B", "2,40 x 1219 S235JR", 20, 490)
    ]
  });

  assert.equal(invoice.groupedLines.length, 2);
  assert.equal(invoice.groupedLines[0].quantity, 25);
  assert.equal(invoice.groupedLines[0].amount, 12125);
  assert.equal(invoice.subtotal, 21925);
});

test("uses delivery line Nombre values for invoice delivery id", () => {
  const invoice = normalizeInvoiceRecord({
    record: {
      id: "recInvoice",
      fields: {
        [FACTURA.ID]: "T-3",
        [FACTURA.EXISTENCIAS]: [{ id: "recStock" }]
      }
    },
    existenceRecords: [
      {
        id: "recStock",
        fields: {
          [EXISTENCIA.LINEAS_ALBARAN]: [{ id: "recLine" }]
        }
      }
    ],
    company: {},
    linkedNames: {
      deliveryLines: new Map([["recLine", "419029"]])
    }
  });

  assert.equal(invoice.deliveryId, "419029");
});

function line(purchaseItemId, description, quantity, price) {
  return {
    purchaseItemIds: [purchaseItemId],
    description,
    quantity,
    price,
    amount: quantity * price
  };
}

