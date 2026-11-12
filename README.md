# Access by transit and car

An interactive map of how many jobs, grocery stores, banks, hospitals, libraries and community colleges the
residents of each block group can reach by transit and by car, in 84 U.S. metropolitan areas, 2023–2025, with
filters by income and by the share of households without a car.

**Map:** https://smh172.github.io/transit-access-map/

By Sierra Arnold, Xavier University (https://www.sierraharnold.com). The access values come from the panel
described in two drafts, which describe the sources and methods:

- "The Evolution of Transit Access to Jobs in American Cities"
  (https://smh172.github.io/evolution-transit-access/evolution_transit_access.pdf)
- "The Evolution of Transit Access to Essential Services"
  (https://smh172.github.io/transit-access-essential-services/transit_access_essential_services.pdf)

This repository holds the published page only: `index.html`, `app.js`, `style.css`, and the data files the
page draws (`data/`: `metros.json`, the block groups in `bg/`, their census values in `acs/` and the essential
services in `svc/`).

## Credits

Transit schedules include data from Transitland (https://www.transit.land/terms), the Mobility Database and
the Southeastern Pennsylvania Transportation Authority. Street network data © OpenStreetMap contributors,
available under the Open Database License. Jobs from the U.S. Census Bureau, LEHD Origin-Destination
Employment Statistics (LODES 8). Income and vehicles from the Census Bureau's American Community Survey,
2018–22. Services from USDA (SNAP retailers), FDIC (Summary of Deposits), CMS (Provider of Services), IMLS
(Public Libraries Survey) and NCES (IPEDS). Boundaries from the Census Bureau's 2020 cartographic boundary
files. Routing was run on resources of the Ohio Supercomputer Center. Basemap by OpenFreeMap and
OpenMapTiles. Address search by Nominatim. Map library: MapLibre GL JS.
