# Within Reach

**Access to jobs and essential services by public transit and car**

An interactive map of how many jobs, grocery stores, banks, hospitals, libraries and community colleges the
residents of each block group can reach by public transit and by car within 15, 30, 45 or 60 minutes, in 84 U.S.
metropolitan areas, 2023–2025, with filters by income, car ownership, race and ethnicity, and poverty.

**Map:** https://smh172.github.io/transit-access-map/

By Sierra Arnold, Xavier University (https://www.sierraharnold.com). The access values come from the panel
described in two drafts, which describe the sources and methods:

- "The Evolution of Transit Access to Jobs in American Cities"
  (https://github.com/smh172/evolution-transit-access/blob/main/evolution_transit_access.pdf)
- "The Evolution of Transit Access to Essential Services"
  (https://github.com/smh172/transit-access-essential-services/blob/main/transit_access_essential_services.pdf)

The panel has no car travel times for Jacksonville, Palm Bay and Riverside; theirs were routed for this map by the
same method, on 2026 OpenStreetMap street maps. It also has no census values for Hartford, Jacksonville, Palm Bay and
Riverside; theirs come from the same American Community Survey files, added for this map.

This repository holds the published page only: `index.html`, `app.js`, `style.css`, `preview.jpg` (the image
shown when the link is shared), and the data files the
page draws (`data/`: `metros.json`, the block-group boundaries in `bg/`, their census values in `acs/`, and
the counts of jobs and services at each travel time in `times/`).

## Credits

Public transit schedules include data from Transitland (https://www.transit.land/terms), the Mobility Database and
the Southeastern Pennsylvania Transportation Authority. Street network data © OpenStreetMap contributors,
available under the Open Database License. Jobs from the U.S. Census Bureau, LEHD Origin-Destination
Employment Statistics (LODES 8). Population, income, poverty, race and ethnicity, and vehicles from the Census
Bureau's American Community Survey, 2018–22. Services from USDA (SNAP retailers), FDIC (Summary of Deposits), CMS (Provider of Services), IMLS
(Public Libraries Survey) and NCES (IPEDS). Boundaries from the Census Bureau's 2020 cartographic boundary
files. Routing was run on resources of the Ohio Supercomputer Center. Basemap by OpenFreeMap and
OpenMapTiles. Address search by Nominatim. Map library: MapLibre GL JS.
