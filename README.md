# Pas de Deux — v2.5.1

Interactive Boulder event/permit coordination map. Single-workstation/local-browser build; future shared permit-tech deployment will require authenticated shared storage.

## Changes in this release

- Complete visual restyle to a restrained, map-first municipal operations interface. More legible typography, clearer hierarchy, and much less sidebar clutter.
- **Working Light / Dark toggle** in the header (no System option). Dark mode uses a readable slate UI and gently dims the public OSM tiles rather than inverting them to near-black. No map API key.
- **Appearance editing now lives in the map key**, not the sidebar. Click **Permits → Edit** or **Sundance sites → Edit** to choose the *category default* color, circle / square / diamond / map pin, and size. Defaults are stored locally with the other app data. Optional permit-specific overrides remain in the permit editor. Permit color can optionally be grouped by status; choose **One color** to use a single default color for all permits. Source permit data is never changed by appearance settings.
- **Venue markers are available at map initialization**, from the verified site inventory. The slow public Boulder GIS building-footprint enrichment now runs asynchronously and cannot prevent the **12 physical Sundance site markers** from rendering. The 12 sites represent 15 official venue/programming entries, including multiple programming spaces at the Dairy and eTown. Chautauqua Auditorium appears at 100 Morning Glory Drive. Click **Focus on festival sites** in the left panel to locate all markers quickly.
- HTML now includes versioned `app.js?v=2.5.1` and `styles.css?v=2.5.1` references to reduce the chance of mismatching a newly published HTML page with old cached app assets.
- Existing **Needs location review**, **Clear all permits** (explicit `CLEAR` confirmation), and **Cone Zones** remain available.

## Existing behavior preserved

- Permits are imported from **filenames only**. PDF contents are not opened, parsed, uploaded, attached, or indexed. Original filenames and each source field are stored verbatim; display formatting does not change records. Repeated imports preserve annotations for existing filenames.
- Connect a permit folder, resync, use file/folder import, or drag and drop; manually correct or retry address matches in the location-review panel.
- Permits have editable permit number, In Review / Upcoming / Active / Closed status, dates, notes, staff-entered impact assessments, and optional pin appearance overrides. New imported permits default to In Review. Dates do not trigger automatic operational impact judgments.
- Designate and edit street-aware or custom corridors with Cancel and Esc. Corridor proximity is contextual; impact decisions remain staff decisions.
- Toggle City of Boulder public Cone Zones features and their exposed project descriptions/attributes without mixing them into local permit records.
- JSON export/import backup and CSV export. Clear all permits deletes only the locally saved permits/annotations — **not** corridors, venue/site markers, appearance settings, or the folder permission handle. Re-importing cleared filename records cannot restore the deleted annotations without a backup.

## Deployment — GitHub Pages / Cloudflare Pages

1. **Before upgrading, use Data → Export backup on the existing working app.** Keep the JSON file somewhere safe.
2. Replace the four files at the root of the existing repository: `index.html`, `app.js`, `styles.css`, and `README.md`. Commit/publish using your current workflow. No Node, local build step, or API key required.
3. Open the **same hosted URL** in the **same browser/profile** to retain local permits/corridors. Do not change hostname/origin. After publishing, force refresh once on Mac with **Cmd + Shift + R** if an old page is still cached.
4. Confirm you see Sundance sites immediately, that **Focus on festival sites** zooms to all 12, that Light and Dark visibly switch the sidebar/background/map tiles, and that clicking either category in the Map key edits its default marker appearance.
5. Toggle Cone Zones to confirm the public City service is available from your network. Existing annotations and corridors should remain intact.

## Sources and limitations

- [2027 Sundance official venue roster](https://www.sundance.org/blogs/2027-sundance-film-festival-to-take-place-january-21-31-in-boulder-colorado/)
- [SundanceBoCo venue map](https://sundanceboco.com/venues) — independent/unofficial cross-reference
- Basemap: [OpenStreetMap](https://www.openstreetmap.org), publicly served tiles with OSM attribution.
- Building footprints, address resolution, street centerlines: City's public ArcGIS REST services. External datasets and the City's public Cone Zones map may temporarily be unavailable. Venue pins are no longer dependent on those background GIS calls.

**Testing:** The page's real JavaScript/CSS was exercised in a browser using local stand-ins for external mapping libraries/services (checking theme switching, appearance editing, 12-venue initialization, and no startup errors). Unit tests covered 16 sample permit *filenames*, state migration, category defaults and permit clearing. A complete live hosted-browser test against the real Boulder GIS, basemap, and Cone Zones endpoints must still be performed after publishing.
