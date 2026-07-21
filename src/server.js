import "dotenv/config";
import Fastify from "fastify";
import { getConfig } from "./config.js";
import { renderConfirmationResponse } from "./render/confirmation-bundle.js";
import { renderInvoiceResponse } from "./render/bundle.js";
import { loadConfirmationFromAirtable } from "./services/confirmation-service.js";
import { loadInvoiceFromAirtable } from "./services/invoice-service.js";
import { loadOwnDeliveryNote, planOwnDeliveryNotes } from "./services/own-delivery-note-service.js";
import { renderOwnDeliveryNotePdf } from "./render/own-delivery-note-pdf.js";

const config = getConfig();
const app = Fastify({ logger: true });

app.get("/health", async () => ({
  ok: true,
  service: "steel-trade-invoice-service",
  deployment: {
    repository: process.env.RENDER_GIT_REPO_SLUG || null,
    branch: process.env.RENDER_GIT_BRANCH || null,
    commit: process.env.RENDER_GIT_COMMIT || null
  }
}));

app.get("/api/delivery-notes/:recordId/own-delivery-notes/plan", async (request) =>
  planOwnDeliveryNotes({ config, recordId: request.params.recordId })
);

app.get("/api/delivery-notes/:recordId/own-delivery-notes/:ownId.pdf", async (request, reply) => {
  const note = await loadOwnDeliveryNote({ config, recordId: request.params.recordId, ownId: request.params.ownId });
  const pdf = await renderOwnDeliveryNotePdf(note);
  reply.header("Content-Type", "application/pdf");
  reply.header("Content-Disposition", `attachment; filename="${note.id}.pdf"`);
  return reply.send(pdf);
});
app.get("/api/invoices/:recordId", async (request, reply) => {
  const mode = normalizeMode(request.query.mode);
  const format = normalizeFormat(request.query.format, mode);
  const invoice = await loadInvoiceFromAirtable({
    config,
    recordId: request.params.recordId
  });
  return sendRendered(
    reply,
    await renderInvoiceResponse(invoice, { mode, format })
  );
});

app.get("/api/invoices/by-number/:invoiceNumber", async (request, reply) => {
  const mode = normalizeMode(request.query.mode);
  const format = normalizeFormat(request.query.format, mode);
  const invoice = await loadInvoiceFromAirtable({
    config,
    invoiceNumber: request.params.invoiceNumber
  });
  return sendRendered(
    reply,
    await renderInvoiceResponse(invoice, { mode, format })
  );
});

app.get("/api/confirmations/:recordId/metadata", async (request) => {
  const confirmation = await loadConfirmationFromAirtable({
    config,
    recordId: request.params.recordId
  });
  return {
    recordId: confirmation.recordId,
    contractNumber: confirmation.contractNumber,
    hasSheetMaterial: confirmation.hasSheetMaterial,
    defaultMode: confirmation.hasSheetMaterial ? "formato3" : "grouped"
  };
});

app.get("/api/confirmations/:recordId/:filename", async (request, reply) => {
  const filename = String(request.params.filename || "").toLowerCase();
  if (!filename.endsWith(".docx")) {
    reply.code(400);
    return {
      error: "Confirmaciones: solo se genera DOCX."
    };
  }

  const confirmation = await loadConfirmationFromAirtable({
    config,
    recordId: request.params.recordId
  });
  const mode = normalizeConfirmationMode(request.query.mode, confirmation);
  return sendRendered(
    reply,
    await renderConfirmationResponse(confirmation, { mode })
  );
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const statusCode = error.message.includes("Missing AIRTABLE_TOKEN") ? 500 : 400;
  reply.status(statusCode).send({
    error: error.message
  });
});

await app.listen({ port: config.port, host: "0.0.0.0" });

async function sendRendered(reply, rendered) {
  reply
    .type(rendered.contentType)
    .header("Content-Disposition", `attachment; filename="${rendered.filename}"`)
    .send(rendered.buffer);
}

function normalizeMode(mode) {
  return mode === "detail" ? "detail" : "grouped";
}

function normalizeFormat(format, mode) {
  if (["pdf", "xlsx", "zip"].includes(format)) return format;
  return mode === "grouped" ? "zip" : "pdf";
}

function normalizeConfirmationMode(mode, confirmation) {
  if (confirmation.hasSheetMaterial) return "formato3";
  if (mode === "detail") return "detail";
  return "grouped";
}
