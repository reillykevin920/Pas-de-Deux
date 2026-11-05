# Pas de Deux v3.2 — street group toggles and Cone Zones color control

## What changed

- **Major streets** and **Local / other streets** are now separate optional map toggles. Major streets include Principal Arterial, Minor Arterial, Collector, Expressway, Freeway and Ramp. Local / other covers Residential, Alley, Pedestrian Mall, Recreational Trail, Private, Agriculture, Unknown, Other and any newly introduced/unclassified street values.
- Each toggle requests **only its corresponding street segments from the City of Boulder Street Centerline GIS**, for the current view. Turning on Major streets does **not** download residential/local streets. Each toggled layer caches its current geographic view until the map moves outside it, and streams results in pages.
- Both toggles can be on at once; the legend displays only enabled groups with each designation's distinct color.
- **Cone Zones overlay color** is editable from the bottom-right **Map key → Cone Zones → Edit**. Choose a swatch or custom color; rendered Cone Zones points, lines and polygons change immediately. The selection persists in existing browser settings / JSON backups.
- The existing City data source, permit workflow, corridors, venue overlays, and Cone Zones feed are unchanged. The removed speed-limit layer has not been reinstated.

## Compatibility

Replace `index.html`, `app.js`, `styles.css`, and `README.md` in the existing GitHub Pages site. Versioned JavaScript/CSS links prevent mixed-browser cache versions. Existing browser-local permit and corridor records are **not overwritten**. No new services or login requirements.

## Notes

Browser tests verify group-specific requests, toggle isolation, viewport updates, map key/legend behavior, and Cone Zones color persistence with simulated ArcGIS responses. Real-time response speed depends on the City's published GIS endpoint; deployed-browser confirmation is still needed.
