# Pas de Deux

A map-first coordination tool for the 2027 Sundance Film Festival in Boulder and City permit activity.

## What v2.2 does

- Interactive Boulder map with Sundance venue sites and venue building footprints.
- Toggleable **Cone Zones** reference layer sourced at runtime from the City of Boulder public Cone Zones ArcGIS experience. It is never copied into or merged with local permit records.
- Imports permit **filenames only** from a connected folder, folder upload, or drag/drop.
- Never opens, parses, previews, uploads, or attaches permit PDFs.
- Preserves the source filename and filename-derived values exactly as written.
- Uses presentation-only capitalization cleanup for readability.
- Locates permit pins with City of Boulder public Address Points.
- Editable permit fields: Permit #, Status, Start date, End date, Impact assessment, Notes.
- Permit statuses: Upcoming, Active, Closed.
- Archive is a separate record state; closed/archived records can be hidden without deleting them.
- Sundance-window, status, date, work type, contractor, corridor, venue, and text filters.
- JSON backup/restore and CSV export.

## Corridors

The primary corridor workflow uses City of Boulder public street-centerline data:

1. Click **Add** under Corridors.
2. Choose **Select street**.
3. Click the street on the map.
4. Choose either:
   - **Entire street** — every matching City centerline segment; or
   - **Select a section** — click two endpoints and Pas de Deux keeps the selected street geometry within that section.
5. Add corridor name, priority, context buffer, and notes.

The corridor layer provides geographic context only. Pas de Deux does not decide whether a permit actually impacts Sundance operations.

**Draw custom route** remains available for routes that do not follow a single street.

Every corridor-selection mode can be cancelled with the visible **Cancel** button or the **Esc** key. Cancelling does not create a corridor.

## Existing v1 data

v2 intentionally keeps the original browser storage key so existing local data survives the upgrade.

- old `Application` status → `Upcoming`
- old `Archived` status → `Closed` + archived record state
- old hand-drawn corridor geometry is migrated into the v2 corridor format

## Run / deploy

These four files are the complete app:

- `index.html`
- `app.js`
- `styles.css`
- `README.md`

For GitHub Pages, place the first three files at the repository root (README can remain there too), commit, push, and publish the branch through **Settings → Pages**.

Folder connection uses the browser File System Access API and is best supported in Chromium browsers such as Chrome and Edge. Import filenames and drag/drop remain available as fallbacks.

## Public data services

Pas de Deux requests public data directly in the browser:

- City of Boulder Address Points
- City of Boulder Building Footprints
- City of Boulder Street Centerlines (`StreetsSimple`)
- OpenStreetMap standard basemap tiles (no API key)
- City of Boulder public Cone Zones ArcGIS experience/web map (loaded only when the Cone Zones layer is toggled on)

No City authentication, internal system connection, or basemap API key is required for these map/reference layers.

The Cone Zones integration discovers the operational web map behind the City's public Experience at runtime, then requests its public construction/travel-impact feature geometry. This avoids baking a stale copy of Cone Zones into Pas de Deux. If the City changes the public ArcGIS configuration or temporarily blocks a layer, Pas de Deux reports the Cone Zones layer as unavailable without affecting local permit data.
