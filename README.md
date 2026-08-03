# Steel Trade Invoice Service

Servicio Node para generar facturas comerciales de Steel Trade desde la tabla
`Facturas` de Airtable.

## Que genera

- `mode=grouped`: PDF agrupado por item de compra y ZIP con PDF + Excel de detalle.
- `mode=detail`: PDF con lineas a nivel existencia.
- Confirmaciones de pedido desde `Contratos de venta`: DOCX con tabla de mercancía insertada para adjuntar en
  `Documentos confirmación`.
- Cierres mensuales de existencias contables: XLSX con hoja `Resumen` y una
  hoja por Packing List, servido temporalmente para adjuntarlo en
  `Packing Lists.Cierre copias`.

## Variables necesarias

Copia `.env.example` a `.env` y rellena `AIRTABLE_TOKEN`.

```txt
AIRTABLE_TOKEN=pat_xxx
AIRTABLE_BASE_ID=appnS0geRMpHaxib9
AIRTABLE_FACTURAS_TABLE_ID=tblD7MvJnqpiqKMfm
AIRTABLE_EXISTENCIAS_TABLE_ID=tblOGE7nApPr8zTsZ
AIRTABLE_CONTRATOS_VENTA_TABLE_ID=tbly2fHo6evAFY33X
AIRTABLE_ITEMS_VENTA_TABLE_ID=tblmx0d8G49Qx29LD
AIRTABLE_ITEMS_COMPRA_TABLE_ID=tblVZncIvXViG3IvO
PORT=3000
```

## Uso local

```bash
pnpm install
pnpm sample
pnpm start
```

Endpoints:

```txt
GET /health
GET /airtable/reassignment-map#<base64url-payload>
POST /airtable/monthly-close/render
GET /api/invoices/:recordId?mode=grouped
GET /api/invoices/:recordId?mode=detail
GET /api/invoices/by-number/:invoiceNumber?mode=grouped
GET /api/confirmations/:recordId/metadata
GET /api/confirmations/:recordId/:filename.docx?mode=grouped
```

Formatos:

```txt
format=zip   agrupada por defecto, incluye PDF + XLSX
format=pdf   solo PDF
format=xlsx  solo Excel de detalle
```

Confirmaciones:

```txt
mode=grouped   formato 1 agrupado
mode=detail    formato 2 detallado
formato3       se fuerza automaticamente si hay Chapa o Chapa grande
```

Las confirmaciones devuelven un único Word. La tabla de mercancía se inserta en el `.docx`
después de `MERCANCÍA:` usando el formato de `src/templates/formatos-confirmacion.xlsx`.

El script del botón está en
`airtable-copilot/scripts/buttons/ventas/b16-crear-confirmacion.js`.
Antes de pegarlo en Airtable hay que desplegar esta versión del servicio y
poner su URL pública en `SERVICE_BASE_URL`; Airtable no puede copiar adjuntos
desde una URL local.

## Despliegue gratis

El archivo `render.yaml` esta preparado para Render Free. El arranque en frio
puede tardar unos segundos si el servicio lleva tiempo sin recibir peticiones.
En Render solo hay que configurar la variable secreta `AIRTABLE_TOKEN`.
