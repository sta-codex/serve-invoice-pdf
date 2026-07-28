export function getConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    airtable: {
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID || "appnS0geRMpHaxib9",
      tables: {
        facturas: env.AIRTABLE_FACTURAS_TABLE_ID || "tblD7MvJnqpiqKMfm",
        existencias: env.AIRTABLE_EXISTENCIAS_TABLE_ID || "tblOGE7nApPr8zTsZ",
        salesContracts:
          env.AIRTABLE_CONTRATOS_VENTA_TABLE_ID || "tbly2fHo6evAFY33X",
        downPayments:
          env.AIRTABLE_ANTICIPOS_TABLE_ID || "tblqUBpBzyfhGIRnD",
        saleItems: env.AIRTABLE_ITEMS_VENTA_TABLE_ID || "tblmx0d8G49Qx29LD",
        purchaseItems: env.AIRTABLE_ITEMS_COMPRA_TABLE_ID || "tblVZncIvXViG3IvO"
      }
    },
    company: {
      legalLine:
        "R.M. de Madrid, Tomo 37.401 - Folio 178 - Seccion 8 - Hoja M-666796 - Inscripcion 1",
      name: "Steel Trade Advisors, S.L.U.",
      address: "C/ Almirante, n\u00ba 22, 5A",
      city: "28004 Madrid, Espa\u00f1a",
      phone: "+34 91 068 82 77",
      taxId: "CIF: B88047790",
      bank: "CAIXA BANK: ES40 2100 6428 2213 0012 3884"
    }
  };
}
