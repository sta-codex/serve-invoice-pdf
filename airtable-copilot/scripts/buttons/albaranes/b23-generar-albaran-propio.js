/************************************************************
 * BOTÓN EN TABLA "Albaranes": Generar albarán propio
 *
 * Genera un PDF por cliente, adjunta todos al mismo albarán
 * y escribe sus IDs separados por ", ".
 ************************************************************/
const CFG = {
  serviceBaseUrl: "https://steel-trade-invoice-service.onrender.com",
  table: "Albaranes",
  fields: { ids: "Albarán propio ID", pdf: "Albarán propio PDF" }
};

const table = base.getTable(CFG.table);
const idField = table.getField(CFG.fields.ids);
const pdfField = table.getField(CFG.fields.pdf);
if (pdfField.type !== "multipleAttachments") throw new Error('"Albarán propio PDF" debe ser un campo de adjuntos.');

const record = await input.recordAsync("Selecciona el albarán", table, { fields: [idField, pdfField] });
if (!record) {
  output.text("Operación cancelada.");
} else {
const baseUrl = String(CFG.serviceBaseUrl).replace(/\/+$/, "");
const planUrl = `${baseUrl}/api/delivery-notes/${record.id}/own-delivery-notes/plan?v=${Date.now()}`;
output.text("Preparando albaranes propios...");
const response = await fetch(planUrl);
if (!response.ok) throw new Error(`El servicio no pudo preparar los albaranes (${response.status}). ${await response.text()}`);
const plan = await response.json();
if (!Array.isArray(plan.groups) || !plan.groups.length) throw new Error("No hay clientes con existencias válidas en este albarán.");

const answer = await input.buttonsAsync(
  `Se generarán ${plan.groups.length} PDF(s), uno por cliente.`,
  [{ label: "Generar", value: "generate" }, { label: "Cancelar", value: "cancel" }]
);
if (answer !== "generate") {
  output.text("Operación cancelada.");
} else {
const files = plan.groups.map(group => ({
  url: `${baseUrl}/api/delivery-notes/${record.id}/own-delivery-notes/${encodeURIComponent(group.id)}.pdf?v=${Date.now()}`,
  filename: `${group.id}.pdf`
}));
await table.updateRecordAsync(record.id, {
  [idField.name]: plan.groups.map(group => group.id).join(", "),
  [pdfField.name]: files
});
output.markdown(["### Albaranes propios generados", "", ...plan.groups.map(group => `- ${group.id}: ${group.customer.commercialName} (${group.count} existencias)`)].join("\n"));
}
}
