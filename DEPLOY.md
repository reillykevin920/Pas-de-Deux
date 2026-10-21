# Invox — GitHub Pages setup

Invox is a static, local-first work logging and billing app. It does not require a server-side database, paid hosting, or an account system for this version.

## Publish with GitHub Pages

1. Create a GitHub repository, for example `invox`.
2. Upload **all files and folders from this package** to the repository root.
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.
6. Open the Pages address in a browser to use or demo Invox.

## Install on iPhone / iPad

1. Open the GitHub Pages address in **Safari**.
2. Open Safari's Share/Page menu and choose **Add to Home Screen**.
3. Leave **Open as Web App** enabled if iOS shows that option.
4. Launch **Invox** from the Home Screen icon.

The first visit needs internet access so the app files can load. After loading, the app shell is cached for offline use.

## What this build includes

- Clients with email, billing address, and client-level notes
- Multiple work blocks per client per day
- Overnight work blocks that span midnight (for example, 10:00 PM–6:00 AM)
- Optional mileage on any work block, either entered directly or calculated from starting/ending mileage
- Configurable default rate per mile with a per-block mileage-rate override
- Separate notes on every work block
- Hourly or fixed-price billing per service/block
- Configurable service/rate defaults with per-block overrides
- Unbilled / Invoiced / Paid work status
- Stored invoice history with automatic numbering, tax, due dates, and payment status
- Printable invoices that can be saved as PDF through the browser/OS print sheet
- Excel `.xlsx` export with Work Log, Daily Totals, Summary, and Invoices sheets, including mileage details and reimbursement totals
- Configurable business identity, currency, tax default, and invoice numbering
- JSON backup and restore

## Where records are stored

Client information, service rates, work blocks, notes, settings, and invoices are stored in the local Invox database on each device. They are **not committed to the GitHub repository** and are not sent back to GitHub.

Closing the app or restarting a device does not clear the records. However, different devices have separate databases in this local-first build; there is no live cloud synchronization yet.

Use **Billing → Save backup** periodically. The JSON backup contains the full local database and can be restored from **Billing → Restore backup** after a device change or cleared app/site data.

Excel exports are generated directly on the device and include:

- **Invox Work Log** — every selected work block, billing method, mileage method/readings, miles, rate per mile, status, invoice number, and notes
- **Invox Daily Totals** — hours, service charges, mileage, mileage reimbursement, and combined totals by client and date
- **Invox Summary** — service and mileage totals by client, service, and billing method
- **Invox Invoices** — saved invoice records with service and mileage totals in the selected billing period

## Existing Invox data

This build intentionally keeps the same IndexedDB database identifier as the earlier Invox build. When deployed at the same origin/path, existing clients, rates, and work logs are migrated forward automatically and remain available. Existing hourly blocks are treated as Hourly + Unbilled until their billing status changes. Existing records without mileage remain unchanged and are treated as having no mileage. The overnight-shift logic from v2.1 is preserved.
