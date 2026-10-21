# Pas de Deux — v2.4

A single-workstation, map-first construction/event coordination tool for the 2027 Sundance Film Festival in Boulder. Designed for extension to other city events. **This version is not a synchronized, authenticated multi-user application.**

## What's new in v2.4

- **Pin appearance** in the sidebar: color by status (default) or one high-contrast color, a color palette/custom hex color, circle / square / diamond / map pin, and three sizes. Per-permit optional pin color/shape overrides in the record editor. **No imported filename/source data is altered.**
- **Clear all permits** under Data: explicit `CLEAR` confirmation, optional JSON backup first. It removes every local permit and its annotations, including archived/closed permits, but **preserves corridors, appearance, Cone Zones, festival venues and the connected folder handle**. If you sync that folder again, filenames will be imported again; annotations previously cleared will not be restored without a backup.
- **Sundance 2027 venue inventory** reviewed against the [SundanceBoCo venues map](https://sundanceboco.com/venues) and the [official Sundance Institute announcement](https://www.sundance.org/blogs/2027-sundance-film-festival-to-take-place-january-21-31-in-boulder-colorado/). The 15 official screening/programming entries correspond to **12 physical sites** (e.g. two theaters + programming at the Dairy, and both screenings and programming at eTown). Crucially, Chautauqua Auditorium now uses **100 Morning Glory Drive**, not 900 Baseline; Old Main uses **1600 Pleasant St**. If a City public GIS address/building lookup cannot confidently locate a venue, it is **listed as unresolved**, not silently plotted at a guess. Only confident building-footprint matches are highlighted.
- **Light / Dark / System** theme. Dark mode re-tones *the existing public OpenStreetMap tiles locally*, so no new map provider or API key is required. It does not modify or upload any map/permit data.
- **Dynamic collapsible map legend** updates to match the selected pin color/shape.
- **Needs Location Review** panel includes unmatched, ambiguous (two plausible geographic matches), GIS-unavailable, and staff-flagged records. Source filename and reason are displayed; retry matching, manual placement, or open/edit a permit. Manual placement has visible **Cancel** and `Esc` exit. Bulk retry excludes already placed records to protect deliberate manual locations.
- Freshly imported permits default to **In Review** (because the mere presence of a PDF does not establish that work is upcoming). Existing Upcoming / Active / Closed statuses are left intact. Archived remains separate.
- The date-range map filtering controls were removed, because planned permit dates do not reliably reflect work in the field. Dates remain editable as reference metadata on each record.

## Preserved from v2.3

- Public OSM basemap, Boulder public GIS address points, street geometry, and building footprints.
- Public City of Boulder **Cone Zones** contextual layer, toggleable with enhanced project-detail popups. Cone Zones data never overwrites or mixes with local permits.
- File System Access API permit-folder connection and sync, folder/PDF name imports, and drag-and-drop fallback.
- **Only filenames are accessed. PDF bytes are never read, parsed, uploaded, attached, opened or indexed.** The four filename fields and full original filename remain **verbatim** in local records. Display formatting is presentation-only.
- Edit permit # / status / date / notes / ROW-impact assessment; archived/closed toggles; filters and status management.
- Corridor street selection, whole street or segment, custom-draw fallback, priority and buffers. All corridor selection modes have visible Cancel / Esc.
- JSON backups and CSV export.
- Same `localStorage` key as v1/v2.3, so upgrading the hosted site **should preserve current browser data** when origin/host is unchanged.

## Deploy (GitHub Pages / Cloudflare Pages)

Replace the existing four repo-root files with the four in this ZIP:

1. `index.html`
2. `app.js`
3. `styles.css`
4. `README.md`

Commit and publish using the existing static-site setup. **Do not change the host/domain** if you need access to the same existing browser-local permit data. Before replacing files, export a JSON backup from v2.3 (recommended). A browser refresh may be necessary for updated CSS/JS; a hard refresh (`Ctrl+Shift+R` or `Cmd+Shift+R`) removes an old cached app version without clearing local permit records.

For folder sync, Edge/Chrome Chromium-based browsers support folder access; drag/drop and folder-picker import remain available as fallbacks. The application does not need a City login, City IT privileges, or a map API key for its public data layers.

## Known operational boundaries

- **Single station / browser storage only.** Opening the URL on a second computer will not automatically share imported permits, saved corridors, or annotations. Shared deployment will require a backend, authentication, and appropriate City approval for non-public records.
- City GIS and the public Cone Zones Experience are external services. They can be unavailable or change their exposed schema; the tool distinguishes unmatched locations and service errors for permits, and reports unresolved venue locations.
- The location panel is not a professional land-survey/geocoder certification. Verify spatial assessments and operational impacts as appropriate. No automatic claim of ROW impact is made.
- Dark tiles are CSS-adapted OpenStreetMap imagery, not a separate officially designed dark cartography product. The standard OSM tiles and relevant attribution remain intact.

## Venue reference

Official location inventory: Boulder Theater; Boulder High School Auditorium; Casey Middle School Auditorium; Chautauqua Auditorium; Cinemark Century Boulder; eTown Hall; Dairy Arts Center (Boedecker + Gordon Gamm + programming); Macky Auditorium; Muenzinger Auditorium; Roe Green Theatre (University Theatre); Old Main; Canyon Theater at Boulder Public Library. The app uses verified published site addresses or publicly identifiable City building names. Any site lacking a confident map lookup stays explicitly marked unresolved rather than inventing coordinates.
