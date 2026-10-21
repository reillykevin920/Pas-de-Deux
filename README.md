# Pas de Deux — v2.6.0

Interactive Boulder event/permit coordination map. Single-workstation/local-browser build; future shared permit-tech deployment will require authenticated shared storage.

## Changes in this release

- **Visible permanent delete:** **Clear all permits** now sits immediately under the permit totals, not hidden inside the Data dropdown. It opens a confirmation showing how many local permit records will be deleted. You must enter `CLEAR` to confirm; Cancel and the dialog close button leave everything intact. This removes **all permits**, including hidden, closed, archived, filtered-out, and unlocated records. It does **not** affect venues, corridors, Cone Zones or map appearance. A backup button is available in the confirmation dialog.
- **Disconnects the permit folder after clearing:** Clearing also removes the saved folder handle (read-only connection) so the next import is deliberate. A newly connected/synced folder will re-import filenames; deleted notes, assessments and edited coordinates are recoverable only from backup. No PDF contents are ever opened by Pas de Deux.
- **500-ft venue context is now conspicuous** at useful zoom levels: a 3-pixel solid outline and stronger translucent fill, rather than the old nearly invisible dashed outline.
- **Map key customization:** Click **500-ft venue context → Edit** inside the map key to set its color and fill strength (10–50%). Changes apply immediately and are saved along with the rest of the app appearance. The buffer's **500-ft physical radius stays constant** and never assigns impact to a permit.
- **Retains v2.5.1 map layout and Light/Dark choices**, permit/Sundance category marker customization, verified 12-site Sundance venue markers, street-aware corridors, and City Cone Zones reference features.
- Versioned assets (`app.js?v=2.6.0`, `styles.css?v=2.6.0`) ensure this HTML points to the matching release after deployment.

## Existing behavior preserved

- Permits are imported from **filenames only**. PDF contents are not opened, parsed, uploaded, attached, or indexed. Original filenames and each source field are stored verbatim; display formatting does not change records. Repeated imports preserve annotations for existing filenames.
- Connect a permit folder, resync, use file/folder import, or drag and drop; manually correct or retry address matches in the location-review panel.
- Permits have editable permit number, In Review / Upcoming / Active / Closed status, dates, notes, staff-entered impact assessments, and optional pin appearance overrides. New imported permits default to In Review. Dates do not trigger automatic operational impact judgments.
- Designate and edit street-aware or custom corridors with Cancel and Esc. Corridor proximity is contextual; impact decisions remain staff decisions.
- Toggle City of Boulder public Cone Zones features and their exposed project descriptions/attributes without mixing them into local permit records.
- JSON export/import backup and CSV export. Clear all permits removes all locally saved permits/annotations and **disconnects the selected import folder**, while retaining corridors, venue/site markers and appearance settings. Re-importing cleared filename records cannot restore the deleted annotations without a backup.

## Deployment — GitHub Pages / Cloudflare Pages

1. **Before upgrading, use Data → Export backup on the existing working app.** Keep the JSON file somewhere safe.
2. Replace the four files at the root of the existing repository: `index.html`, `app.js`, `styles.css`, and `README.md`. Commit/publish using your current workflow. No Node, local build step, or API key required.
3. Open the **same hosted URL** in the **same browser/profile** to retain local permits/corridors. Do not change hostname/origin. After publishing, force refresh once on Mac with **Cmd + Shift + R** if an old page is still cached.
4. Confirm you see Sundance sites immediately, that **Focus on festival sites** zooms to all 12, that Light and Dark visibly switch the sidebar/background/map tiles, and that clicking the Permits, Sundance sites, or 500-ft venue context rows in the Map key changes their respective appearance.
5. Toggle Cone Zones to confirm the public City service is available from your network. Existing annotations and corridors should remain intact.

## Sources and limitations

- [2027 Sundance official venue roster](https://www.sundance.org/blogs/2027-sundance-film-festival-to-take-place-january-21-31-in-boulder-colorado/)
- [SundanceBoCo venue map](https://sundanceboco.com/venues) — independent/unofficial cross-reference
- Basemap: [OpenStreetMap](https://www.openstreetmap.org), publicly served tiles with OSM attribution.
- Building footprints, address resolution, street centerlines: City's public ArcGIS REST services. External datasets and the City's public Cone Zones map may temporarily be unavailable. Venue pins are no longer dependent on those background GIS calls.

**Testing:** The page's real JavaScript/CSS was exercised in a browser using local stand-ins for external mapping libraries/services (checking theme switching, appearance editing, 12-venue initialization, and no startup errors). Regression checks cover the 16 sample permit *filenames* and in-browser confirmation/cancel/clear flows, including archived, hidden and unlocated records and corridor preservation. A complete live hosted-browser test against the real Boulder GIS, basemap, and Cone Zones endpoints must still be performed after publishing.
