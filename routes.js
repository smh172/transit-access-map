/* Within Reach: the Routes and buses tab (layer 5). Each metro's public transit routes, with its buses and trains
   moving on one weekday's morning schedules over the jobs per square mile. Built from the Cincinnati mockup
   (mockups/routes_cincinnati/) at Sierra's request, 2026-11-17 ("ok looks good, can we exapnd to all cities"; "either
   local or on the main page"), first as its own page; since 2026-11-17 a tab of the one page (Sierra: "it would be cool
   if it doesnt totally relod when you toggle between the two map types"). app.js loads this file on the first visit
   to the tab, or at once at routes.html; it draws on the page's one map and panel, and moves between the national map
   and the metros without reloading. Its data: build_layer5_routes.py (data/routes/<slug>/), with the map's own block
   groups (data/bg/<slug>.json). */
(() => {
  'use strict';
  const WR = window.WR;
  const map = WR.map;
  const $ = (id) => document.getElementById(id);
  const INK = '#1d2027', RAIL = '#115697', NO_VALUE = '#d6d8db';
  const T0 = 6.5 * 3600, T1 = 9.5 * 3600;     // the loop: 6:30 to 9:30 a.m.
  const P0 = 7 * 3600, P1 = 9 * 3600;         // the routing's departure window
  const TRAIL = 100;                           // seconds of schedule behind each bus
  const SPEED = 180;                           // 3 minutes of schedule a second: the loop in one minute
  // the Access tab's zooms (app.js), so the two tabs move alike (Sierra, 2026-11-17: "like make the zooms the same"): a
  // metro opens on its box, at zoom 11 at most; a click on a block group zooms in to 12 when the map is further out; a
  // search goes to 13.5. They replace the page's own zoom to a selected block group (14.5, then 13: "when you click a bg
  // it zooms too far in") and its opening view on the extent of the stops.
  const CLICK_ZOOM = 12, SEARCH_ZOOM = 13.5, METRO_MAX_ZOOM = 11, LOAD_ZOOM = 6.5;
  const US_BOUNDS = [[-124.8, 24.4], [-66.9, 49.4]];
  // the vehicles are drawn by deck.gl, over the map: the map library alone ran Chicago's 1,400 at 3 frames a second. It
  // loads when a metro first opens, since the national map draws none (2026-11-17)
  const DECK_SRC = 'https://unpkg.com/deck.gl@9.0.38/dist.min.js';
  const TITLE = 'Within Reach: Routes, Buses and Jobs';
  const STATES = { '01': 'Alabama', '02': 'Alaska', '04': 'Arizona', '05': 'Arkansas', '06': 'California', '08': 'Colorado',
    '09': 'Connecticut', '10': 'Delaware', '11': 'District of Columbia', '12': 'Florida', '13': 'Georgia', '15': 'Hawaii',
    '16': 'Idaho', '17': 'Illinois', '18': 'Indiana', '19': 'Iowa', '20': 'Kansas', '21': 'Kentucky', '22': 'Louisiana',
    '23': 'Maine', '24': 'Maryland', '25': 'Massachusetts', '26': 'Michigan', '27': 'Minnesota', '28': 'Mississippi',
    '29': 'Missouri', '30': 'Montana', '31': 'Nebraska', '32': 'Nevada', '33': 'New Hampshire', '34': 'New Jersey',
    '35': 'New Mexico', '36': 'New York', '37': 'North Carolina', '38': 'North Dakota', '39': 'Ohio', '40': 'Oklahoma',
    '41': 'Oregon', '42': 'Pennsylvania', '44': 'Rhode Island', '45': 'South Carolina', '46': 'South Dakota',
    '47': 'Tennessee', '48': 'Texas', '49': 'Utah', '50': 'Vermont', '51': 'Virginia', '53': 'Washington',
    '54': 'West Virginia', '55': 'Wisconsin', '56': 'Wyoming' };
  const fmt = new Intl.NumberFormat('en-US');
  const getJSON = (u) => WR.getJSON(WR.vurl(u));
  const empty = { type: 'FeatureCollection', features: [] };
  // a device set to reduce motion opens paused, with Play one press away (before it goes public, 2026-11-17)
  const still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const coarse = window.matchMedia('(pointer: coarse)');

  let T = P0, playing = !still;
  let sel = null;            // the picked block group: {g, trips: Set, routes: [...], stops: [...], tag: [lng, lat]}
  let hoverG = '';           // the block group under the pointer
  const show = { bus: true, rail: true, routes: true };   // the Bus routes, Rail and Routes boxes

  let active = false;        // the tab is shown
  let view = null;           // what the tab shows: 'national' or 'metro' (null before the first)
  let nav = 0;               // each navigation's number: a newer one stops one still loading
  let stayNav = 0;           // the navigation a zoom past the metro scale started, while it loads
  let moving = false;        // one of the tab's own flights is under way: the zoom handlers wait for its end
  let quiet = 0;             // a jump of the tab's own: the zoom handlers let it pass
  let keptSlug = null;       // the metro shown when the tab was left: coming back to it keeps its clock and boxes
  let M = null;              // the metro shown: its files and what the tab derives from them
  let data = null;           // one metro's files in memory, or loading: { slug, ready }

  // ---------- the metros: the routes index and the metro list, which app.js loads for both tabs ----------
  let index = [], metros = [], have = new Set(), short = new Map();
  const base = Promise.all([WR.routesIndexReady, WR.metaReady]).then(([ix, meta]) => {
    index = ix;
    metros = meta.metros || meta;
    have = new Set(index.map((x) => x.slug));
    short = new Map(index.map((x) => [x.slug, x.short]));
  });
  const inBox = (b, lon, lat) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
  const area = (m) => (m.bbox[2] - m.bbox[0]) * (m.bbox[3] - m.bbox[1]);
  // the smallest metro box holding a place, as on the Access tab
  const metroAt = (lng, lat) => metros.filter((m) => have.has(m.slug) && inBox(m.bbox, lng, lat)).sort((a, b) => area(a) - area(b))[0] || null;
  // the metro of the address: ?metro=, else, for an address opened or brought from the Access tab, a view over a metro
  // and close enough to be its own; else none, the national map (Cincinnati until 2026-11-17; Sierra: "the routes and
  // busses tab seems to only have cincy rn")
  function target(byView) {
    const hv = location.hash.match(/view=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/);
    let slug = new URLSearchParams(location.search).get('metro');
    if (!have.has(slug)) {
      const hit = byView && hv && +hv[1] >= 8 && metros.find((m) => have.has(m.slug) && inBox(m.bbox, +hv[3], +hv[2]));
      slug = hit ? hit.slug : null;
    }
    return { slug, bg: (location.hash.match(/(?:^#|&)bg=(\d{12})/) || [])[1] || null };
  }
  // a metro's view, as the Access tab computes it: where the middle 90% of its residents live, with a 5% margin
  // (app.js, homeBox; since 2026-11-18), padding 40, zoom 11 at most; a metro too spread out for zoom 7 opens on its
  // center. With b = its whole box, the view of the whole metro.
  function homeOf(rec, b = WR.homeBox(rec)) {
    const cam = map.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: METRO_MAX_ZOOM });
    return cam && cam.zoom >= LOAD_ZOOM + 0.5 ? { center: cam.center, zoom: cam.zoom }
      : { center: rec.center || map.getCenter(), zoom: LOAD_ZOOM + 1 };
  }
  // a view over the metro and close enough to be its own is kept when the metro opens
  const kept = (rec) => { const c = map.getCenter(); return map.getZoom() >= 8 && inBox(rec.bbox, c.lng, c.lat); };

  // ---------- one metro's files: its block groups and its seven routes files, one metro in memory ----------
  // The map draws a metro from its block groups and five of the routes files. What only the card and a selection
  // need loads right after: the stop calls and the block groups' stops (43% of the routes bytes; 1.8 of Chicago's
  // 5.1 MB as sent; Sierra, 2026-11-18, asked "Build speed-ups (a) and (b) next?": "Yes, a and b"), and the jobs within
  // 30 minutes, from the Access tab's jobs file, which both tabs read since the boundary files hold no values
  // (2026-11-18: "do g and h").
  const FIRST = ['meta', 'routes', 'trips', 'stops', 'jobs'];
  const LATER = ['calls', 'bgstops'];
  function load(slug) {
    if (data && data.slug === slug) return data.ready;
    const entry = { slug };
    entry.ready = Promise.all([getJSON(`data/bg/${slug}.json`), ...FIRST.map((n) => getJSON(`data/routes/${slug}/${n}.json`))])
      .then((files) => { const X = prepare(slug, files); loadLater(X); return X; });
    entry.ready.catch(() => { if (data === entry) data = null; });   // a failed load is tried again next time
    data = entry;
    return entry.ready;
  }
  // what only the card and a selection need; when it comes in, the card and a selection made before it are completed.
  // If it fails, the card says so.
  function loadLater(X) {
    if (!X.laterReady) {
      X.laterReady = Promise.all([...LATER.map((n) => getJSON(`data/routes/${X.slug}/${n}.json`)), getJSON(`data/times/${X.slug}.jobs.json`)])
        .then(([callsRaw, bgstops, times]) => {
          X.calls = callsRaw.calls;
          X.bgstops = bgstops;
          // the jobs within 30 minutes by public transit and by car, and their ranks in the metro
          const at = ['j30t', 'j30c', 'j30tp', 'j30cp'].map((f) => times.fields.indexOf(f));
          for (const [g, p] of X.bgByG) { const v = times.bg[g]; if (v) [p.t, p.c, p.tp, p.cp] = at.map((i) => v[i]); }
        }, (err) => { console.error(err); X.laterFailed = true; })
        .then(() => {
          X.laterIn = true;
          X.servingCache.clear();
          if (M !== X) return;
          if (sel) { const sv = serving(sel.g); if (sv) Object.assign(sel, { trips: sv.trips, routes: sv.routes, stops: sv.stops }); }
          if (active && view === 'metro') { if (sel) applySel(); renderCard(); }
        });
    }
    return X.laterReady;
  }
  let deckLoad = null;
  function loadDeck() {
    if (!deckLoad) {
      deckLoad = new Promise((res, rej) => {
        if (window.deck) { res(); return; }
        const s = document.createElement('script');
        s.src = DECK_SRC;
        s.onload = () => res();
        s.onerror = () => rej(new Error('deck.gl could not be loaded'));
        document.head.appendChild(s);
      });
      deckLoad.catch(() => { deckLoad = null; });
    }
    return deckLoad;
  }

  // what the tab draws and writes for a metro, from its files
  function prepare(slug, [bgfc, meta, routes, tripsRaw, stops, jobs]) {
    // the stop calls, the block groups' stops and the jobs within 30 minutes come in later (loadLater)
    const X = { slug, meta, routes, stops, bgfc, calls: null, bgstops: null, laterIn: false, laterFailed: false, servingCache: new Map() };
    X.rec = metros.find((m) => m.slug === slug) || {};
    X.city = meta.short.split(',')[0];
    // block groups: the map's own shapes, with the jobs here and the jobs per square mile in greens
    const jb = meta.jbreaks, greens = meta.greens;
    const jclass = (d) => { let i = 0; while (i < jb.length && d >= jb[i]) i += 1; return i; };
    for (const f of bgfc.features) {
      const p = f.properties, j = jobs[p.g];
      p.jobs = j ? j[0] : null; p.dens = j ? j[1] : null;
      p.jfill = p.dens == null ? NO_VALUE : greens[jclass(p.dens)];
    }
    X.bgByG = new Map(bgfc.features.map((f) => [f.properties.g, f.properties]));
    X.bgFeat = new Map(bgfc.features.map((f) => [f.properties.g, f]));
    // runs: [lon, lat, t] triples, each after the first stored as a difference from the one before
    const kinds = meta.routes.map((r) => (r.kind === 'bus' ? 0 : 1));
    X.trips = tripsRaw.trips.map((d, i) => {
      const n = d.p.length / 3, lon = new Float64Array(n), lat = new Float64Array(n), t = new Float64Array(n);
      let a = 0, b = 0, c = 0;
      for (let k = 0; k < n; k++) {
        a += d.p[3 * k]; b += d.p[3 * k + 1]; c += d.p[3 * k + 2];
        lon[k] = a / 1e5; lat[k] = b / 1e5; t[k] = c;
      }
      return { r: d.r, kind: kinds[d.r] || 0, lon, lat, t, t0: t[0], t1: t[n - 1], phase: (i * 0.6180339887) % 1 };
    });
    // the sources, from the metro's own agencies and date
    const ag = meta.agencies;
    const hasRail = meta.routes.some((r) => r.kind === 'rail'), hasFerry = meta.routes.some((r) => r.kind === 'ferry');
    const modes = hasRail && hasFerry ? 'Buses, trains and ferries' : hasRail ? 'Buses and trains' : hasFerry ? 'Buses and ferries' : 'Buses';
    const agTxt = ag.length === 0 ? 'the' : ag.length === 1 ? `the ${ag[0]}`
      : ag.length <= 3 ? `the ${ag.slice(0, -1).join(', ')} and ${ag[ag.length - 1]}` : `the ${ag.slice(0, 2).join(', ')} and ${['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][ag.length - 2] || ag.length - 2} other agencies'`;
    X.sources = `${modes} follow ${agTxt} schedules for a ${meta.weekday} in ${meta.month} ${meta.year}, not live locations. Jobs: LODES, ${meta.jobs_year}.`;
    X.hint = meta.runs ? '<strong>Select a block group</strong> to see its nearby buses and the jobs it can reach.'
      : '<strong>Select a block group</strong> to see the jobs it can reach.';
    // the key, under the card
    X.anyRail = hasRail || hasFerry;
    const other = hasRail && hasFerry ? 'rail or ferry' : hasRail ? 'rail' : 'ferry';
    X.key = `
    <svg width="54" height="22" aria-hidden="true"><circle cx="27" cy="11" r="9" fill="none" stroke="#d99a00" stroke-opacity="0.6"/><circle cx="27" cy="11" r="4.2" fill="#ffc61a" stroke="#1d2027" stroke-width="1.2"/></svg>
    <span>A bus on its schedule${X.anyRail ? ` (blue: ${other})` : ''}</span>
    <svg width="54" height="22" aria-hidden="true"><line x1="2" y1="6" x2="52" y2="6" stroke="#1d2027" stroke-width="4.5" stroke-linecap="round"/><line x1="2" y1="16" x2="52" y2="16" stroke="#1d2027" stroke-width="1.3" stroke-linecap="round"/></svg>
    <span>Wider lines: more buses, 7 to 9 a.m.</span>
    <svg width="54" height="22" aria-hidden="true"><circle cx="27" cy="11" r="4.5" fill="#ffffff" stroke="#1d2027" stroke-width="1.4"/></svg>
    <span>A stop within a 5-minute walk of the selected block group</span>`;   // the white dots (Sierra, 2026-11-19: "the legend can have the white dots but doesnt need the tails")
    X.railText = hasRail && hasFerry ? 'Rail and ferries' : hasRail ? 'Rail' : 'Ferries';
    // About these routes: plain points under a few headers (Sierra, 2026-11-17: "simplify the about these routes, maybe
    // bullet points"; "simpler nad technical language"; "i dont like the bold with periods in the about. just sort it
    // into relevent headers and keep it simple, no signposting")
    const day = `${meta.weekday}, ${meta.month} ${Number(meta.route_date.slice(8))}, ${meta.year}`;
    const agList = ag.length > 1 ? `${ag.slice(0, -1).join(', ')} and ${ag[ag.length - 1]}` : ag[0];
    const sections = [
      ['Schedules', [
        meta.runs ? `${agList}, from GTFS files in the Transitland and Mobility Database archives.` : null,
        meta.runs ? `The buses and trains follow the schedules for ${day}.` : `The map uses the schedules for ${day}.`,
        meta.runs ? `The Jobs and essential services tab's ${meta.map_year} values use one weekday in each quarter of ${meta.map_year}; this is the latest of those days on which every schedule file runs trips.`
          : `It is one of the days behind the Jobs and essential services tab's ${meta.map_year} values.`,
        meta.runs ? 'Vehicles are placed by their scheduled stop times, not live locations, and move along their routes between stops.' : null,
        meta.runs ? 'The clock runs from 6:30 to 9:30 a.m., at 3 minutes of schedule per second.' : null,
      ]],
      ['Map', [
        meta.runs ? "Each route's line is its most common path in each direction, wider with more trips from 7 to 9 a.m. in the busier direction." : null,
        `The green shading shows jobs per square mile of land, counted at the workplace (LODES ${meta.jobs_year}).`,
      ]],
      ['Selected block group', [
        meta.runs ? 'Only the vehicles that stop within 400 meters (a 5-minute walk) are shown.' : null,
        'Jobs within 30 minutes by public transit and by car with no traffic, as on the Jobs and essential services tab.',
        `The public transit count is the median trip leaving between 7 and 9 a.m. on one weekday in each quarter of ${meta.map_year}, not only on the day the vehicles show.`,
      ]],
      ['Credits', ['Street map &copy; OpenStreetMap contributors.', 'Basemap by OpenFreeMap and OpenMapTiles.', 'Vehicles drawn with deck.gl.']],
    ];
    X.about = `
    ${meta.note ? `<p class="note">${meta.note}</p>` : ''}
    ${sections.map(([h, items]) => `<h3>${h}</h3><ul class="about-list">${items.filter(Boolean).map((t) => `<li>${t}</li>`).join('')}</ul>`).join('')}`;
    const kfmt = (v) => (v >= 1000 ? `${fmt.format(v / 1000)}k` : fmt.format(v));
    X.legend = `
    <div class="lg-title">Jobs per square mile, ${meta.jobs_year}</div>
    <div class="lg-bar">${greens.map((c) => `<span style="background:${c}"></span>`).join('')}</div>
    <div class="lg-ticks">${jb.map((b, i) => `<span style="left:${((i + 1) / greens.length) * 100}%">${kfmt(b)}</span>`).join('')}</div>
    <div class="lg-ends"><span>Fewer jobs</span><span>More jobs</span></div>`;
    return X;
  }

  // ---------- the tab's map layers: the national circles, and one metro's block groups, routes and stops ----------
  const vis = (ids, on) => ids.forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); });
  const BG_LAYERS = ['r-bg-jobs', 'r-bg-line', 'r-bg-hit', 'r-bg-hover', 'r-bg-sel-casing', 'r-bg-sel', 'r-selstops'];
  const ROUTE_LAYERS = ['r-routes-casing', 'r-routes-line', 'r-routes-tram', 'r-routes-hi'];
  let overlay = null;        // deck.gl's canvas for the vehicles, made once and kept
  let layersMade = false;

  // the national map: the 84 metros as circles; one is chosen by its circle, the menu or a search. The circles go on
  // as soon as the map's style is in, not after every street tile (2026-11-17: that took 2.3 s live).
  let natReady = null, natBuilt = false, natLegend = '';
  function buildNational() {
    if (!natReady) {
      natReady = (async () => {
        await Promise.all([base, WR.styleReady]);
        // the circles' color: jobs per square mile in the metro's central business district (index.json, dens_cbd), on
        // steps that split the 84 metros into eighths, in the metro view's greens (Sierra, 2026-11-17: "the greens at
        // the national map arent in any kind of scale, while the blues are"; "myabe say in the central business district")
        const greens = (await getJSON(`data/routes/${index[0].slug}/meta.json`)).greens;
        const twoSig = (x) => { const m = Math.pow(10, Math.floor(Math.log10(x)) - 1); return Math.round(x / m) * m; };
        const dv = index.map((x) => x.dens_cbd).filter((v) => v > 0).sort((a, b) => a - b);
        const dbr = [];
        for (let i = 1; i < greens.length; i++) {
          const b = twoSig(dv[Math.floor((i * dv.length) / greens.length)]);
          if (!dbr.length || b > dbr[dbr.length - 1]) dbr.push(b);
        }
        const dstep = ['step', ['get', 'd'], greens[0]];
        dbr.forEach((b, i) => dstep.push(b, greens[i + 1]));
        const dens = new Map(index.map((x) => [x.slug, x.dens_cbd || 0]));
        const kfmt = (v) => (v >= 1000 ? `${fmt.format(Math.round(v / 100) / 10)}k` : fmt.format(v));
        natLegend = `
        <div class="lg-title">Jobs per square mile in each metro's central business district</div>
        <div class="lg-bar">${greens.map((c) => `<span style="background:${c}"></span>`).join('')}</div>
        <div class="lg-ticks">${dbr.map((b, i) => `<span style="left:${((i + 1) / greens.length) * 100}%">${kfmt(b)}</span>`).join('')}</div>
        <div class="lg-ends"><span>Fewer jobs</span><span>More jobs</span></div>
        <div class="lg-note">The central business district here is the area within a mile of the spot with the most jobs within a mile. Each color holds about an eighth of the ${index.length} metros.</div>`;
        // green, the tab's color, and sized by the buses and trains running at 8 a.m., by the Access tab's formula (the
        // square root of the share of the largest) (Sierra, 2026-11-17: "since that tab is green, maybe the circles should
        // be green? and does it make sense for them to all be the same size?")
        const veh = new Map(index.map((x) => [x.slug, x.vehicles_8am || 0]));
        const maxV = Math.max(...veh.values());
        map.addSource('r-metros', { type: 'geojson', data: { type: 'FeatureCollection', features: metros
          .filter((m) => have.has(m.slug) && m.center)
          .sort((a, b) => veh.get(b.slug) - veh.get(a.slug))   // the small ones drawn last, on top
          .map((m) => ({ type: 'Feature', properties: { slug: m.slug, name: short.get(m.slug), n: veh.get(m.slug),
            d: dens.get(m.slug), size: Math.sqrt(veh.get(m.slug) / maxV) }, geometry: { type: 'Point', coordinates: m.center } })) } });
        map.addLayer({ id: 'r-metro-dots', type: 'circle', source: 'r-metros', layout: { visibility: 'none' }, paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            3, ['+', 3, ['*', 6, ['get', 'size']]], 7, ['+', 5, ['*', 10, ['get', 'size']]]],
          'circle-color': dstep, 'circle-opacity': 0.95,
          'circle-stroke-color': '#2f3440', 'circle-stroke-width': 1.25 } });
        natBuilt = true;
      })();
      natReady.catch(() => { natReady = null; });
    }
    return natReady;
  }

  // the metro view's sources and layers, made with the first metro and refilled for each later one
  function makeLayers(X) {
    const firstSymbol = (map.getStyle().layers.find((l) => l.type === 'symbol') || {}).id;
    const hidden = { visibility: 'none' };
    const round = { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' };
    map.addSource('r-bg', { type: 'geojson', data: X.bgfc });
    map.addLayer({ id: 'r-bg-jobs', type: 'fill', source: 'r-bg', layout: hidden, paint: { 'fill-color': ['get', 'jfill'], 'fill-opacity': 0.82 } }, firstSymbol);
    map.addLayer({ id: 'r-bg-line', type: 'line', source: 'r-bg', layout: hidden,
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0, 12, 0.4, 15, 1] } }, firstSymbol);
    map.addLayer({ id: 'r-bg-hit', type: 'fill', source: 'r-bg', layout: hidden, paint: { 'fill-color': '#000', 'fill-opacity': 0.001 } }, firstSymbol);
    // routes: wider where buses come more often (trips an hour in the busier direction, 7 to 9 a.m.)
    const w = (k) => ['interpolate', ['linear'], ['get', 'tph_route'], 0.5, 0.9 * k, 1, 1.3 * k, 2, 2 * k, 4, 3.3 * k, 6, 4.6 * k];
    const zw = (k0, k1, k2) => ['interpolate', ['linear'], ['zoom'], 10, w(k0), 13, w(k1), 16, w(k2)];
    map.addSource('r-routes', { type: 'geojson', data: X.routes });
    map.addLayer({ id: 'r-routes-casing', type: 'line', source: 'r-routes', layout: round,
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.75,
               'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['+', 1.4, w(0.8)], 13, ['+', 2, w(1.15)], 16, ['+', 3, w(1.9)]] } }, firstSymbol);
    map.addLayer({ id: 'r-routes-line', type: 'line', source: 'r-routes', filter: ['==', ['get', 'kind'], 'bus'], layout: round,
      paint: { 'line-color': INK, 'line-opacity': 0.8, 'line-width': zw(0.8, 1.15, 1.9) } }, firstSymbol);
    map.addLayer({ id: 'r-routes-tram', type: 'line', source: 'r-routes', filter: ['!=', ['get', 'kind'], 'bus'], layout: round,
      paint: { 'line-color': RAIL, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 13, 3.5, 16, 6] } }, firstSymbol);
    map.addLayer({ id: 'r-routes-hi', type: 'line', source: 'r-routes', filter: ['in', ['get', 'i'], ['literal', []]], layout: round,
      paint: { 'line-color': ['case', ['==', ['get', 'kind'], 'bus'], INK, RAIL], 'line-opacity': 0.95, 'line-width': zw(0.9, 1.5, 2.4) } }, firstSymbol);
    map.addLayer({ id: 'r-bg-hover', type: 'line', source: 'r-bg', filter: ['==', ['get', 'g'], ''], layout: hidden,
      paint: { 'line-color': INK, 'line-width': 1.8, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'r-bg-sel-casing', type: 'line', source: 'r-bg', filter: ['==', ['get', 'g'], ''], layout: hidden, paint: { 'line-color': '#ffffff', 'line-width': 8 } });
    map.addLayer({ id: 'r-bg-sel', type: 'line', source: 'r-bg', filter: ['==', ['get', 'g'], ''], layout: hidden, paint: { 'line-color': INK, 'line-width': 3.4 } });
    map.addSource('r-selstops', { type: 'geojson', data: empty });
    map.addLayer({ id: 'r-selstops', type: 'circle', source: 'r-selstops', layout: hidden,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 15, 5], 'circle-color': '#ffffff',
               'circle-stroke-color': INK, 'circle-stroke-width': 1.4 } });
    // the vehicles, drawn by deck.gl over the map: one canvas, kept while the tab is away, so switching makes no new one
    overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay);
    layersMade = true;
  }
  function showMetroLayers(on) {
    if (!layersMade) return;
    vis(BG_LAYERS, on);
    if (on) applyRouteVis(); else vis(ROUTE_LAYERS, false);
  }
  // route lines by kind, as the Bus routes, Rail and Routes boxes say (the vehicles follow the same boxes in draw())
  function applyRouteVis() {
    if (!layersMade) return;
    const kf = show.bus && show.rail ? null : show.bus ? ['==', ['get', 'kind'], 'bus']
      : show.rail ? ['!=', ['get', 'kind'], 'bus'] : ['==', ['get', 'kind'], '-'];
    const hiBase = ['in', ['get', 'i'], ['literal', sel ? sel.routes : []]];
    map.setFilter('r-routes-casing', kf);
    map.setFilter('r-routes-hi', kf ? ['all', hiBase, kf] : hiBase);
    vis(['r-routes-casing', 'r-routes-hi'], show.routes);
    vis(['r-routes-line'], show.routes && show.bus);
    vis(['r-routes-tram'], show.routes && show.rail);
  }

  // ---------- the vehicles ----------
  const lerpZ = (z, stops) => {               // piecewise-linear in zoom, clamped at the ends
    if (z <= stops[0][0]) return stops[0][1];
    for (let k = 1; k < stops.length; k++) {
      if (z <= stops[k][0]) { const [z0, v0] = stops[k - 1], [z1, v1] = stops[k]; return v0 + ((z - z0) / (z1 - z0)) * (v1 - v0); }
    }
    return stops[stops.length - 1][1];
  };
  const YELLOW = [255, 198, 26], BLUE = [17, 86, 151], INKRGB = [29, 32, 39], AMBER = [217, 154, 0];
  function at(tr, s) {
    const t = tr.t;
    let lo = 0, hi = t.length - 1;
    if (s <= t[0]) return [tr.lon[0], tr.lat[0], 0];
    if (s >= t[hi]) return [tr.lon[hi], tr.lat[hi], hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= s) lo = m; else hi = m; }
    const f = t[hi] > t[lo] ? (s - t[lo]) / (t[hi] - t[lo]) : 0;
    return [tr.lon[lo] + f * (tr.lon[hi] - tr.lon[lo]), tr.lat[lo] + f * (tr.lat[hi] - tr.lat[lo]), lo];
  }
  function draw(clockSec) {
    // each vehicle in service now, and its trail: only its last TRAIL seconds of points, rebuilt each frame (the
    // whole day's paths, about a million points in Chicago, ran it at 7 frames a second)
    const pts = [], tails = [];
    M.trips.forEach((tr, i) => {
      if (T < tr.t0 || T > tr.t1) return;
      if (sel && sel.trips && !sel.trips.has(i)) return;   // every vehicle until the selection's stop calls are in
      if (tr.kind ? !show.rail : !show.bus) return;   // buses, rail, or both
      const [x, y, lo] = at(tr, T);
      pts.push({ pos: [x, y], p: (clockSec / 1.7 + tr.phase) % 1, k: tr.kind });
      const sa = Math.max(T - TRAIL, tr.t0);
      if (sa < T) {
        const [ax, ay, alo] = at(tr, sa);
        const path = [ax, ay], ts = [sa];
        for (let k = alo + 1; k <= lo; k++) { path.push(tr.lon[k], tr.lat[k]); ts.push(tr.t[k]); }
        path.push(x, y); ts.push(T);
        tails.push({ path, ts, kind: tr.kind });
      }
    });
    const z = map.getZoom();
    const zl = M.zl;
    const rDot = lerpZ(z, [[zl, 1.8], [10, 2.8], [13, 4.2], [16, 6.5]]);
    const rMin = lerpZ(z, [[zl, 1.5], [10, 2.5], [14, 4.5]]), rMax = lerpZ(z, [[zl, 6], [10, 12], [14, 24]]);
    const wTrail = lerpZ(z, [[zl, 0.9], [10, 1.6], [13, 3], [16, 5.5]]);
    overlay.setProps({ layers: [
      new deck.TripsLayer({ id: 'trails', data: tails, positionFormat: 'XY',
        getPath: (d) => d.path, getTimestamps: (d) => d.ts, getColor: (d) => (d.kind ? BLUE : YELLOW),
        widthUnits: 'pixels', getWidth: wTrail, capRounded: true, jointRounded: true, opacity: 0.85,
        trailLength: TRAIL, currentTime: T, fadeTrail: true, updateTriggers: { getWidth: wTrail } }),
      // the rings pulse only while the clock runs, so a paused map is still
      new deck.ScatterplotLayer({ id: 'ping', data: playing ? pts : [], getPosition: (d) => d.pos,
        radiusUnits: 'pixels', getRadius: (d) => rMin + d.p * (rMax - rMin), stroked: true, filled: true,
        getFillColor: (d) => [...(d.k ? BLUE : YELLOW), Math.round(40 * (1 - d.p))],
        getLineColor: (d) => [...(d.k ? BLUE : AMBER), Math.round(215 * (1 - d.p))],
        lineWidthUnits: 'pixels', getLineWidth: 1.8 }),
      new deck.ScatterplotLayer({ id: 'dot', data: pts, getPosition: (d) => d.pos,
        radiusUnits: 'pixels', getRadius: rDot, stroked: true, getFillColor: (d) => (d.k ? BLUE : YELLOW),
        getLineColor: (d) => (d.k ? [255, 255, 255] : INKRGB), lineWidthUnits: 'pixels', getLineWidth: 1.2,
        updateTriggers: { getRadius: rDot } }),
    ] });
    $('r-nbus').textContent = fmt.format(pts.length);
    $('r-nbus-label').textContent = sel && sel.trips ? 'shown' : 'in service';
  }
  const clockEl = $('r-clock'), ampmEl = $('r-ampm'), scrub = $('r-scrub');
  function showClock() {                      // the clock steps by 3 minutes, once a second at this speed
    const m = Math.floor(T / 180) * 3, h = Math.floor(m / 60), mm = m % 60;
    clockEl.textContent = `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')}`;
    ampmEl.textContent = h < 12 ? 'a.m.' : 'p.m.';
    scrub.value = T;
  }
  // the clock runs only while a metro is shown on this tab
  let raf = 0, last = null;
  function frame(now) {
    if (last === null) last = now;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) { T += dt * SPEED; if (T > T1) T = T0; }
    draw(now / 1000);
    showClock();
    raf = requestAnimationFrame(frame);
  }
  const startLoop = () => { if (!raf) { last = null; raf = requestAnimationFrame(frame); } };
  const stopLoop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };

  // ---------- the panel ----------
  const setStatus = (msg) => { $('r-status').textContent = msg; };
  const loading = $('r-loading');
  const setLoading = (on, text = 'Loading the schedules...') => { loading.textContent = text; loading.hidden = !on; };
  const play = $('r-play');
  const ICON_PAUSE = '<svg width="10" height="11" viewBox="0 0 10 11" aria-hidden="true"><rect x="1" y="0.5" width="3" height="10" rx="0.6" fill="currentColor"/><rect x="6" y="0.5" width="3" height="10" rx="0.6" fill="currentColor"/></svg>';
  const ICON_PLAY = '<svg width="10" height="11" viewBox="0 0 10 11" aria-hidden="true"><path d="M1.5 0.8v9.4l7.6-4.7z" fill="currentColor"/></svg>';
  const setPlaying = (v) => { playing = v; play.innerHTML = v ? `${ICON_PAUSE}Pause` : `${ICON_PLAY}Play`; };
  // a metro opens as a new page did: 7:00 a.m., every box checked, running unless the device reduces motion
  function resetSettings() {
    T = P0;
    setPlaying(!still);
    show.bus = true; show.rail = true; show.routes = true;
    ['r-t-bus', 'r-t-rail', 'r-t-route'].forEach((id) => { $(id).checked = true; });
    showClock();
  }
  // the shared metro menu: the metro shown, without "Choose a metro" (the routes page's menu had none at a metro)
  function menuState() {
    const menu = $('metro');
    if (menu.options[0]) menu.options[0].hidden = view === 'metro';
    menu.value = view === 'metro' && M ? M.slug : '';
  }
  const NATIONAL_ABOUT = `
      <h3>Schedules</h3><ul class="about-list">
        <li>Each metro's public transit, from GTFS files in the Transitland and Mobility Database archives.</li>
        <li>For each metro, the latest date behind the Jobs and essential services tab's values on which every schedule file runs trips.</li>
        <li>Vehicles are placed by their scheduled stop times, not live locations, and move along their routes between stops.</li></ul>
      <h3>Map</h3><ul class="about-list">
        <li>The green shading shows jobs per square mile of land, counted at the workplace (LODES).</li></ul>
      <h3>Credits</h3><ul class="about-list">
        <li>Street map &copy; OpenStreetMap contributors.</li><li>Basemap by OpenFreeMap and OpenMapTiles.</li>
        <li>Vehicles drawn with deck.gl.</li></ul>`;
  function nationalPanel() {
    document.title = TITLE;
    $('r-back').hidden = true;
    $('r-note').hidden = true;
    $('r-clickhint-text').innerHTML = '<strong>Choose a metro</strong> or search for an address to see its public transit routes and buses.';
    $('r-clickhint').classList.remove('off');
    $('r-sel').classList.remove('on');
    $('r-sel').innerHTML = '';
    $('r-key').style.display = 'none';
    $('r-t-rail-label').hidden = false;
    $('r-t-rail-text').textContent = 'Rail';
    // the map options stay where they are on every view, as on the Access tab, idle until a metro is chosen (Sierra,
    // 2026-11-17: "its kind of weird that the right panel is already in palce for the access tab but not for the green tab")
    for (const el of document.querySelectorAll('#r-options button, #r-options input')) el.disabled = true;
    $('r-inservice').style.visibility = 'hidden';
    document.querySelector('#r-options .speednote').textContent = 'Choose a metro to see its buses running.';
    $('r-options').style.opacity = '0.6';
    // what the circles' sizes mean (Sierra, 2026-11-17: "does it make sense for them to all be the same size?")
    $('r-sources').textContent = 'Larger circles: more buses and trains running at 8 a.m. on the metro\'s schedule date.';
    $('about-routes-body').innerHTML = NATIONAL_ABOUT;
    $('legend').innerHTML = natLegend;
    menuState();
  }
  function metroPanel() {
    document.title = `${TITLE}, ${M.meta.short}`;
    $('r-sources').textContent = M.sources;
    $('r-clickhint-text').innerHTML = M.hint;
    // the metro's note, where its schedule files leave out its main public transit or run none on the date
    $('r-note').textContent = M.meta.note || '';
    $('r-note').hidden = !M.meta.note;
    $('r-key').innerHTML = M.key;
    $('r-key').style.display = '';
    $('r-t-rail-label').hidden = !M.anyRail;
    $('r-t-rail-text').textContent = M.railText;
    for (const el of document.querySelectorAll('#r-options button, #r-options input')) el.disabled = false;
    $('r-inservice').style.visibility = '';
    document.querySelector('#r-options .speednote').textContent = 'Sped up: 3 min/sec';
    $('r-options').style.opacity = '';
    $('about-routes-body').innerHTML = M.about;
    $('legend').innerHTML = M.legend;
    $('r-back').hidden = false;
    menuState();
    renderCard();
  }

  // ---------- picking a block group: only the buses that stop within a 5-minute walk ----------
  const tractLabel = (c) => { const n = parseInt(c.slice(0, 4), 10), s = c.slice(4); return s === '00' ? `${n}` : `${n}.${s}`; };
  // the Access tab's card for a block group (app.js, blockGroupHTML): the same rows, ratio and notes, for jobs at 30 minutes
  const ratioText = (r) => (r >= 10 ? fmt.format(Math.round(r)) : r.toFixed(1));
  const has = (v) => v !== null && v !== undefined && !Number.isNaN(v);
  const inMetro = (x) => (x === 0 ? `The lowest in the ${M.city} metro` : `Higher than ${x}% of block groups in the ${M.city} metro`);
  const jobsRow = (label, v, pct, missing) => (!has(v)
    ? `<div class="row"><div class="row-top"><span class="row-label">${label}</span>
        <span class="row-value na">Not available</span></div><div class="row-note">${missing}</div></div>`
    : `<div class="row"><div class="row-top"><span class="row-label">${label}</span><span class="row-value">${fmt.format(v)}</span></div>
        ${has(pct) ? `<div class="gauge" aria-hidden="true"><span class="med"></span><span class="mark" style="left:${Math.min(100, Math.max(0, pct))}%"></span></div>
        <div class="gauge-labels" aria-hidden="true"><span>Lowest</span><span>Median</span><span>Highest</span></div>` : ''}
        <div class="row-note">${has(pct) ? inMetro(pct) : ''}</div></div>`);
  function bboxOf(geom) {
    let w0 = 180, s0 = 90, e0 = -180, n0 = -90;
    const walk = (c) => { if (typeof c[0] === 'number') { w0 = Math.min(w0, c[0]); e0 = Math.max(e0, c[0]); s0 = Math.min(s0, c[1]); n0 = Math.max(n0, c[1]); } else c.forEach(walk); };
    walk(geom.coordinates);
    return [[w0, s0], [e0, n0]];
  }
  let selTag = null;
  function setSelTag(lngLat) {
    if (selTag) { selTag.remove(); selTag = null; }
    if (!lngLat) return;
    const el = document.createElement('div');
    el.className = 'seltag'; el.textContent = 'Selected';
    selTag = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -4] }).setLngLat(lngLat).addTo(map);
  }
  // the runs that stop within a 5-minute walk of a block group, its stops, its routes, and its stops by buses 7 to 9 a.m.;
  // null until the stop calls are in, or if they could not be loaded
  function serving(g) {
    if (!M.laterIn || M.laterFailed) return null;
    if (M.servingCache.has(g)) return M.servingCache.get(g);
    const S = new Set(M.bgstops[g] || []);
    const serve = new Set(), routesSet = new Set();
    let peak = 0;
    M.calls.forEach((c, i) => {
      let hit = false, inPeak = false;
      for (let k = 0; k < c.length; k += 2) if (S.has(c[k])) { hit = true; if (c[k + 1] >= P0 && c[k + 1] < P1) inPeak = true; }
      if (hit) { serve.add(i); routesSet.add(M.trips[i].r); }
      if (inPeak) peak += 1;
    });
    const out = { trips: serve, routes: [...routesSet], stops: [...S], peak };
    M.servingCache.set(g, out);
    return out;
  }
  // the card for a block group: the one under the pointer, or the selected one, as on the Access tab
  function cardHTML(g, pinned) {
    const meta = M.meta;
    const sv = serving(g);   // null while the stop calls load
    const p = M.bgByG.get(g) || {};
    const names = (sv ? sv.routes : []).map((r) => meta.routes[r]).sort((a, b) => (a.agency === b.agency
      ? (a.name || a.long).localeCompare(b.name || b.long, 'en', { numeric: true }) : a.agency.localeCompare(b.agency)));
    const byAgency = {};
    names.forEach((r) => { (byAgency[r.agency] = byAgency[r.agency] || []).push(r.name || r.long); });
    const gap = sv && sv.peak > 0 ? 120 / sv.peak : 0;
    const every = sv && sv.peak > 0 ? `About one every ${gap < 1.5 ? `${Math.round(gap * 60)} seconds` : `${Math.round(gap)} minutes`}. ` : '';
    // the car-to-transit ratio, as the Access tab computes it
    const r = p.t > 0 && has(p.c) ? p.c / p.t : null;
    let rv = null, rn;
    if (r !== null) {
      rv = `${ratioText(r)}&times;`;
      rn = r >= 1 ? `A car reaches ${ratioText(r)} times as many jobs as public transit.` : 'Public transit reaches more jobs than a car here.';
    } else if (p.t === 0 && has(p.c) && p.c > 0) {
      rv = 'None by public transit';
      rn = `Public transit reaches none within 30 minutes; a car reaches ${fmt.format(p.c)}.`;
    } else if (p.t === 0) {
      rn = 'Neither mode reaches any jobs within 30 minutes.';
    } else {
      rn = 'This needs both a public transit and a car value.';
    }
    const where = !sv ? (M.laterFailed ? 'The jobs within 30 minutes and the buses nearby could not be loaded.' : '')
      : sv.stops.length === 0 ? 'No stop within a 5-minute walk.'
      : `${every}${pinned ? `The white ${sv.stops.length === 1 ? 'dot is the stop' : 'dots are the stops'} within a 5-minute walk. ` : ''}Routes: ${Object.entries(byAgency).map(([a, l]) => `<b>${a}</b> ${l.join(', ')}`).join('; ')}`;
    // until the files after the first drawing are in (loadLater), the values read "Loading…"; if they fail, "Not available"
    const wait = M.laterIn && !M.laterFailed ? null : (M.laterFailed ? 'Not available' : 'Loading…');
    const waitRow = (label) => `<div class="row"><div class="row-top"><span class="row-label">${label}</span>
        <span class="row-value na">${wait}</span></div></div>`;
    return `
      <div class="card card-bg">
        <div class="card-head">
          <span class="level level-bg">Block group</span>
          <div class="place">Block group ${g.slice(11)}, tract ${tractLabel(g.slice(5, 11))}, ${STATES[g.slice(0, 2)] || ''}</div>
          <div class="kicker">${meta.short}</div>
          ${pinned ? '<button type="button" class="unpin" id="r-sel-x" aria-label="Clear the selected block group">&times;</button>' : ''}
        </div>
        <div class="nb-row"><span>Jobs here, ${meta.jobs_year}</span><strong>${p.jobs == null ? 'No value' : fmt.format(p.jobs)}</strong></div>
        <div class="section-title">Jobs within 30 minutes</div>
        ${wait ? waitRow('By public transit') : jobsRow('By public transit', p.t, p.tp, 'No public transit value for this block group.')}
        ${wait ? waitRow('By car, no traffic') : jobsRow('By car, no traffic', p.c, p.cp, 'No car value for this block group.')}
        ${wait ? waitRow('Car vs. public transit') : `<div class="row"><div class="row-top"><span class="row-label">Car vs. public transit</span>
          ${rv ? `<span class="row-value${r !== null ? '' : ' na'}">${rv}</span>` : '<span class="row-value na">No value</span>'}</div>
          <div class="row-note">${rn}</div></div>`}
        <div class="section-title">Buses</div>
        <div class="nb-row"><span>Buses stopping nearby, 7 to 9 a.m.</span><strong>${sv ? fmt.format(sv.peak) : wait}</strong></div>
        ${where ? `<div class="sel-routes">${where}</div>` : ''}
      </div>`;
  }
  // the panel shows the block group under the pointer, else the selected one, else the call to select one
  function renderCard() {
    const el = $('r-sel');
    const g = hoverG || (sel ? sel.g : '');
    // one way back, in one place, hovering or not (Sierra, 2026-11-17: "when youre mousing over blocks the back to
    // national map disappears"): to the whole metro while a block group is selected, else out to the country
    $('r-back').innerHTML = sel ? `&lsaquo; Back to all of ${M.city}` : '&lsaquo; Back to the national map';
    if (!g) { el.classList.remove('on'); el.innerHTML = ''; $('r-clickhint').classList.remove('off'); return; }
    el.innerHTML = cardHTML(g, !!sel && sel.g === g);
    el.classList.add('on');
    $('r-clickhint').classList.add('off');
  }
  // the selected block group in the address, as "bg=" beside the view that MapLibre writes, as on the Access tab
  function writeBg(g) {
    const parts = location.hash.replace(/^#/, '').split('&').filter((x) => x && !x.startsWith('bg='));
    if (g) parts.push(`bg=${g}`);
    history.replaceState(history.state, '', `${location.pathname}${location.search}${parts.length ? `#${parts.join('&')}` : ''}`);
  }
  function pick(g) {
    const sv = serving(g);   // null while the stop calls load: the routes, stops and vehicles follow when they come in
    writeBg(g);
    sel = { g, trips: sv ? sv.trips : null, routes: sv ? sv.routes : [], stops: sv ? sv.stops : [], tag: null };
    const feat = M.bgFeat.get(g);
    if (feat) { const b = bboxOf(feat.geometry); sel.tag = [(b[0][0] + b[1][0]) / 2, b[1][1]]; }
    applySel();
    renderCard();
    WR.showCard(() => $('r-sel'));
  }
  // what a selection draws: the block group outlined over the faded others, its routes over the faded rest (once its
  // stop calls are in), its stops, the "Selected" tag
  function applySel() {
    const g = sel.g;
    map.setFilter('r-bg-sel', ['==', ['get', 'g'], g]);
    map.setFilter('r-bg-sel-casing', ['==', ['get', 'g'], g]);
    applyRouteVis();
    map.setPaintProperty('r-routes-line', 'line-opacity', sel.trips ? 0.14 : 0.8);
    map.setPaintProperty('r-routes-tram', 'line-opacity', sel.trips ? 0.25 : 1);
    map.getSource('r-selstops').setData({ type: 'FeatureCollection', features: sel.stops
      .filter((k) => M.stops.xy[k]).map((k) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: M.stops.xy[k] } })) });
    map.setPaintProperty('r-bg-jobs', 'fill-opacity', ['case', ['==', ['get', 'g'], g], 0.95, 0.3]);
    setSelTag(sel.tag);
  }
  function unpick(home = false) {
    sel = null;
    writeBg('');
    map.setPaintProperty('r-bg-jobs', 'fill-opacity', 0.82);
    setSelTag(null);
    if (home) map.flyTo({ ...M.HOME, duration: 900 });
    map.setFilter('r-bg-sel', ['==', ['get', 'g'], '']);
    map.setFilter('r-bg-sel-casing', ['==', ['get', 'g'], '']);
    applyRouteVis();
    map.setPaintProperty('r-routes-line', 'line-opacity', 0.8);
    map.setPaintProperty('r-routes-tram', 'line-opacity', 1);
    map.getSource('r-selstops').setData(empty);
    renderCard();
  }
  // the block group an address or the Access tab selected, if it is in this metro; else none
  function select(bg) {
    const want = bg && M.bgByG.has(bg) ? bg : null;
    if (want === (sel ? sel.g : null)) return;
    if (want) pick(want); else unpick();
  }
  const setHover = (g) => { if (g !== hoverG) { hoverG = g; map.setFilter('r-bg-hover', ['==', ['get', 'g'], g]); renderCard(); } };

  // ---------- moving between the views ----------
  // one of the tab's own camera moves; the zoom handlers wait for its end. The minimum zoom drops to 2 for the flight,
  // as on the routes page.
  let flightId = 0;
  function move(start) {
    const id = ++flightId;
    moving = true;
    map.setMinZoom(2);
    const done = () => { if (id === flightId) { moving = false; map.setMinZoom(2.5); } };
    start();   // a move already under way ends here first, with its own moveend
    if (!map.isMoving()) { done(); return Promise.resolve(); }
    return new Promise((res) => map.once('moveend', () => { done(); res(); }));
  }
  // the metro view's marks that move or follow the pointer leave the map; the files stay in memory
  function clearMarks() {
    stopLoop();
    if (overlay) overlay.setProps({ layers: [] });
    tip.remove();
    setSelTag(null);
    if (hoverG) { hoverG = ''; if (map.getLayer('r-bg-hover')) map.setFilter('r-bg-hover', ['==', ['get', 'g'], '']); }
    map.getCanvas().style.cursor = '';
  }
  // a new address for a new view; the address left keeps the view it had before the move away (MapLibre writes the
  // view at the end of every move into the current address, so a flight's end would otherwise overwrite it)
  function pushAddress(url, before) {
    if (before) history.replaceState(history.state, '', before);
    history.pushState(null, '', url);
  }

  async function showNational({ push = false, before = null } = {}) {
    const token = ++nav;
    stayNav = 0;
    if (!natBuilt) setLoading(true);
    try { await buildNational(); } catch (err) {
      console.error(err);
      if (token === nav && active) setLoading(true, `The routes could not be loaded (${err.message}).`);
      return;
    }
    if (token !== nav || !active) return;
    clearMarks();
    showMetroLayers(false);
    view = 'national';
    sel = null;
    resetSettings();
    vis(['r-metro-dots'], true);
    nationalPanel();
    setLoading(false);
    if (push) pushAddress(`routes.html#${WR.viewParam()}`, before);
  }

  // a metro opens: 'fly' flies to its view, as the Access tab's metros open; 'flyTo' flies to a given camera (a search);
  // 'switch' (from the Access tab) flies to its view unless the map is over it close up; 'jump' (an address opened or
  // returned to) jumps there instead; 'stay' leaves the map where it is (a zoom past the metro scale)
  async function openMetro(slug, { bg = null, how = 'stay', camera = null, push = false, keep = false } = {}) {
    const rec = metros.find((m) => m.slug === slug);
    if (!rec || !have.has(slug)) return;
    const token = ++nav;
    stayNav = how === 'stay' ? token : 0;
    const before = push ? WR.hereURL() : null;
    natTip.remove();
    const asLeft = keep && view === 'metro' && M && M.slug === slug;   // back from the Access tab to the metro it left
    const ready = asLeft ? null : Promise.all([load(slug), loadDeck()]);
    let flight = Promise.resolve();
    // flights at the Access tab's speed (app.js, FLY_SPEED)
    if (how === 'fly' || (how === 'switch' && !kept(rec))) flight = move(() => map.flyTo({ ...homeOf(rec), speed: WR.FLY_SPEED }));
    else if (how === 'flyTo') flight = move(() => map.flyTo({ ...camera, speed: WR.FLY_SPEED }));
    else if (how === 'jump' && !kept(rec)) { quiet += 1; map.jumpTo(homeOf(rec)); quiet -= 1; }
    if (asLeft) {   // as it was: its clock, Play or Pause, boxes and selection
      reshow();
      select(bg);
      setLoading(false);
      startLoop();
      return;
    }
    await flight;
    if (token !== nav || !active) return;
    setLoading(true);   // while the files are still coming; cleared at once below when they are in
    let next;
    try { [next] = await ready; } catch (err) {
      console.error(err);
      if (token === nav && active) setLoading(true, `This metro's schedules could not be loaded (${err.message}).`);
      return;
    }
    if (token !== nav || !active) return;
    stayNav = 0;
    fill(next);
    if (push) pushAddress(`routes.html?metro=${slug}#${WR.viewParam()}`, before);
    select(bg);
    setLoading(false);
    startLoop();
  }
  // a metro's files go on the map and in the panel, fresh: 7:00 a.m., every box checked, nothing selected
  function fill(next) {
    clearMarks();
    vis(['r-metro-dots'], false);
    M = next;
    if (!layersMade) makeLayers(M);
    else { map.getSource('r-bg').setData(M.bgfc); map.getSource('r-routes').setData(M.routes); }
    map.getSource('r-selstops').setData(empty);
    ['r-bg-hover', 'r-bg-sel-casing', 'r-bg-sel'].forEach((id) => map.setFilter(id, ['==', ['get', 'g'], '']));
    map.setPaintProperty('r-bg-jobs', 'fill-opacity', 0.82);
    map.setPaintProperty('r-routes-line', 'line-opacity', 0.8);
    map.setPaintProperty('r-routes-tram', 'line-opacity', 1);
    sel = null;
    hoverG = '';
    M.HOME = homeOf(M.rec);
    // the smallest marks are sized for the view out to a little past the whole metro (its whole box, as before the
    // metros opened on their residents)
    M.zl = Math.min(homeOf(M.rec, M.rec.bbox).zoom - 0.6, map.getZoom(), 9.9);
    resetSettings();
    view = 'metro';
    showMetroLayers(true);
    metroPanel();
  }
  // the metro left for the Access tab comes back as it was: its clock, Play or Pause, and boxes
  function reshow() {
    vis(['r-metro-dots'], false);
    view = 'metro';
    showMetroLayers(true);
    if (sel) applySel();   // with anything its stop calls added while the tab was away
    metroPanel();
  }

  // ---------- the pointer and the keys ----------
  const natTip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'bg-tip', offset: 12 });
  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'bg-tip', offset: 14, maxWidth: '280px' });
  // a pointer near a circle counts as on it, the nearest circle winning, as on the Access tab (Sierra, 2026-11-17: "the
  // tiny circles are kind of hard to click, can you loosen the precision or something so if you click near it still
  // opens"): within 8 px of a circle's edge, 14 px on a touch screen; a pointer on a circle takes that circle, as before.
  // The radius as the layer draws it (3 + 6 size at zoom 3, 5 + 10 size at zoom 7), plus its 1.25 px outline.
  const radius = (z, s) => 3 + 6 * s + Math.min(1, Math.max(0, (z - 3) / 4)) * (2 + 4 * s) + 1.25;
  function dotAt(pt) {
    if (!map.getLayer('r-metro-dots')) return null;
    const on = map.queryRenderedFeatures(pt, { layers: ['r-metro-dots'] });
    if (on.length) return on[0].properties;
    const tol = coarse.matches ? 14 : 8, z = map.getZoom();
    let best = null, bestD = Infinity;
    for (const f of map.queryRenderedFeatures([[pt.x - tol, pt.y - tol], [pt.x + tol, pt.y + tol]], { layers: ['r-metro-dots'] })) {
      const c = map.project(f.geometry.coordinates);
      const d = Math.hypot(c.x - pt.x, c.y - pt.y) - radius(z, f.properties.size);
      if (d <= tol && d < bestD) { best = f.properties; bestD = d; }
    }
    return best;
  }
  map.on('mousemove', (e) => {
    if (!active) return;
    if (view === 'national') {
      const p = dotAt(e.point);
      if (!p) { map.getCanvas().style.cursor = ''; natTip.remove(); return; }
      map.getCanvas().style.cursor = 'pointer';
      natTip.setLngLat(e.lngLat).setHTML(`${p.name}<span>${fmt.format(p.n)} ${p.n === 1 ? 'bus or train' : 'buses and trains'} running at 8 a.m.; ${fmt.format(p.d)} jobs per square mile in its central business district</span><span class="act">Select to see its routes and buses</span>`).addTo(map);
      return;
    }
    if (view !== 'metro') return;
    // a label at the pointer: a route, or the block group under it and what selecting it does
    const layers = ['r-routes-hi', 'r-routes-line', 'r-routes-tram', 'r-bg-hit'].filter((id) => map.getLayoutProperty(id, 'visibility') !== 'none');
    const f = map.queryRenderedFeatures(e.point, { layers });
    const r = f.find((x) => x.layer.id.startsWith('r-routes'));
    const b = f.find((x) => x.layer.id === 'r-bg-hit');
    const g = b ? b.properties.g : '';
    setHover(g);
    map.getCanvas().style.cursor = g ? 'pointer' : '';
    let html = null;
    if (r) {
      const p = r.properties, n = Math.round(p.tph_route * 2);
      const every = p.tph_route >= 1 ? `, about every ${Math.round(60 / p.tph_route)} minutes` : '';
      html = `${p.agency} ${p.name || ''}${p.long ? ` &middot; ${p.long}` : ''}<span>${n} ${n === 1 ? 'trip' : 'trips'} from 7 to 9 a.m. in its busier direction${every}</span>`;
    } else if (g) {
      const p = M.bgByG.get(g) || {};
      const act = sel && sel.g === g ? `Select again to go back to all of ${M.city}` : 'Select to see its nearby buses';
      html = `${p.jobs == null ? 'No' : fmt.format(p.jobs)} jobs in this block group<span>${p.dens == null ? '' : `${fmt.format(p.dens)} per square mile, `}${M.meta.jobs_year}</span><span class="act">${act}</span>`;
    }
    if (html) tip.setLngLat(e.lngLat).setHTML(html).addTo(map); else tip.remove();
  });
  map.on('mouseout', () => { if (active && view === 'national') { map.getCanvas().style.cursor = ''; natTip.remove(); } });
  map.getCanvas().addEventListener('mouseleave', () => {
    if (!active || view !== 'metro') return;
    tip.remove(); setHover(''); map.getCanvas().style.cursor = '';
  });
  map.on('click', (e) => {
    if (!active) return;
    if (view === 'national') {
      const p = dotAt(e.point);
      if (p) openMetro(p.slug, { how: 'fly', push: true });
      return;
    }
    if (view !== 'metro') return;
    const f = map.queryRenderedFeatures(e.point, { layers: ['r-bg-hit'] })[0];
    if (!f) { unpick(); return; }
    if (sel && sel.g === f.properties.g) { unpick(true); return; }
    pick(f.properties.g);
    // zoom in a little when the map is zoomed out, keeping the clicked spot under the pointer, as on the Access tab
    if (map.getZoom() < CLICK_ZOOM - 0.5) map.easeTo({ zoom: CLICK_ZOOM, around: e.lngLat, duration: 600 });
  });
  // zooming in past the metro scale opens the metro under the middle of the map, as the Access tab loads it; zooming out
  // past it from a metro goes back to the national map (Sierra, 2026-11-17: "i think we can scroll all the way to the
  // national view preferable")
  map.on('zoomend', () => {
    if (!active || moving || quiet) return;
    const z = map.getZoom();
    if (view === 'national') {
      if (z < 8) {   // back out before the metro's files came in: it does not open
        if (stayNav && stayNav === nav) { nav += 1; stayNav = 0; setLoading(false); }
        return;
      }
      const c = map.getCenter();
      const hit = metroAt(c.lng, c.lat);
      if (hit) openMetro(hit.slug, { how: 'stay', push: true });
    } else if (view === 'metro' && z < LOAD_ZOOM) {
      showNational({ push: true });
    }
  });
  // Panning a metro over another one opens that one where the map is, as zooming in does from the national map
  // (Sierra, 2026-11-19: "its weird i can be in philly, drag over to ny and then ny doesnt load"; asked "Build the
  // routes tab opening the metro you pan into?": "Yes, build it"): when the middle of the map, at the metro scale,
  // has left the metro shown and lies in another. Still one metro at a time, so only its files load.
  map.on('moveend', () => {
    if (!active || moving || quiet || view !== 'metro' || !M || !M.rec.bbox || map.getZoom() < 8) return;
    const c = map.getCenter();
    if (inBox(M.rec.bbox, c.lng, c.lat)) return;
    const hit = metroAt(c.lng, c.lat);
    if (hit && hit.slug !== M.slug) openMetro(hit.slug, { how: 'stay', push: true });
  });
  document.addEventListener('keydown', (e) => {
    if (!active || view !== 'metro') return;
    // while a window or the walkthrough is open, Esc and Space are its own: Esc closes it and leaves the selection
    // (Sierra, 2026-11-19: "Yes, fix it", after a first-time visitor's read found Esc clearing the block group)
    if (e.defaultPrevented || document.querySelector('dialog[open]') || !document.getElementById('tour').hidden) return;
    if (e.key === 'Escape' && sel) unpick(true);
    if (e.code === 'Space' && !['INPUT', 'SELECT'].includes(e.target.tagName)) { e.preventDefault(); setPlaying(!playing); }
  });

  // ---------- the panel's controls ----------
  // out to the country with the map's own motion, as on the Access tab, then the national view opens there; while a
  // block group is selected, back to the whole metro
  $('r-back').addEventListener('click', () => {
    if (!active || view !== 'metro') return;
    if (sel) { unpick(true); return; }
    const token = ++nav;
    const before = WR.hereURL();
    move(() => map.fitBounds(US_BOUNDS, { padding: 30 })).then(() => {
      if (token === nav && active) showNational({ push: true, before });
    });
  });
  $('r-sel').addEventListener('click', (e) => {
    if (e.target.closest('#r-sel-x')) unpick();   // the Access tab's clear button: the block group goes, the view stays
  });
  setPlaying(playing);                        // shows Play when the device reduces motion
  play.addEventListener('click', () => setPlaying(!playing));
  scrub.addEventListener('input', () => { T = Number(scrub.value); });
  $('r-t-bus').addEventListener('change', (e) => { show.bus = e.target.checked; applyRouteVis(); });
  $('r-t-rail').addEventListener('change', (e) => { show.rail = e.target.checked; applyRouteVis(); });
  $('r-t-route').addEventListener('change', (e) => { show.routes = e.target.checked; applyRouteVis(); });

  // ---------- the address search, as on the Access tab: a place in the metro shown selects its block group; a place
  // in another metro opens that metro there ----------
  async function search(q) {
    setStatus('Searching…');
    try {
      await base;
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=' + encodeURIComponent(q);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`search: HTTP ${res.status}`);
      const hits = await res.json();
      if (!active) return;
      if (!hits.length) { setStatus('No match found.'); return; }
      const lng = Number(hits[0].lon), lat = Number(hits[0].lat);
      const m = metroAt(lng, lat);
      if (!m) { setStatus('That place is outside the mapped metros.'); return; }
      setStatus('');
      // the block group at the place is selected, in the metro shown or in the one the search opens (Sierra,
      // 2026-11-19: "the search thing should highlight a bg", after a first-time visitor's read found that a search
      // from another view opened the metro and selected nothing)
      const pickHere = () => {
        if (!active || view !== 'metro' || !M || M.slug !== m.slug) return;
        const f = map.queryRenderedFeatures(map.project([lng, lat]), { layers: ['r-bg-hit'] })[0];
        if (f) pick(f.properties.g); else setStatus('No block group at that spot.');
      };
      if (view === 'metro' && M && m.slug === M.slug) {
        map.flyTo({ center: [lng, lat], zoom: SEARCH_ZOOM, speed: WR.FLY_SPEED });
        map.once('moveend', pickHere);
        return;
      }
      await openMetro(m.slug, { how: 'flyTo', camera: { center: [lng, lat], zoom: SEARCH_ZOOM }, push: true });
      if (active && view === 'metro' && M && M.slug === m.slug) map.once('idle', pickHere);   // once its block groups are drawn
    } catch (err) {
      console.error(err);
      setStatus('Search is not available right now.');
    }
  }

  // ---------- what app.js calls ----------
  // The tab is shown: the view of its address. how: 'landing' (routes.html opened), 'switch' (from the Access tab) or
  // 'history' (Back or Forward, with the view of the address returned to); fromOther: coming from the Access tab.
  async function showTab({ how = 'landing', fromOther = false, view: v = null } = {}) {
    active = true;
    const token = ++nav;
    if (v) { quiet += 1; map.jumpTo(v); quiet -= 1; }
    try { await base; } catch (err) {
      console.error(err);
      if (token === nav && active) setLoading(true, 'The routes could not be loaded.');
      return;
    }
    if (token !== nav || !active) return;
    // an address returned to with Back names its metro, or none for the national map; a link or the Access tab may
    // name the metro by its view alone
    const t = target(how !== 'history');
    if (!t.slug) { showNational(); return; }
    openMetro(t.slug, { bg: t.bg, how: how === 'switch' ? 'switch' : 'jump', keep: fromOther && t.slug === keptSlug });
  }
  // The Access tab is shown: the clock stops and the layers hide; the metro, its clock, boxes and selection wait for
  // the way back.
  function hideTab() {
    active = false;
    nav += 1;   // a navigation still loading stops here
    stayNav = 0;
    keptSlug = view === 'metro' && M ? M.slug : null;
    clearMarks();
    natTip.remove();
    vis(['r-metro-dots'], false);
    showMetroLayers(false);
    setLoading(false);
    setStatus('');
    if ($('metro').options[0]) $('metro').options[0].hidden = false;
  }
  // the pointer rests on the tab's link: the files it will need start loading
  function warm(slug) {
    base.then(() => {
      if (slug && have.has(slug)) { load(slug).catch(() => {}); loadDeck().catch(() => {}); }
      else buildNational().catch(() => {});
    }, () => {});
  }
  WR.routes = {
    show: showTab,
    hide: hideTab,
    state: () => ({ bg: sel ? sel.g : null }),
    search,
    choose: (slug) => { if (slug && active) base.then(() => openMetro(slug, { how: 'fly', push: true })); },
    warm,
  };
})();
