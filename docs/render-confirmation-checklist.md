# Render confirmation service checklist

For repository, branch, deployment and all-route checks, first follow
`docs/render-deployment-runbook.md`. This checklist adds the confirmation-specific
document and Airtable attachment verification.

Use this checklist before telling Lucas that a confirmation-document change is done.

## Production target

- Render production service: `https://steel-trade-invoice-service.onrender.com`
- Render-facing Git remote: `sta-codex`
- Render-facing repository: `https://github.com/sta-codex/serve-invoice-pdf.git`
- Production branch: `main`

Do not rely on `origin` for production confirmation-document changes unless Render has been reconfigured and verified.

## Required workflow

1. Make the code change in the local service.
2. Add or update a focused test that proves the requested visible DOCX behavior.
3. Run the confirmation tests locally.
4. Generate or download a real DOCX for a known Airtable contract, usually `STA-2026-041`.
5. Inspect the generated DOCX content, not only `/health`.
6. Commit only the intended files.
7. Push to `sta-codex HEAD:main`.
8. Re-download the DOCX from `https://steel-trade-invoice-service.onrender.com/api/confirmations/...` with a fresh cache-busting `v=` query parameter.
9. Confirm the downloaded production DOCX contains the requested visible text/layout.
10. When the user is validating through the Airtable button, inspect the actual `Contratos de venta.Documentos confirmacion` attachment saved by Airtable after the button run.
11. Download that Airtable attachment URL and confirm its DOCX content contains the requested visible text/layout.

## Done means

Do not say "hecho", "subido", or "ya esta" until the Render-served DOCX, not just local code or GitHub, has been checked after the push.

If the user says the Airtable button still shows old output, Render verification is not enough. The done check must be the DOCX attachment that Airtable actually saved in `Documentos confirmacion`.

For Airtable button behavior, the expected final check is: if Lucas presses `Crear confirmacion`, the attachment added to `Documentos confirmacion` should match the Render-served DOCX verified above.
