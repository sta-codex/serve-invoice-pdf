# Render production deployment runbook

This file is authoritative for every change to invoices, sales confirmations,
own delivery notes, or any other endpoint served by Steel Trade Render.

## Canonical production target

- Render service: `steel-trade-invoice-service`
- Public URL: `https://steel-trade-invoice-service.onrender.com`
- GitHub repository: `sta-codex/serve-invoice-pdf`
- Git remote: `sta-codex`
- Production branch: `main`
- Blueprint file: root `render.yaml`
- Automatic deployment: every commit pushed to `main`

`origin` (`lucasague/steel-trade`) and the historical branch
`codex/add-sales-confirmation-render` are not production targets.

## Permanent configuration

The service definition in `render.yaml` must always include the explicit
`repo`, `branch: main`, and `autoDeployTrigger: commit` values. Do not remove
them. Render's **Deploy latest commit** deploys the latest commit of the branch
currently linked in Render, which is not necessarily the repository's default
branch.

Before claiming that a change is deployed, verify in Render or its deploy log
that the service is linked to `main` and that the deployed commit matches
`sta-codex/main`.

## Required workflow for every production change

1. Confirm the intended files and preserve unrelated local changes.
2. Run focused tests for the changed endpoint or document.
3. Commit only the intended files.
4. Push the production commit to `sta-codex HEAD:main`.
5. Confirm `git ls-remote sta-codex refs/heads/main` returns that commit.
6. Wait for Render's automatic deployment and verify `/health` reports
   repository `sta-codex/serve-invoice-pdf`, branch `main`, and the same commit.
7. Verify `/health` and the changed functional endpoint on the public URL,
   using a known real Airtable record. A fake record only proves route wiring
   and does not detect stale or mistyped Airtable field IDs.
8. If Airtable stores an attachment, run the Airtable button and inspect the
   attachment that Airtable actually saved.

Never report a production change as complete based only on a Git push or a
successful `/health` response.

The `/health` response intentionally exposes only Render's non-secret
deployment identity (`RENDER_GIT_REPO_SLUG`, `RENDER_GIT_BRANCH`, and
`RENDER_GIT_COMMIT`) so branch drift is machine-verifiable.

## Functional routes currently served

- Invoices: `/api/invoices/:recordId`
- Sales confirmations: `/api/confirmations/:recordId/...`
- Own delivery notes: `/api/delivery-notes/:recordId/own-delivery-notes/...`

## Historical branch mismatch recovery

On 2026-07-21 Render was still linked to
`codex/add-sales-confirmation-render`, so **Deploy latest commit** repeatedly
deployed `02f2168` even though newer code was on `main`. The durable fix is to
sync the Blueprint so the service shows `main`, not to keep publishing future
changes to the historical branch.

If Render still displays the historical branch after the Blueprint commit:

1. Open the Blueprint in Render and run a manual sync/deploy of the Blueprint.
2. Confirm the proposed service change is branch `main`.
3. Apply it and verify the service header now shows `main`.
4. From then on, publish only to `sta-codex/main`.
