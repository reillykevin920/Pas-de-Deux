# Pas de Deux v3.0 — Boulder street-classification source corrected

**Important correction:** v2.7–v2.9 mistakenly connected the classification overlay to a Maryland road service. That source had no street segments in Boulder. v3.0 removes it entirely.

- Street classifications now come from the **City of Boulder Street Centerline GIS** service (the same service used by Pas de Deux to select a street when constructing corridors): `https://gis.bouldercolorado.gov/ags_svr3/rest/services/trans/StreetsSimple/MapServer/0`.
- The actual `STREETCLASS` values from the City are displayed, with distinct color-coded line styles and a complete legend. Colors are **Pas de Deux visualization styles**, not an unverified claim to exactly reproduce the styling of the City's ArcGIS Experience website.
- The toggle fetches features near the current map area. Important road types (arterials, collectors, freeways, ramps) arrive first; the remaining streets load after.
- Speed limit overlay remains removed, per request.
- Permits, editable corridors, Cone Zones, venues, and locally stored permit data are unchanged.

## Validation
Checked the actual Boulder GIS service's public metadata, including fields `STREETCLASS`, `STREETNAME`, `PREDIR`, and `OBJECTID`, its spatial coverage and supported GeoJSON query format. JavaScript syntax and local browser behavior tests were performed. Live GIS requests can't be executed in this build environment; deployed-browser confirmation remains necessary.

## GIS data source
`https://gis.bouldercolorado.gov/ags_svr3/rest/services/trans/StreetsSimple/MapServer/0/query`

