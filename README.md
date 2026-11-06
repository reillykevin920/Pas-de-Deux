# Pas de Deux v3.3 — manual permits, focus areas, and map appearance

## What's new

- **Add permit / proposed work** creates a permit record before a PDF is issued. Enter a street address, search Boulder's public address points and confirm the match, or place a pin yourself. You can also save the record without a location and place it later. Existing filename-only permit import is preserved. When a filename matches a single manual record, the app asks before linking it, retaining existing notes and location.
- **Map key opacity controls** are available for permits, Sundance venues, venue buildings, the 500-foot venue context, corridors, Cone Zones, focus areas, major streets, and local/other streets. Adjustments save in the same browser and in JSON backups.
- **Cone Zones and designated corridors** now use wider translucent highlights rather than opaque hairline strokes. Colors and opacity are adjustable independently; default opacity is 50%. Highlights show published lines and geometries, not authoritative impact widths.
- **Street-classification popups** display the City street name and classification. Individual street segments can be assigned editable local notes, saved in browser storage.
- **Focus areas** can be drawn as circles or polygons, named, annotated, edited, deleted, and shown/hidden as their own map layer. Color and opacity are customizable.
- **JSON backups** now include focus areas, street notes, and appearance settings. Existing local permit and corridor records remain compatible.

## Deployment

Replace only the four files `index.html`, `app.js`, `styles.css`, and `README.md` in the existing GitHub Pages repository. Keep the **same origin** (domain/subdomain and scheme) and browser profile if you want the existing local records to remain visible. Moving to a different URL or subdomain changes the browser's local-storage origin; export a backup from the old site and import it on the new one.

The app does not read or upload imported PDFs; filename-based import remains intact. Public map tiles and Boulder GIS services require an internet connection. No dedicated backend or City-network access is required for the current configuration.

## Verification

Automated browser tests using simulated City GIS responses exercised manual records (including address confirmation and manual placement), focus circle creation and persistence, street segment notes, color selection and opacity, and the major-street layer. JavaScript syntax checks passed. The production City GIS services and real map drawing interactions must still be checked in a deployed browser.
