# Pas de Deux v3.4 — Address pins + Excel/CSV intake

## What's new

### 1. Add Location (address first)

Select **+ Add location**, choose **Permit, Application, or Venue**, then enter a numbered Boulder street address and click **Find on City map**. The app searches the City's public address-point GIS layer, displays the suggested match, and requires you to confirm it before saving. Add a title/name for venues. If the match is unavailable or inappropriate, **Place pin myself** can be used *after attempting the address search*; location review remains available for uncertain records. New locations, notes, and edits stay on the local workstation.

### 2. Import Excel or CSV

Select **Import Excel / CSV** in the inventory section and choose an `.xlsx`, `.xls`, or `.csv` file. A **preview** lets you map spreadsheet columns to addresses, permit/application numbers, venue names, work types, contractor, status, dates, and notes. The import dialog also contains **three independent checkboxes** controlling which types of pins will be created: **Permits**, **Applications**, and **Venues**. If the spreadsheet has a *Record Type* (or *Record Category*) column, map it to *Pin category* to handle a mixed file; otherwise choose one default type at the top of the dialog. The preview shows how many rows will be included.

Each selected, address-bearing row becomes a local pin, located through Boulder's public GIS address lookup. Unmatched/ambiguous addresses are retained in **Needs location review**; no guesses are plotted. Rows without a usable numbered street address are skipped and counted in the preview. Records with a permit/application number are recognized on later imports, preventing duplicate records while retaining local notes and manual edits. Rows without an ID are matched by exact source row content and original file name; revised rows without a stable identifier can appear as new records.

All spreadsheet files are read inside the browser. Spreadsheet contents are **not uploaded to a dedicated server**. The app sends only address lookup requests to the public City GIS service. Excel reading uses the SheetJS JavaScript library loaded from the jsDelivr CDN, requiring network access. CSV reading is built into Pas de Deux and doesn't require that library.

### 3. Show or hide pin categories separately

The Map Layers controls now include independent **Permits**, **Applications**, and **Added venues** toggles. Added venues are separate from the existing static Sundance venue layer. Default icons distinguish records: ordinary permit pins, purple-diamond applications, and gold-circle added venues. All types can be inspected and edited with the existing record editor.

### 4. Existing features remain

PDF filename-only intake, connected folder sync, street classifications, Cone Zones, corridors, focus areas, annotations, opacity controls, filters, local backups, and the original verified Sundance sites remain intact. Export CSV now includes record type and title. JSON backup continues to include all records and settings.

## Deploy

1. Export a JSON backup of your current v3.3 records before updating.
2. Upload **all four files** in this ZIP (`index.html`, `app.js`, `styles.css`, `README.md`) to the same GitHub Pages repository and path.
3. Reload the site. Existing saved records should remain on the same URL and browser profile. If you change to a custom subdomain, export a JSON backup at the old URL and import it at the new URL because browser storage is separated by origin.

## Testing and limitations

- JavaScript syntax was checked, and the application was exercised in an automated browser with simulated GIS responses for manual address matching, mixed CSV import, type selection, pin filtering, and persistence.
- **Live Boulder GIS response times and Excel library delivery in the deployed site have not been verified in this test environment.** The release should be checked using a small, non-sensitive test export before importing real operational data.
- No EnerGov connection or live record synchronization exists. An Excel/CSV upload makes a local snapshot based on your exported file; re-import to refresh it.
- Records are stored in browser localStorage; this is not a shared, secure City system or authoritative EnerGov record store. Do not put confidential records in a publicly accessible/shared browser environment.
