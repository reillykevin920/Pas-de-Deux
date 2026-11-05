# Pas de Deux v2.9 — Street classification performance fix

**What changed**

- Removed the Speed limits layer completely.
- Street classifications now query only the currently viewed area instead of downloading the whole Boulder road network.
- Arterials and collectors draw first; local streets follow progressively. When the map is moved to an area outside the previously fetched coverage, it loads that area on demand.
- Fixed a bug that caused the classification layer to disappear during other map updates until the entire download finished.
- Preserved the City's published classification colors, categories and clickable street information.
- Added a 15-second timeout to GIS requests (in browsers supporting `AbortSignal.any/timeout`) and clear error messages.
- At zoom levels wider than 12, zoom in to fetch classification streets rather than overloading the application.

**Unchanged:** City Cone Zones, permits, venues, corridor editing, local storage and existing appearance settings.

**Public GIS source:** https://services2.arcgis.com/AB4o41cT2GQ69z4k/ArcGIS/rest/services/RoadCharacteristics_1/FeatureServer/2

**Testing:** JavaScript syntax and browser interaction tests passed with simulated public GIS responses, including toggling, panning, colors, and persistence during re-renders. Live retrieval speed from Boulder's GIS endpoint cannot be verified from the build environment and should be checked in the deployed browser.

## Existing behavior preserved

- Permits are imported from **filenames only**. PDF contents are not opened, parsed, uploaded, attached, or indexed. Original filenames and each source field are stored verbatim; display formatting does not change records. Repeated imports preserve annotations for existing filenames.
- Connect a permit folder, resync, use file/folder import, or drag and drop; manually correct or retry address matches in the location-review panel.
- Permits have editable permit number, In Review / Upcoming / Active / Closed status, dates, notes, staff-entered impact assessments, and optional pin appearance overrides. New imported permits default to In Review. Dates do not trigger automatic operational impact judgments.
- Designate and edit street-aware or custom corridors with Cancel and Esc. Corridor proximity is contextual; impact decisions remain staff decisions.
- Toggle City of Boulder public Cone Zones features and their exposed project descriptions/attributes without mixing them into local permit records.
- JSON export/import backup and CSV export. Clear all permits removes all locally saved permits/annotations and **disconnects the selected import folder**, while retaining corridors, venue/site markers and appearance settings. Re-importing cleared filename records cannot restore the deleted annotations without a backup.

## Deployment — GitHub Pages / Cloudflare Pages

1. Export a JSON backup from the currently deployed app before updating.
2. Replace the four root repository files (`index.html`, `app.js`, `styles.css`, `README.md`) and commit.
3. Open your existing URL in your existing browser profile to retain local permit/corridor records.
4. Toggle **Street classifications** and confirm the map draws arterials/collectors followed by local streets. Pan to a new area to verify loading there.
5. If your browser shows an old release, force-refresh with Cmd + Shift + R.

