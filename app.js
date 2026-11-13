/* Within Reach: access to jobs and essential services by transit and car.
   Layer 1: the metros and the block-group boundaries (data/metros.json, data/bg/<metro>.json; build_layer1b.py).
   Layer 2: block-group characteristics for the filters and the card (data/acs/<metro>.json; build_layer2_acs.py).
   Layer 4: jobs and the essential services reachable by each mode within 15, 30, 45 or 60 minutes, chosen with
   the slider (data/times/index.json, data/times/<metro>.json; build_layer4_times.py). It replaced, for the page,
   the 30-minute jobs values of layer 1 and the 45-minute service values of layer 3 (data/svc/). */
(() => {
  'use strict';

  // Orange (fewest) to blue (most), one scheme for every layer (Sierra, 2026-11-12). Lightness falls in even
  // steps on each side of the median, as in the first palette (red to teal); OKLCH hues 50 and 252 (design.md).
  const PALETTE = ['#844010', '#b0591f', '#c8825b', '#daac94', '#e5d8d0',
                   '#d3dce6', '#9dbbdd', '#6999cf', '#3877ba', '#115697'];
  const NO_VALUE = '#d6d8db';
  // Car vs. transit: transit reaches none while a car reaches some. A mid gray, not black: for hospitals and community
  // colleges most block groups are in this group, and black buried the ramp.
  const NONE_TRANSIT = '#8c8f96';
  const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
  const US_BOUNDS = [[-124.8, 24.4], [-66.9, 49.4]];
  const LOAD_ZOOM = 6.5;   // block groups load from this zoom
  const MAX_LOADED = 8;    // metros kept in memory
  const MIN_VIEW = 30;     // block groups needed on screen to rescale the colors
  const HOLD_PX = 40;      // pointer travel that releases a chosen metro's summary
  const DOTS_UNTIL = 7.3;  // zoom at which the metro circles have faded out
  const BG_FROM = 6;       // block groups fade in from this zoom and are hidden below it
  const CLICK_ZOOM = 12;   // a click on a block group zooms in to this, if the map is further out
  const FILTERED_OUT = '#9aa3a6';
  const QUARTERS = { 1: 'lowest-income quarter', 2: 'second quarter by income', 3: 'third quarter by income', 4: 'highest-income quarter' };

  // What the map counts: jobs or one of the essential services (data/times/index.json, which also holds jobs).
  const JOBS = { key: 'j', label: 'Jobs', noun: 'jobs', one: 'job' };

  const S = {
    meta: null, ix: null, layers: [JOBS], layer: 'j', tau: 30,
    bySlug: new Map(), mode: 'r', scale: 'shared', viewBreaks: null,
    loaded: new Map(), pending: new Map(), features: [], index: new Map(), tick: 0,
    hover: null, hoverProps: null, pinned: null, pinnedProps: null, hoverMetro: null,
    hold: null, onMap: false, filter: { iq: 0, zv: 0 },
  };

  const $ = (sel) => document.querySelector(sel);
  const fmt = new Intl.NumberFormat('en-US');
  const has = (v) => typeof v === 'number' && Number.isFinite(v);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const collection = (features) => ({ type: 'FeatureCollection', features });
  const setStatus = (msg) => { $('#status').textContent = msg; };
  const trimZero = (s) => s.replace(/\.0$/, '');

  const lay = () => S.layers.find((L) => L.key === S.layer) || JOBS;
  const isJobs = () => S.layer === 'j';
  // A measure's property name in the current layer and travel time ("j30t", "g15tp"); the nearest time ("gn")
  // does not depend on the travel time.
  const k = (m) => (m === 'n' ? `${S.layer}n` : `${S.layer}${S.tau}${m}`);

  function compact(v) {
    if (v >= 1e6) return trimZero((v / 1e6).toFixed(v >= 1e7 ? 0 : 1)) + 'M';
    if (v >= 1e3) return trimZero((v / 1e3).toFixed(v >= 1e4 ? 0 : 1)) + 'k';
    return v >= 10 ? String(Math.round(v)) : trimZero(v.toFixed(1));
  }
  const ratioText = (r) => (r >= 10 ? fmt.format(Math.round(r)) : r.toFixed(1));

  // Two significant figures, as in the build scripts.
  function nice(x) {
    if (x <= 0) return 0;
    const mag = Math.pow(10, Math.floor(Math.log10(x)) - 1);
    const v = Math.round(x / mag) * mag;
    return v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  }

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  // ---------- what each view shows ----------
  function title(mode) {
    const L = lay();
    if (mode === 't') return `${L.label} reachable within ${S.tau} minutes by public transit`;
    if (mode === 'c') return `${L.label} reachable within ${S.tau} minutes by car, with no traffic`;
    return `How many times more ${L.noun} a car reaches than public transit within ${S.tau} minutes`;
  }
  const ends = (mode) => (mode === 'r' ? ['Smaller car advantage', 'Larger car advantage']
    : [`Fewer ${lay().noun}`, `More ${lay().noun}`]);

  // ---------- colors ----------
  // Color classes (build_layer4_times.py). By default ("All times", S.scale 'shared') one scale serves the four
  // travel times, so a color means the same count at every time (Sierra, 2026-11-12). "This time" uses the
  // chosen time's own classes; for jobs, "This view" uses the tenths of the block groups on screen.
  const scaleKey = () => (S.scale === 'time' ? S.tau : 'all');
  const breaks = () => (isJobs() && S.scale === 'view' && S.viewBreaks) || lay().classes[scaleKey()][S.mode];

  // One color per class; with fewer than ten classes the colors are spread across the palette. On the car vs.
  // transit map the colors run the other way, so the first color marks the largest car advantage.
  function classColors() {
    const pal = S.mode === 'r' ? PALETTE.slice().reverse() : PALETTE;
    const n = breaks().length + 1;
    if (n >= pal.length) return pal.slice(0, n);
    return Array.from({ length: n }, (_, i) => pal[Math.round((i * (pal.length - 1)) / (n - 1))]);
  }

  // ---------- filters (layer 2): income quarter within the metro, share of households without a car ----------
  const filterOn = () => S.filter.iq > 0 || S.filter.zv > 0;
  const matches = (p) => (!S.filter.iq || p.iq === S.filter.iq) && (!S.filter.zv || (has(p.zv) && p.zv >= S.filter.zv));

  function matchExpr() {
    const parts = [];
    if (S.filter.iq) parts.push(['==', ['coalesce', ['get', 'iq'], 0], S.filter.iq]);
    if (S.filter.zv) parts.push(['>=', ['coalesce', ['get', 'zv'], -1], S.filter.zv]);
    return parts.length ? ['all', ...parts] : null;
  }

  function fillColor() {
    const cols = classColors();
    const prop = ['get', k(S.mode)];
    const step = ['step', ['to-number', prop], cols[0]];
    breaks().forEach((b, i) => step.push(b, cols[i + 1]));
    let color = ['case', ['==', ['typeof', prop], 'number'], step, NO_VALUE];
    if (S.mode === 'r') {
      color = ['case', ['all', ['==', ['coalesce', ['get', k('t')], -1], 0], ['>', ['coalesce', ['get', k('c')], 0], 0]],
        NONE_TRANSIT, color];
    }
    const mx = matchExpr();
    return mx ? ['case', mx, color, FILTERED_OUT] : color;
  }

  // Block groups fade in above BG_FROM, so a zoomed-out map shows only the metro circles.
  function fillOpacity() {
    const mx = matchExpr();
    return ['interpolate', ['linear'], ['zoom'], BG_FROM, 0, LOAD_ZOOM, mx ? ['case', mx, 0.88, 0.15] : 0.88];
  }

  function applyColors() {
    if (!S.meta || !map.getLayer('bg-fill')) return;
    map.setPaintProperty('bg-fill', 'fill-color', fillColor());
    map.setPaintProperty('bg-fill', 'fill-opacity', fillOpacity());
    renderLegend();
    renderCard();
  }

  function updateViewBreaks() {
    if (!isJobs() || S.scale !== 'view' || !map.getLayer('bg-fill')) return;
    const seen = new Set();
    const vals = [];
    for (const f of map.queryRenderedFeatures({ layers: ['bg-fill'] })) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      if (filterOn() && !matches(f.properties)) continue;   // rescale to the block groups the filter keeps
      const v = f.properties[k(S.mode)];
      if (has(v)) vals.push(v);
    }
    if (vals.length < MIN_VIEW) {
      S.viewBreaks = null;
    } else {
      vals.sort((a, b) => a - b);
      const br = [];
      for (let i = 1; i < 10; i++) {
        let b = nice(vals[Math.floor((i / 10) * vals.length)]);
        const prev = br[br.length - 1];
        if (br.length && b <= prev) b = prev + Math.max(1e-6, Math.abs(prev) * 1e-6); // breaks must increase
        br.push(b);
      }
      S.viewBreaks = br;
    }
    applyColors();
  }

  // ---------- legend ----------
  function renderLegend() {
    if (!S.meta || !S.ix) return;
    const L = lay();
    const jobs = isJobs();
    const label = S.mode === 'r' ? (v) => `${compact(v)}&times;` : (jobs ? compact : (v) => fmt.format(v));
    const viewOn = jobs && S.scale === 'view';
    const shared = !viewOn && S.scale !== 'time';
    const cols = classColors();
    const n = cols.length;
    const zero = ((L.zero || {})[scaleKey()] || {})[S.mode];   // none is its own class (build_layer4_times.py)
    const over = shared ? 'at the four travel times together' : `in all ${S.meta.counts.metros_mapped} metros`;
    let note;
    if (viewOn) {
      note = S.viewBreaks ? 'Each color holds about a tenth of the block groups on screen.'
        : 'Zoom in to a metro to rescale the colors to the screen.';
    } else if (zero) {
      note = breaks().length === 1
        ? `The first color is none within ${S.tau} minutes, the second one or more.`
        : `The first color is none within ${S.tau} minutes; the others split the rest into groups of about equal size.`;
    } else if (S.mode === 'r' && !jobs) {
      note = `Each color holds about a tenth of the block groups that reach at least one by public transit, ${over}.`;
    } else {
      note = `Each color holds about a tenth of the block groups ${over}.`;
    }
    if (shared) note += ' The colors are the same at every travel time.';
    if (S.mode === 'r') note += ` Dark gray: none by public transit within ${S.tau} minutes.`;
    if (filterOn()) note += ' Block groups outside the filter are faded.';
    const [low, high] = ends(S.mode);
    $('#legend').innerHTML = `
      <div class="lg-title">${title(S.mode)}</div>
      <div class="lg-bar">${cols.map((c) => `<span style="background:${c}"></span>`).join('')}</div>
      <div class="lg-ticks">${breaks().map((b, i) => `<span style="left:${((i + 1) / n) * 100}%">${label(b)}</span>`).join('')}</div>
      <div class="lg-ends"><span>${low}</span><span>${high}</span></div>
      <div class="lg-controls">
        <span class="lg-label">Colors</span>
        <div class="seg small" role="group" aria-label="Color scale">
          <button type="button" data-scale="shared" aria-pressed="${shared}">All times</button>
          <button type="button" data-scale="time" aria-pressed="${!viewOn && !shared}">This time</button>
          ${jobs ? `<button type="button" data-scale="view" aria-pressed="${viewOn}">This view</button>` : ''}
        </div>
        <span class="lg-keys">
          ${S.mode === 'r' ? `<span class="lg-key"><i style="background:${NONE_TRANSIT}"></i>None by public transit</span>` : ''}
          <span class="lg-key"><i style="background:${NO_VALUE}"></i>No value</span>
        </span>
      </div>
      <div class="lg-note">${note}</div>`;
  }

  // ---------- the cards ----------
  const shortName = (name) => name.split(/[-,/]/)[0].trim();
  const andList = (a) => (a.length < 3 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const median = (a) => {
    if (!a.length) return NaN;
    const s = a.slice().sort((x, y) => x - y);
    const i = s.length >> 1;
    return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
  };

  // The census values of a block group (layer 2): population and density, income, its quarter within the metro,
  // car-free households.
  function neighborhoodHTML(p, metro) {
    if (!has(p.inc) && !has(p.zv) && !has(p.pop)) {
      return '<div class="row-note nb-none">The census reports no values for this block group.</div>';
    }
    const q = has(p.iq) ? `In the ${QUARTERS[p.iq]} of the ${esc(metro)} metro's block groups` : '';
    return `<div class="nb">
        <div class="nb-row"><span>Population</span><strong>${has(p.pop) ? fmt.format(p.pop) : 'Not reported'}</strong></div>
        <div class="nb-row"><span>People per square mile</span><strong>${has(p.dens) ? fmt.format(p.dens) : 'Not reported'}</strong></div>
        <div class="nb-row"><span>Median household income</span><strong>${has(p.inc) ? `$${fmt.format(p.inc)}` : 'Not reported'}</strong></div>
        ${q ? `<div class="row-note">${q}</div>` : ''}
        <div class="nb-row"><span>Share of households without a car</span><strong>${has(p.zv) ? `${trimZero(p.zv.toFixed(1))}%` : 'Not reported'}</strong></div>
      </div>`;
  }

  // With a filter on, the metro card counts the matching block groups of a loaded metro.
  function filterSummary(m) {
    const loaded = S.loaded.get(m.slug);
    if (!loaded) return '<div class="fsum">Zoom in to the metro to count the block groups that match the filter.</div>';
    const all = loaded.features.map((f) => f.properties);
    if (!all.some((p) => has(p.iq) || has(p.zv))) {
      return '<div class="fsum">The data have no census values for this metro, so the filter matches none of its block groups.</div>';
    }
    const sel = all.filter(matches);
    if (!sel.length) return '<div class="fsum">No block group in this metro matches the filter.</div>';
    const t = median(sel.map((p) => p[k('t')]).filter(has));
    const c = median(sel.map((p) => p[k('c')]).filter(has));
    return `<div class="fsum"><strong>${fmt.format(sel.length)}</strong> of ${fmt.format(all.length)} block groups match the
      filter. Their median: ${has(t) ? fmt.format(Math.round(t)) : 'no'} ${lay().noun} by public transit${has(c) ? `, ${fmt.format(Math.round(c))} by car` : ''}.</div>`;
  }

  function tractLabel(t) {
    const whole = parseInt(t.slice(0, 4), 10);
    const part = t.slice(4);
    return part === '00' ? String(whole) : `${whole}.${part}`;
  }

  // `where(pct, value)` gives the note under a value (within the metro, or among metros).
  // The Lowest-Median-Highest bar shows only for a block group, not at the metro level.
  function jobsRow(key, label, v, pct, where, missing, bar = true) {
    const sel = S.mode === key ? ' selected' : '';
    if (!has(v)) {
      return `<div class="row${sel}"><div class="row-top"><span class="row-label">${label}</span>
        <span class="row-value na">Not available</span></div><div class="row-note">${missing}</div></div>`;
    }
    const note = has(pct) ? where(pct, v) : '';
    return `<div class="row${sel}">
      <div class="row-top"><span class="row-label">${label}</span><span class="row-value">${fmt.format(v)}</span></div>
      ${bar && has(pct) ? `<div class="gauge" aria-hidden="true"><span class="med"></span><span class="mark" style="left:${Math.min(100, Math.max(0, pct))}%"></span></div>
      <div class="gauge-labels" aria-hidden="true"><span>Lowest</span><span>Median</span><span>Highest</span></div>` : ''}
      <div class="row-note">${note}</div></div>`;
  }

  function blockGroupHTML(p, isPinned) {
    const L = lay();
    const jobs = isJobs();
    const m = S.bySlug.get(p.m) || { name: '', n_c: 1 };
    const g = String(p.g);
    const metro = shortName(m.name);
    const inMetro = (x, v) => (!jobs && v === 0 ? `None within ${S.tau} minutes`
      : x === 0 ? `The lowest in the ${esc(metro)} metro`
      : `Higher than ${x}% of block groups in the ${esc(metro)} metro`);
    const state = S.meta.states[g.slice(0, 2)] || '';
    const t = p[k('t')];
    const c = p[k('c')];
    const r = p[k('r')];
    let rv = null;
    let rn;
    if (has(r)) {
      rv = `${ratioText(r)}&times;`;
      rn = r >= 1 ? `A car reaches ${ratioText(r)} times as many ${L.noun} as public transit.`
        : `Public transit reaches more ${L.noun} than a car here.`;
    } else if (t === 0 && has(c) && c > 0) {
      rv = 'None by public transit';
      rn = `Public transit reaches none within ${S.tau} minutes; a car reaches ${fmt.format(c)}.`;
    } else if (t === 0) {
      rn = `Neither mode reaches ${jobs ? 'any jobs' : `a ${L.one}`} within ${S.tau} minutes.`;
    } else {
      rn = 'This needs both a public transit and a car value.';
    }
    const near = jobs ? '' : `<div class="nb-row near"><span>Nearest ${L.one} by public transit</span>
        <strong>${!has(p[k('n')]) ? 'None within 90 minutes' : p[k('n')] === 0 ? 'In this block group' : `${p[k('n')]} minutes`}</strong></div>`;
    return `<div class="card card-bg">
      <div class="card-head">
        <span class="level level-bg">Block group</span>
        <div class="place">Block group ${g.slice(11)}, tract ${tractLabel(g.slice(5, 11))}, ${esc(state)}</div>
        <div class="kicker">${esc(m.name)}</div>
        ${filterOn() && !matches(p) ? '<div class="out-note">Outside the filter</div>' : ''}
        ${isPinned ? '<button type="button" class="unpin" aria-label="Clear the selected block group">&times;</button>' : ''}
      </div>
      <div class="section-title">${L.label} within ${S.tau} minutes</div>
      ${jobsRow('t', 'By public transit', t, p[k('tp')], inMetro, 'No public transit value for this block group.')}
      ${jobsRow('c', 'By car, no traffic', c, p[k('cp')], inMetro,
        m.n_c === 0 ? 'This metro has no car travel times.' : 'No car value for this block group.')}
      <div class="row${S.mode === 'r' ? ' selected' : ''}">
        <div class="row-top"><span class="row-label">Car vs. public transit</span>
          ${rv ? `<span class="row-value${has(r) ? '' : ' na'}">${rv}</span>` : '<span class="row-value na">No value</span>'}</div>
        <div class="row-note">${rn}</div>
      </div>
      ${near}
      <div class="section-title">Neighborhood, 2018–22</div>
      ${neighborhoodHTML(p, metro)}
    </div>`;
  }

  function metroAt(lng, lat) {
    const hits = S.meta.metros.filter((m) => lng >= m.bbox[0] && lng <= m.bbox[2] && lat >= m.bbox[1] && lat <= m.bbox[3]);
    const area = (m) => (m.bbox[2] - m.bbox[0]) * (m.bbox[3] - m.bbox[1]);
    hits.sort((a, b) => (b.mapped - a.mapped) || (area(a) - area(b)));
    return hits[0] || null;
  }

  function metroAtCenter() {
    if (map.getZoom() < LOAD_ZOOM - 0.5) return null;
    const c = map.getCenter();
    if (map.getLayer('bg-fill')) {
      const fs = map.queryRenderedFeatures(map.project(c), { layers: ['bg-fill'] });
      if (fs.length && S.bySlug.has(fs[0].properties.m)) return S.bySlug.get(fs[0].properties.m);
    }
    return metroAt(c.lng, c.lat);
  }

  function summaryHTML() {
    if (!S.meta || !S.ix) return '';
    const m = S.hoverMetro || metroAtCenter();
    if (!m) return '<p class="hint">Choose a metro or search for an address, then hover over a neighborhood.</p>';
    if (!m.mapped) {
      return `<div class="card card-metro">
        <div class="card-head"><span class="level level-metro">Metro overview</span>
          <div class="place">${esc(m.name)}</div></div>
        <p class="hint">This metro is not on the map. Its latest usable public transit schedules are from
        ${m.latest_usable_year}, and the map starts at ${S.meta.year_min}.</p>
      </div>`;
    }
    const L = lay();
    const jobs = isJobs();
    const sm = S.ix.metros[m.slug][S.layer];
    const sv = sm[S.tau];   // the metro's median block group and its ranks, at the chosen travel time
    const q = m.quarters.length;
    const asOf = jobs
      ? (m.jobs_year < S.meta.year_car
        ? `Jobs are from ${m.jobs_year}, the latest year the Census Bureau publishes for this state.`
        : `Jobs are from ${m.jobs_year}.`)
      : `${L.label} as of ${Math.min(m.year, L.car_last_year)}.`;
    const nWith = (key) => Object.values(S.ix.metros).filter((v) => has(v[S.layer][S.tau].median[key])).length;
    const among = (key) => (x, v) => (!jobs && v === 0 ? `The median block group reaches none within ${S.tau} minutes`
      : x === 0 ? `The lowest of the ${nWith(key)} metros`
      : `Higher than in ${x}% of the ${nWith(key)} metros`);
    const r = sv.median.r;
    let rNote;
    if (!has(r)) rNote = m.n_c === 0 ? 'This metro has no car travel times.' : `No block group reaches one by public transit within ${S.tau} minutes.`;
    else rNote = (sv.pct.r === 0 ? `The smallest car advantage of the ${nWith('r')} metros`
      : `A larger car advantage than in ${sv.pct.r}% of the ${nWith('r')} metros`)
      + (jobs ? '' : ', among block groups that reach at least one by public transit');
    const extra = jobs ? '' : `<p class="facts">${sv.reach}% of block groups reach at least one ${L.one} by public transit within
      ${S.tau} minutes. ${has(sm.near) ? `Where one is within 90 minutes, the median trip to the nearest takes ${sm.near} minutes.`
      : `No block group has one within 90 minutes by public transit.`}</p>`;
    return `<div class="card card-metro">
      <div class="card-head"><span class="level level-metro">Metro overview</span>
        <div class="place">${esc(m.name)}</div></div>
      <div class="section-title">${L.label} within ${S.tau} minutes, median block group</div>
      ${jobsRow('t', 'By public transit', sv.median.t, sv.pct.t, among('t'), 'No public transit values for this metro.', false)}
      ${jobsRow('c', 'By car, no traffic', sv.median.c, sv.pct.c, among('c'), 'This metro has no car travel times.', false)}
      <div class="row${S.mode === 'r' ? ' selected' : ''}">
        <div class="row-top"><span class="row-label">Car vs. public transit</span>
          ${has(r) ? `<span class="row-value">${ratioText(r)}&times;</span>` : '<span class="row-value na">No value</span>'}</div>
        <div class="row-note">${rNote}</div>
      </div>
      ${extra}
      ${filterOn() ? filterSummary(m) : ''}
      <p class="facts">${fmt.format(m.n_bg)} block groups. Public transit times use ${q === 4 ? 'all four' : q} quarter${q === 1 ? '' : 's'}
      of ${m.year} schedules. ${asOf}</p>
    </div>
    <p class="hint">Hover over a block group to compare it with the rest of the metro. Click one to keep it here.</p>`;
  }

  function renderCard() {
    const p = S.hoverProps || S.pinnedProps;
    $('#card').innerHTML = p ? blockGroupHTML(p, !S.hoverProps && !!S.pinnedProps) : summaryHTML();
  }

  function pin(id, props) {
    if (S.pinned !== null) map.setFeatureState({ source: 'bgs', id: S.pinned }, { pinned: false });
    S.pinned = id;
    S.pinnedProps = { ...props };
    map.setFeatureState({ source: 'bgs', id }, { pinned: true });
    renderCard();
  }

  function unpin() {
    if (S.pinned !== null) map.setFeatureState({ source: 'bgs', id: S.pinned }, { pinned: false });
    S.pinned = null;
    S.pinnedProps = null;
    renderCard();
  }

  // ---------- loading metros ----------
  function rebuild() {
    S.features = [];
    S.index.clear();
    for (const { features } of S.loaded.values()) {
      for (const f of features) {
        f.id = S.features.length;
        S.index.set(f.properties.g, f.id);
        S.features.push(f);
      }
    }
    map.removeFeatureState({ source: 'bgs' });
    map.getSource('bgs').setData(collection(S.features));
    S.hover = null;
    S.hoverProps = null;
    S.pinned = S.pinnedProps ? (S.index.has(S.pinnedProps.g) ? S.index.get(S.pinnedProps.g) : null) : null;
    if (S.pinned !== null) map.setFeatureState({ source: 'bgs', id: S.pinned }, { pinned: true });
    if (S.scale === 'view') map.once('idle', updateViewBreaks);
  }

  function evict() {
    if (S.loaded.size <= MAX_LOADED) return;
    const oldest = [...S.loaded.entries()].sort((a, b) => a[1].used - b[1].used);
    while (S.loaded.size > MAX_LOADED) S.loaded.delete(oldest.shift()[0]);
  }

  // Joins a metro's census values (layer 2) and service values (layer 3) to its block groups.
  function joinLayers(pr, acs, times) {
    // [median household income, income quarter in the metro, % of households without a car, population,
    //  people per square mile]
    const a = acs[pr.g];
    if (a) {
      if (a[0] !== null) pr.inc = a[0];
      if (a[1] !== null) pr.iq = a[1];
      if (a[2] !== null) pr.zv = a[2];
      if (a.length > 3 && a[3] !== null) pr.pop = a[3];
      if (a.length > 4 && a[4] !== null) pr.dens = a[4];
    }
    // Every layer at every travel time, named by the index's fields ("j30t", "g15tp", ..., "gn"); the ratio is
    // computed here. The boundary files' own 30-minute job values are dropped, so nothing reads them by mistake.
    for (const x of ['t', 'c', 'r', 'tp', 'cp']) delete pr[x];
    const v = times[pr.g];
    if (v && S.ix) {
      S.ix.fields.forEach((f, i) => { if (v[i] !== null) pr[f] = v[i]; });
      S.ix.layers.forEach((L) => S.ix.taus.forEach((tau) => {
        const t = pr[`${L.key}${tau}t`];
        const c = pr[`${L.key}${tau}c`];
        if (t > 0 && has(c)) pr[`${L.key}${tau}r`] = c / t;
      }));
    }
  }

  function loadMetro(m) {
    if (S.loaded.has(m.slug)) {
      S.loaded.get(m.slug).used = ++S.tick;
      return Promise.resolve();
    }
    if (S.pending.has(m.slug)) return S.pending.get(m.slug);
    setStatus(`Loading ${m.name}…`);
    // The census layer is optional: if its file fails, the map still draws the metro.
    const optional = (url) => getJSON(url).catch((err) => { console.error(err); return {}; });
    const p = Promise.all([getJSON(`data/bg/${m.slug}.json`), optional(`data/acs/${m.slug}.json`), getJSON(`data/times/${m.slug}.json`)])
      .then(([data, acs, times]) => {
        for (const f of data.features) {
          f.properties.m = m.slug;
          joinLayers(f.properties, acs, times);
        }
        S.loaded.set(m.slug, { features: data.features, used: ++S.tick });
        evict();
        rebuild();
      })
      .catch((err) => { console.error(err); setStatus(`${m.name} could not be loaded.`); })
      .finally(() => {
        S.pending.delete(m.slug);
        if (!S.pending.size && $('#status').textContent.startsWith('Loading')) setStatus('');
        if (!S.hoverProps && !S.pinnedProps) renderCard();
      });
    S.pending.set(m.slug, p);
    return p;
  }

  function ensureMetros() {
    if (!S.meta || map.getZoom() < LOAD_ZOOM) return;
    const b = map.getBounds();
    const view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const c = map.getCenter();
    const overlaps = (a) => a[0] <= view[2] && a[2] >= view[0] && a[1] <= view[3] && a[3] >= view[1];
    S.meta.metros
      .filter((m) => m.mapped && overlaps(m.bbox))
      .sort((a, b) => Math.hypot(a.center[0] - c.lng, a.center[1] - c.lat) - Math.hypot(b.center[0] - c.lng, b.center[1] - c.lat))
      .slice(0, 6)
      .forEach(loadMetro);
  }

  function clearHover() {
    if (S.hover !== null) map.setFeatureState({ source: 'bgs', id: S.hover }, { hover: false });
    S.hover = null;
    S.hoverProps = null;
  }

  // Choosing a metro shows the metro as a whole: any kept block group is let go, and when the pointer
  // is over the map, block groups under it wait until it has clearly moved.
  function showMetro() {
    clearHover();
    S.hoverMetro = null;
    S.hold = S.onMap ? { x: null, y: null } : null;
    unpin();
  }

  const overDot = (point) => map.getLayer('metro-dots') && map.getZoom() < DOTS_UNTIL
    && map.queryRenderedFeatures(point, { layers: ['metro-dots'] }).length > 0;

  function goToMetro(m) {
    showMetro();
    const cam = map.cameraForBounds([[m.bbox[0], m.bbox[1]], [m.bbox[2], m.bbox[3]]], { padding: 40, maxZoom: 11 });
    // A metro spread over a large area (Anchorage) would fit below the zoom at which block groups load,
    // so it opens on its block groups' mean location instead.
    if (!cam || cam.zoom < LOAD_ZOOM + 0.5) map.flyTo({ center: m.center, zoom: LOAD_ZOOM + 1 });
    else map.flyTo(cam);
  }

  // ---------- panel controls ----------
  function fillMetroSelect() {
    const sel = $('#metro');
    for (const m of S.meta.metros) {
      const o = document.createElement('option');
      o.value = m.slug;
      o.textContent = m.mapped ? m.name : `${m.name} (not mapped)`;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      const m = S.bySlug.get(sel.value);
      if (m) goToMetro(m);
    });
  }

  function syncMetroSelect() {
    const m = metroAtCenter();
    $('#metro').value = m ? m.slug : '';
  }

  function fillCoverage() {
    const last = S.meta.years_transit[1];
    const nLast = S.meta.metros.filter((m) => m.mapped && m.year === last).length;
    const noCar = S.meta.metros.filter((m) => m.mapped && m.n_c === 0).map((m) => shortName(m.name));
    $('#about-coverage').textContent =
      `${S.meta.counts.metros_mapped} of the ${S.meta.counts.metros} metros in the data have usable public transit schedules in ` +
      `${S.meta.year_min} or later; each is shown at its latest such year, ${last} for ${nLast} of them. ` +
      `${andList(noCar)} ${noCar.length === 1 ? 'has' : 'have'} no car travel times.`;
  }

  // The layer toggle at the top: jobs or one of the essential services.
  function setLayer(key) {
    if (!S.ix) return;
    S.layer = key;
    document.querySelectorAll('[data-layer]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.layer === key)));
    if (key !== 'j' && S.scale === 'view') { S.scale = 'shared'; S.viewBreaks = null; }
    if (S.scale === 'view') updateViewBreaks(); else applyColors();
  }
  document.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => setLayer(b.dataset.layer)));

  // The travel-time slider: 15, 30, 45 or 60 minutes for every layer (Sierra, 2026-11-12), opening at 30.
  const tauInput = $('#tau');
  function showTau() {
    $('#tau-out').textContent = `${S.tau} minutes`;
    tauInput.setAttribute('aria-valuetext', `${S.tau} minutes`);
  }
  function setTauControl() {   // also resets a value the browser may have restored
    tauInput.max = String(S.ix.taus.length - 1);
    tauInput.value = String(S.ix.taus.indexOf(S.tau));
    tauInput.disabled = false;
    showTau();
  }
  tauInput.addEventListener('input', () => {
    if (!S.ix) return;
    const tau = S.ix.taus[Number(tauInput.value)];
    if (!tau || tau === S.tau) return;
    S.tau = tau;
    showTau();
    if (S.scale === 'view') updateViewBreaks(); else applyColors();
  });

  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    S.mode = b.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (S.scale === 'view') updateViewBreaks(); else applyColors();
  }));

  // The page opens unfiltered: all incomes, all shares (a browser may otherwise restore an earlier choice).
  $('#f-income').value = '0';
  $('#f-car').value = '0';
  ['#f-income', '#f-car'].forEach((id) => $(id).addEventListener('change', () => {
    S.filter = { iq: Number($('#f-income').value) || 0, zv: Number($('#f-car').value) || 0 };
    $('#f-income').classList.toggle('active', S.filter.iq > 0);
    $('#f-car').classList.toggle('active', S.filter.zv > 0);
    $('#filters-clear').hidden = !filterOn();
    if (S.scale === 'view') updateViewBreaks(); else applyColors();
  }));

  // The filters sit in the panel, under the view buttons (Sierra, 2026-11-12); "Clear" shows while one is on.
  $('#filters-clear').addEventListener('click', () => {
    $('#f-income').value = '0';
    $('#f-car').value = '0';
    $('#f-income').dispatchEvent(new Event('change'));
  });

  $('#legend').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scale]');
    if (!b || b.dataset.scale === S.scale) return;
    S.scale = b.dataset.scale;
    if (S.scale === 'view') updateViewBreaks();
    else { S.viewBreaks = null; applyColors(); }
  });

  $('#card').addEventListener('click', (e) => { if (e.target.closest('.unpin')) unpin(); });

  // The map options float over the map (Sierra, 2026-11-12: "like the opp atlas has the toggles floating") and
  // can be hidden; on phones they move into the panel, above the card.
  const controls = $('#controls');
  $('#controls-toggle').addEventListener('click', () => {
    const hide = !controls.classList.contains('collapsed');
    controls.classList.toggle('collapsed', hide);
    $('#controls-toggle').textContent = hide ? 'Show' : 'Hide';
    $('#controls-toggle').setAttribute('aria-expanded', String(!hide));
  });
  const phone = window.matchMedia('(max-width: 760px)');
  const placeControls = () => (phone.matches ? $('#controls-slot') : $('#stage')).appendChild(controls);
  phone.addEventListener('change', placeControls);
  placeControls();
  $('#about-open').addEventListener('click', () => $('#about').showModal());

  // The welcome window opens on every visit (Sierra, 2026-11-12); "About this map" reopens it.
  // "Contact" opens the contact page, from the panel's footer or from the welcome window.
  const welcome = $('#welcome');
  const contact = $('#contact');
  $('#welcome-open').addEventListener('click', () => welcome.showModal());
  $('#contact-open').addEventListener('click', () => contact.showModal());
  $('#welcome-contact').addEventListener('click', () => { welcome.close(); contact.showModal(); });
  welcome.showModal();

  $('#search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#q').value.trim();
    if (!q || !S.meta) return;
    setStatus('Searching…');
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=' + encodeURIComponent(q);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`search: HTTP ${res.status}`);
      const hits = await res.json();
      if (!hits.length) { setStatus('No match found.'); return; }
      const lng = Number(hits[0].lon);
      const lat = Number(hits[0].lat);
      const m = metroAt(lng, lat);
      if (!m) { setStatus('That place is outside the mapped metros.'); map.flyTo({ center: [lng, lat], zoom: 8 }); return; }
      if (!m.mapped) {
        setStatus(`${m.name} is not on the map. Its latest usable public transit schedules are from ${m.latest_usable_year}.`);
        map.flyTo({ center: [lng, lat], zoom: 10 });
        return;
      }
      setStatus('');
      await loadMetro(m);
      map.flyTo({ center: [lng, lat], zoom: 13.5 });
      map.once('idle', () => {
        const fs = map.queryRenderedFeatures(map.project([lng, lat]), { layers: ['bg-fill'] });
        if (fs.length) pin(fs[0].id, fs[0].properties);
        else setStatus('No block group at that spot.');
      });
    } catch (err) {
      console.error(err);
      setStatus('Search is not available right now.');
    }
  });

  // ---------- the map ----------
  const map = new maplibregl.Map({
    container: 'map', style: STYLE_URL, bounds: US_BOUNDS, fitBoundsOptions: { padding: 30 },
    minZoom: 2.5, maxZoom: 16, hash: 'view', attributionControl: false,
    dragRotate: false, pitchWithRotate: false, touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.getCanvasContainer().addEventListener('mouseenter', () => { S.onMap = true; });
  map.getCanvasContainer().addEventListener('mouseleave', () => { S.onMap = false; });
  // The map options take the top right, so the zoom buttons sit at the bottom right, above the credits (a
  // bottom control added later goes above one added earlier).
  map.addControl(new maplibregl.AttributionControl({
    compact: true,
    customAttribution: 'Access data: S. Arnold. Schedules include <a href="https://www.transit.land/terms" target="_blank" rel="noopener">Transitland</a> data.',
  }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.on('error', (e) => console.warn(e && e.error ? e.error.message : e));

  // The metro list and the travel-time index load alongside the basemap, so the menu and the About text fill in early.
  const metaReady = getJSON('data/metros.json').then((meta) => {
    S.meta = meta;
    meta.metros.forEach((m) => S.bySlug.set(m.slug, m));
    fillMetroSelect();
    fillCoverage();
    return meta;
  });
  // Every layer's values come from this index and the metro files it describes, so the map waits for it.
  const ixReady = getJSON('data/times/index.json').then((ix) => {
    S.ix = ix;
    S.tau = ix.tau_default;
    S.layers = ix.layers;
    document.querySelectorAll('[data-layer]').forEach((b) => { b.disabled = false; });
    setTauControl();
  });

  map.on('load', async () => {
    try {
      await metaReady;
      await ixReady;
    } catch (err) {
      console.error(err);
      setStatus('The map data could not be loaded.');
      return;
    }

    const firstSymbol = (map.getStyle().layers.find((l) => l.type === 'symbol') || {}).id;
    map.addSource('bgs', { type: 'geojson', data: collection([]) });
    map.addLayer({ id: 'bg-fill', type: 'fill', source: 'bgs', minzoom: BG_FROM,
      paint: { 'fill-color': fillColor(), 'fill-opacity': fillOpacity() } }, firstSymbol);
    map.addLayer({ id: 'bg-edge', type: 'line', source: 'bgs', minzoom: BG_FROM,
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.6,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0, 11, 0.35, 14, 0.9] } }, firstSymbol);
    map.addLayer({ id: 'bg-focus', type: 'line', source: 'bgs', minzoom: BG_FROM,
      paint: { 'line-color': '#141418',
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5,
          ['boolean', ['feature-state', 'pinned'], false], 2.5, 0] } });

    // One circle per mapped metro; metros not on the map get none.
    const shown = S.meta.metros.filter((m) => m.mapped);
    const maxN = Math.max(...shown.map((m) => m.n_bg));
    map.addSource('metros', { type: 'geojson', data: collection(shown.map((m) => ({
      type: 'Feature',
      properties: { slug: m.slug, size: Math.sqrt(m.n_bg / maxN) },
      geometry: { type: 'Point', coordinates: m.center },
    }))) });
    map.addLayer({ id: 'metro-dots', type: 'circle', source: 'metros', maxzoom: DOTS_UNTIL,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          3, ['+', 3, ['*', 6, ['get', 'size']]], 7, ['+', 5, ['*', 10, ['get', 'size']]]],
        'circle-color': PALETTE[9],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6.5, 0.95, DOTS_UNTIL, 0],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 6.5, 1, DOTS_UNTIL, 0],
      } });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    map.on('mousemove', 'metro-dots', (e) => {
      const m = S.bySlug.get(e.features[0].properties.slug);
      map.getCanvas().style.cursor = 'pointer';
      popup.setLngLat(m.center)
        .setHTML(`<strong>${esc(m.name)}</strong>Click to zoom in.`)
        .addTo(map);
      if (S.hoverMetro !== m) { S.hoverMetro = m; renderCard(); }   // the panel shows the metro as a whole
    });
    map.on('mouseleave', 'metro-dots', () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
      S.hoverMetro = null;
      renderCard();
    });
    map.on('click', 'metro-dots', (e) => {
      popup.remove();
      S.hoverMetro = null;
      goToMetro(S.bySlug.get(e.features[0].properties.slug));
    });

    map.on('mousemove', 'bg-fill', (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      if (overDot(e.point)) {   // a metro circle sits on top: the panel shows that metro
        if (S.hover !== null) { clearHover(); renderCard(); }
        return;
      }
      if (S.hold) {             // a metro was just chosen: keep its summary until the pointer moves on
        if (S.hold.x === null) { S.hold = { x: e.point.x, y: e.point.y }; return; }
        if (Math.hypot(e.point.x - S.hold.x, e.point.y - S.hold.y) < HOLD_PX) return;
        S.hold = null;
      }
      map.getCanvas().style.cursor = 'pointer';
      if (S.hover === f.id) return;
      if (S.hover !== null) map.setFeatureState({ source: 'bgs', id: S.hover }, { hover: false });
      S.hover = f.id;
      S.hoverProps = f.properties;
      map.setFeatureState({ source: 'bgs', id: f.id }, { hover: true });
      renderCard();
    });
    map.on('mouseleave', 'bg-fill', () => {
      if (S.hover !== null) map.setFeatureState({ source: 'bgs', id: S.hover }, { hover: false });
      S.hover = null;
      S.hoverProps = null;
      map.getCanvas().style.cursor = '';
      renderCard();
    });
    map.on('click', 'bg-fill', (e) => {
      const f = e.features && e.features[0];
      if (!f || overDot(e.point)) return;
      S.hold = null;
      pin(f.id, f.properties);
      // Zoom in a little when the map is zoomed out (Sierra, 2026-11-12), keeping the clicked spot under the pointer.
      if (map.getZoom() < CLICK_ZOOM - 0.5) map.easeTo({ zoom: CLICK_ZOOM, around: e.lngLat, duration: 600 });
    });

    map.on('moveend', () => {
      ensureMetros();
      syncMetroSelect();
      if (!S.hoverProps && !S.pinnedProps) renderCard();
      if (S.scale === 'view') map.once('idle', updateViewBreaks);
    });

    renderLegend();
    renderCard();
    ensureMetros();
    syncMetroSelect();
  });
})();
