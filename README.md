# Sundance ROW Map — Boulder

Single-station first build for visualizing City of Boulder ROW permit activity against the 2027 Sundance Film Festival venue footprint and manually defined operational corridors.

## Core behavior

- Static browser app; no City login, ArcGIS license, or internal API is required.
- Basemap: OpenStreetMap tiles.
- Permit location matching: City of Boulder public Address Points ArcGIS REST service.
- Sundance building highlighting: City of Boulder public Building Footprints ArcGIS REST service.
- Permit files are **never opened, parsed, previewed, uploaded, or attached**. The importer uses filenames only.
- Expected filename structure: `address# - street - work type - contractor.pdf`.
- Filename-derived values are stored **verbatim**. The UI may improve capitalization for readability, but source values and the original filename remain unchanged.
- Existing permit metadata is retained on subsequent scans. Re-scanning a folder never reopens a closed permit or overwrites notes/status/dates.
- Missing files are not interpreted as deleted permits.

## Permit metadata

Filename-derived / read-only:

- Address number
- Street
- Work type
- Contractor
- Original filename

Editable:

- Permit #
- Status: Application / Upcoming / Active / Closed / Archived
- Start date
- End date
- ROW impact
- Notes

Closed permits are hidden by default but remain in the dataset. Archived permits are also hidden by default. Permanent delete is a separate explicit action.

## Import methods

### Connect permit folder

In Chromium-based browsers on HTTPS (for example GitHub Pages), `Connect permit folder` uses the File System Access API. The scan enumerates filenames recursively. It intentionally does not call `getFile()` on permit files.

The selected folder handle is retained in IndexedDB when the browser allows it. The user may need to re-authorize folder access after a restart/browser policy change.

### Drag and drop / Import filenames

Folders or PDFs can be dragged onto the map. Direct file selection is also available. Only the file metadata/name is used; PDF bytes are not read.

## Corridors

Use `Draw corridor` to click out a route. Each corridor has:

- Name
- Primary / Secondary priority
- Context buffer in feet
- Notes

The context buffer is a visual/spatial aid and can be used by the `Only permits near a corridor` filter. It is **not** an automated ROW-impact determination.

Corridor geometry can be reshaped from the Corridors list.

## Sundance layers

The app resolves official 2027 venue sites against Boulder public address data and attempts to highlight the corresponding City building footprint. Venue markers remain the primary reference if a footprint cannot be resolved.

A toggleable 500-ft venue context layer and `Only permits near a Sundance venue` filter are included as spatial aids only.

## Filters

- Text search
- Permit status
- Date-range intersection
- One-click Sundance window (Jan 21–31, 2027)
- Exact-source work type values
- Exact-source contractor values
- Near manually drawn corridor
- Near Sundance venue
- Hide closed
- Hide archived

Work type and contractor dropdown values preserve the exact source values internally even when display capitalization is improved.

## Local persistence / backup

The first build stores permit records and corridors in browser `localStorage`.

Use:

- `Export backup` for a complete JSON backup.
- `Import backup` to restore/transfer a workstation dataset.
- `Export permit CSV` for a flat permit table.

The storage boundary is intentionally small (`loadState()` / `saveState()` in `app.js`) so the later shared permit-tech version can replace local persistence with a shared backend without rebuilding the map, parser, filters, corridor editor, or permit UI.

## Deployment

This is a static site. Upload these files to a GitHub repository:

- `index.html`
- `styles.css`
- `app.js`

Then enable GitHub Pages for the repository. HTTPS is recommended and is required for the best folder-connection behavior.

No build command is required.

## External runtime dependencies

Loaded from public CDNs:

- Leaflet 1.9.4
- Leaflet.draw 1.0.4
- Leaflet.markercluster 1.5.3
- Turf 7

The map and Boulder GIS lookups require network access. Offline behavior was intentionally not included in this build.
