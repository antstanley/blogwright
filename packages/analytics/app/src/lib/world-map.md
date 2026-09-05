# World map source

`world-map.ts` contains Natural Earth 1:110m Admin 0 country geometry, downloaded
2026-09-05 from:
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson

Source SHA-256: `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`.

Natural Earth data is public domain:
https://www.naturalearthdata.com/about/terms-of-use/

The source's geometry is unchanged. Only `ISO_A2_EH` and `NAME_EN` properties are
retained as `code` and `name`. LayerChart GeoProjection and GeoPath render an
Equal Earth projection in the browser. No remote geometry or map tiles are loaded.
To refresh, retain those properties and each geometry as typed GeoJSON Features;
update the download date and source hash here.

The 177 simplified shapes omit some small countries and territories. `-99` is
not a country match. Unmatched query rows are reported below the map and remain
available in the data table. This is a traffic overview, not a boundary reference.
