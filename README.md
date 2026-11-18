# Within Reach

**Access to jobs and essential services by public transit and car**

An interactive map of how many jobs, grocery stores, banks, hospitals, libraries and community colleges the
residents of each block group can reach by public transit and by car within 15, 30, 45 or 60 minutes, in 84 U.S.
metropolitan areas, 2023–2025, with filters by income, car ownership, race and ethnicity, and poverty.

**Map:** https://smh172.github.io/transit-access-map/

A second tab, **Routes and buses** (https://smh172.github.io/transit-access-map/routes.html), draws each metro's
public transit routes and moves its buses and trains on one weekday's published schedules, from 6:30 to 9:30 a.m.,
over the jobs per square mile of each block group.

By Sierra Arnold, Xavier University (https://www.sierraharnold.com). The access values come from the panel
described in two drafts, which describe the sources and methods:

- "The Evolution of Transit Access to Jobs in American Cities"
  (https://github.com/smh172/evolution-transit-access/blob/main/evolution_transit_access.pdf)
- "The Evolution of Transit Access to Essential Services"
  (https://github.com/smh172/transit-access-essential-services/blob/main/transit_access_essential_services.pdf)

The panel has no car travel times for Jacksonville, Palm Bay and Riverside; theirs were routed for this map by the
same method, on 2026 OpenStreetMap street maps. It also has no census values for Hartford, Jacksonville, Palm Bay and
Riverside; theirs come from the same American Community Survey files, added for this map.

This repository holds the published pages only: `index.html` and `routes.html`, `app.js` and `routes.js`, `style.css`,
`preview.jpg` and `preview_routes.jpg` (the images shown when the links are shared), and the data files the
pages draw (`data/`: `metros.json`, the block-group boundaries in `bg/`, their census values in `acs/`, the
counts of jobs and services at each travel time in `times/`, and each metro's routes, scheduled runs, stops and
jobs per square mile in `routes/`).

## Credits

Public transit schedules include data from Transitland (https://www.transit.land/terms), the Mobility Database and
the Southeastern Pennsylvania Transportation Authority. Street network data © OpenStreetMap contributors,
available under the Open Database License. Jobs from the U.S. Census Bureau, LEHD Origin-Destination
Employment Statistics (LODES 8). Population, income, poverty, race and ethnicity, and vehicles from the Census
Bureau's American Community Survey, 2018–22. Services from USDA (SNAP retailers), FDIC (Summary of Deposits), CMS (Provider of Services), IMLS
(Public Libraries Survey) and NCES (IPEDS). Boundaries from the Census Bureau's 2020 cartographic boundary
files. Routing was run on resources of the Ohio Supercomputer Center. Basemap by OpenFreeMap and
OpenMapTiles. Address search by Nominatim. Map library: MapLibre GL JS; the vehicles on the routes page are drawn
with deck.gl.
