/* Job access by transit and car. Layer 1: jobs reachable within 30 minutes, by mode.
   Layer 2: block-group characteristics (income, car-free households) for the filters.
   Data: data/metros.json (metro list, color breaks) and data/bg/<metro>.json (block groups), written by
   build_layer1b.py; data/acs/<metro>.json (census values by block group), written by build_layer2_acs.py. */
(() => {
  'use strict';

  // Red (fewest) to teal (most). Lightness falls in even steps on each side of the median.
  const PALETTE = ['#972622', '#bc4a41', '#d3786e', '#e1a79f', '#edd4d1',
                   '#cadfe6', '#91c0d1', '#59a1b9', '#2b8099', '#045f76'];
  const NO_VALUE = '#c9cccb';
  const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
  const US_BOUNDS = [[-124.8, 24.4], [-66.9, 49.4]];
  const LOAD_ZOOM = 6.5;   // block groups load from this zoom
  const MAX_LOADED = 8;    // metros kept in memory
  const MIN_VIEW = 30;     // block groups needed on screen to rescale the colors
  const HOLD_PX = 40;      // pointer travel that releases a chosen metro's summary
  const DOTS_UNTIL = 7.3;  // zoom at which the metro circles have faded out
  const BG_FROM = 6;       // block groups fade in from this zoom and are hidden below it
  const FILTERED_OUT = '#9aa3a6';
  const QUARTERS = { 1: 'lowest-income quarter', 2: 'second quarter by income', 3: 'third quarter by income', 4: 'highest-income quarter' };

  const MODES = {
    t: { title: 'Jobs reachable within 30 minutes by transit', low: 'Fewer jobs', high: 'More jobs', reverse: false },
    c: { title: 'Jobs reachable within 30 minutes by car, with no traffic', low: 'Fewer jobs', high: 'More jobs', reverse: false },
    r: { title: 'How many times more jobs a car reaches than transit', low: 'Smaller car advantage', high: 'Larger car advantage', reverse: true },
  };

  const S = {
    meta: null, bySlug: new Map(), mode: 'r', scale: 'all', viewBreaks: null,
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

  function compact(v) {
    if (v >= 1e6) return trimZero((v / 1e6).toFixed(v >= 1e7 ? 0 : 1)) + 'M';
    if (v >= 1e3) return trimZero((v / 1e3).toFixed(v >= 1e4 ? 0 : 1)) + 'k';
    return v >= 10 ? String(Math.round(v)) : trimZero(v.toFixed(1));
  }
  const ratioText = (r) => (r >= 10 ? fmt.format(Math.round(r)) : r.toFixed(1));

  // Two significant figures, as in build_layer1.py.
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

  // ---------- colors ----------
  const palette = () => (MODES[S.mode].reverse ? PALETTE.slice().reverse() : PALETTE);
  const breaks = () => (S.scale === 'view' && S.viewBreaks) || S.meta.scales[S.mode];

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
    const pal = palette();
    const step = ['step', ['to-number', ['get', S.mode]], pal[0]];
    breaks().forEach((b, i) => step.push(b, pal[i + 1]));
    const color = ['case', ['==', ['typeof', ['get', S.mode]], 'number'], step, NO_VALUE];
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
    if (S.scale !== 'view' || !map.getLayer('bg-fill')) return;
    const seen = new Set();
    const vals = [];
    for (const f of map.queryRenderedFeatures({ layers: ['bg-fill'] })) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      if (filterOn() && !matches(f.properties)) continue;   // rescale to the block groups the filter keeps
      const v = f.properties[S.mode];
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
    if (!S.meta) return;
    const md = MODES[S.mode];
    const label = S.mode === 'r' ? (v) => `${compact(v)}&times;` : compact;
    const viewOn = S.scale === 'view';
    const note = (viewOn
      ? (S.viewBreaks ? 'Each color holds about a tenth of the block groups on screen.'
        : 'Zoom in to a metro to rescale the colors to the screen.')
      : `Each color holds about a tenth of the block groups in all ${S.meta.counts.metros_mapped} metros.`
    ) + (filterOn() ? ' Block groups outside the filter are faded.' : '');
    $('#legend').innerHTML = `
      <div class="lg-title">${md.title}</div>
      <div class="lg-bar">${palette().map((c) => `<span style="background:${c}"></span>`).join('')}</div>
      <div class="lg-ticks">${breaks().map((b, i) => `<span style="left:${(i + 1) * 10}%">${label(b)}</span>`).join('')}</div>
      <div class="lg-ends"><span>${md.low}</span><span>${md.high}</span></div>
      <div class="lg-controls">
        <span class="lg-label">Colors</span>
        <div class="seg small" role="group" aria-label="Color scale">
          <button type="button" data-scale="all" aria-pressed="${!viewOn}">All metros</button>
          <button type="button" data-scale="view" aria-pressed="${viewOn}">This view</button>
        </div>
        <span class="lg-nodata"><i></i>No value</span>
      </div>
      <div class="lg-note">${note}</div>`;
  }

  // ---------- the block group card ----------
  const shortName = (name) => name.split(/[-,/]/)[0].trim();
  const andList = (a) => (a.length < 3 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const median = (a) => {
    if (!a.length) return NaN;
    const s = a.slice().sort((x, y) => x - y);
    const k = s.length >> 1;
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  };

  // The census values of a block group (layer 2): income, its quarter within the metro, car-free households.
  function neighborhoodHTML(p, metro) {
    if (!has(p.inc) && !has(p.zv)) {
      return '<div class="row-note nb-none">The census reports no income or vehicle values for this block group.</div>';
    }
    const q = has(p.iq) ? `In the ${QUARTERS[p.iq]} of the ${esc(metro)} metro's block groups` : '';
    return `<div class="nb">
        <div class="nb-row"><span>Median household income</span><strong>${has(p.inc) ? `$${fmt.format(p.inc)}` : 'Not reported'}</strong></div>
        ${q ? `<div class="row-note">${q}</div>` : ''}
        <div class="nb-row"><span>Share of households without a car</span><strong>${has(p.zv) ? `${trimZero(p.zv.toFixed(1))}%` : 'Not reported'}</strong></div>
      </div>`;
  }

  // With a filter on, the metro card counts the matching block groups of a loaded metro.
  function filterSummary(m) {
    const L = S.loaded.get(m.slug);
    if (!L) return '<div class="fsum">Zoom in to the metro to count the block groups that match the filter.</div>';
    const all = L.features.map((f) => f.properties);
    if (!all.some((p) => has(p.iq) || has(p.zv))) {
      return '<div class="fsum">The data have no census values for this metro, so the filter matches none of its block groups.</div>';
    }
    const sel = all.filter(matches);
    if (!sel.length) return '<div class="fsum">No block group in this metro matches the filter.</div>';
    const t = median(sel.map((p) => p.t).filter(has));
    const c = median(sel.map((p) => p.c).filter(has));
    return `<div class="fsum"><strong>${fmt.format(sel.length)}</strong> of ${fmt.format(all.length)} block groups match the
      filter. Their median: ${fmt.format(Math.round(t))} jobs by transit${has(c) ? `, ${fmt.format(Math.round(c))} by car` : ''}.</div>`;
  }

  function tractLabel(t) {
    const whole = parseInt(t.slice(0, 4), 10);
    const part = t.slice(4);
    return part === '00' ? String(whole) : `${whole}.${part}`;
  }

  // `where` turns a percentile into the note under the value (within the metro, or among metros).
  // The Lowest-Median-Highest bar shows only for a block group, not at the metro level.
  function jobsRow(key, label, v, pct, where, missing, bar = true) {
    const sel = S.mode === key ? ' selected' : '';
    if (!has(v)) {
      return `<div class="row${sel}"><div class="row-top"><span class="row-label">${label}</span>
        <span class="row-value na">Not available</span></div><div class="row-note">${missing}</div></div>`;
    }
    const note = has(pct) ? where(pct) : '';
    return `<div class="row${sel}">
      <div class="row-top"><span class="row-label">${label}</span><span class="row-value">${fmt.format(v)}</span></div>
      ${bar && has(pct) ? `<div class="gauge" aria-hidden="true"><span class="med"></span><span class="mark" style="left:${Math.min(100, Math.max(0, pct))}%"></span></div>
      <div class="gauge-labels" aria-hidden="true"><span>Lowest</span><span>Median</span><span>Highest</span></div>` : ''}
      <div class="row-note">${note}</div></div>`;
  }

  function blockGroupHTML(p, isPinned) {
    const m = S.bySlug.get(p.m) || { name: '', n_c: 1 };
    const g = String(p.g);
    const metro = shortName(m.name);
    const inMetro = (x) => (x === 0 ? `The lowest in the ${esc(metro)} metro`
      : `Higher than ${x}% of block groups in the ${esc(metro)} metro`);
    const state = S.meta.states[g.slice(0, 2)] || '';
    let rv = null;
    let rn;
    if (has(p.r)) {
      rv = `${ratioText(p.r)}&times;`;
      rn = p.r >= 1 ? `A car reaches ${ratioText(p.r)} times as many jobs as transit.`
        : 'Transit reaches more jobs than a car here.';
    } else if (p.t === 0) {
      rn = 'No jobs are reachable by transit within 30 minutes.';
    } else {
      rn = 'This needs both a transit and a car value.';
    }
    return `<div class="card card-bg">
      <div class="card-head">
        <span class="level level-bg">Block group</span>
        <div class="place">Block group ${g.slice(11)}, tract ${tractLabel(g.slice(5, 11))}, ${esc(state)}</div>
        <div class="kicker">${esc(m.name)}</div>
        ${filterOn() && !matches(p) ? '<div class="out-note">Outside the filter</div>' : ''}
        ${isPinned ? '<button type="button" class="unpin" aria-label="Clear the selected block group">&times;</button>' : ''}
      </div>
      <div class="section-title">Jobs within 30 minutes</div>
      ${jobsRow('t', 'By transit', p.t, p.tp, inMetro, 'No transit value for this block group.')}
      ${jobsRow('c', 'By car, no traffic', p.c, p.cp, inMetro,
        m.n_c === 0 ? 'This metro has no car travel times.' : 'No car value for this block group.')}
      <div class="row${S.mode === 'r' ? ' selected' : ''}">
        <div class="row-top"><span class="row-label">Car vs. transit</span>
          ${rv ? `<span class="row-value">${rv}</span>` : '<span class="row-value na">No value</span>'}</div>
        <div class="row-note">${rn}</div>
      </div>
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
    if (!S.meta) return '';
    const m = S.hoverMetro || metroAtCenter();
    if (!m) return '<p class="hint">Choose a metro or search for an address, then hover over a neighborhood.</p>';
    if (!m.mapped) {
      return `<div class="card card-metro">
        <div class="card-head"><span class="level level-metro">Metro overview</span>
          <div class="place">${esc(m.name)}</div></div>
        <p class="hint">This metro is not on the map. Its latest usable transit schedules are from
        ${m.latest_usable_year}, and the map starts at ${S.meta.year_min}.</p>
      </div>`;
    }
    const q = m.quarters.length;
    const jobs = m.jobs_year < S.meta.year_car
      ? `Jobs are from ${m.jobs_year}, the latest year the Census Bureau publishes for this state.`
      : `Jobs are from ${m.jobs_year}.`;
    // The metro as a whole: its median block group, placed among the mapped metros.
    const nWith = (k) => S.meta.metros.filter((x) => x.mapped && has(x.median[k])).length;
    const among = (k) => (x) => (x === 0 ? `The lowest of the ${nWith(k)} metros`
      : `Higher than in ${x}% of the ${nWith(k)} metros`);
    const r = m.median.r;
    const rNote = !has(r) ? 'This metro has no car travel times.'
      : m.pct.r === 0 ? `The smallest car advantage of the ${nWith('r')} metros`
      : `A larger car advantage than in ${m.pct.r}% of the ${nWith('r')} metros`;
    return `<div class="card card-metro">
      <div class="card-head"><span class="level level-metro">Metro overview</span>
        <div class="place">${esc(m.name)}</div></div>
      <div class="section-title">Jobs within 30 minutes, median block group</div>
      ${jobsRow('t', 'By transit', m.median.t, m.pct.t, among('t'), 'No transit values for this metro.', false)}
      ${jobsRow('c', 'By car, no traffic', m.median.c, m.pct.c, among('c'), 'This metro has no car travel times.', false)}
      <div class="row${S.mode === 'r' ? ' selected' : ''}">
        <div class="row-top"><span class="row-label">Car vs. transit</span>
          ${has(r) ? `<span class="row-value">${ratioText(r)}&times;</span>` : '<span class="row-value na">No value</span>'}</div>
        <div class="row-note">${rNote}</div>
      </div>
      ${filterOn() ? filterSummary(m) : ''}
      <p class="facts">${fmt.format(m.n_bg)} block groups. Transit times use ${q === 4 ? 'all four' : q} quarter${q === 1 ? '' : 's'}
      of ${m.year} schedules. ${jobs}</p>
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

  function loadMetro(m) {
    if (S.loaded.has(m.slug)) {
      S.loaded.get(m.slug).used = ++S.tick;
      return Promise.resolve();
    }
    if (S.pending.has(m.slug)) return S.pending.get(m.slug);
    setStatus(`Loading ${m.name}…`);
    // The census layer is optional: if its file fails, the map still draws the metro.
    const census = getJSON(`data/acs/${m.slug}.json`).catch((err) => { console.error(err); return {}; });
    const p = Promise.all([getJSON(`data/bg/${m.slug}.json`), census])
      .then(([data, acs]) => {
        for (const f of data.features) {
          const pr = f.properties;
          pr.m = m.slug;
          const a = acs[pr.g];   // [median household income, income quarter in the metro, % of households without a car]
          if (a) {
            if (a[0] !== null) pr.inc = a[0];
            if (a[1] !== null) pr.iq = a[1];
            if (a[2] !== null) pr.zv = a[2];
          }
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
    const out = S.meta.metros.filter((m) => !m.mapped).map((m) => `${m.name} (${m.latest_usable_year})`);
    const earlier = S.meta.metros.filter((m) => m.mapped && m.year !== last).map((m) => `${shortName(m.name)} (${m.year})`);
    const noCar = S.meta.metros.filter((m) => m.mapped && m.n_c === 0).map((m) => shortName(m.name));
    $('#about-coverage').textContent =
      `The map covers the ${S.meta.counts.metros_mapped} metros, of ${S.meta.counts.metros} in the data, that have usable ` +
      `transit schedules in ${S.meta.year_min} or later. Each is shown at its latest such year, which is ${last}` +
      `${earlier.length ? ` except in ${andList(earlier)}` : ''}. Areas outside these metros are not in the data. ` +
      `Not on the map, with the latest year of usable schedules: ${out.join('; ')}. ` +
      `${andList(noCar)} ${noCar.length === 1 ? 'has' : 'have'} no car travel times.`;
  }

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
    if (S.scale === 'view') updateViewBreaks(); else applyColors();
  }));

  $('#legend').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scale]');
    if (!b || b.dataset.scale === S.scale) return;
    S.scale = b.dataset.scale;
    if (S.scale === 'view') updateViewBreaks();
    else { S.viewBreaks = null; applyColors(); }
  });

  $('#card').addEventListener('click', (e) => { if (e.target.closest('.unpin')) unpin(); });
  $('#about-open').addEventListener('click', () => $('#about').showModal());

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
        setStatus(`${m.name} is not on the map. Its latest usable transit schedules are from ${m.latest_usable_year}.`);
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
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({
    compact: true,
    customAttribution: 'Access data: S. Arnold. Schedules include <a href="https://www.transit.land/terms" target="_blank" rel="noopener">Transitland</a> data.',
  }), 'bottom-right');
  map.on('error', (e) => console.warn(e && e.error ? e.error.message : e));

  // The metro list loads alongside the basemap, so the menu and the About text fill in early.
  const metaReady = getJSON('data/metros.json').then((meta) => {
    S.meta = meta;
    meta.metros.forEach((m) => S.bySlug.set(m.slug, m));
    $('#n-metros').textContent = meta.counts.metros_mapped;
    $('#years').textContent = `${meta.years_transit[0]}–${meta.years_transit[1]}`;
    fillMetroSelect();
    fillCoverage();
    return meta;
  });

  map.on('load', async () => {
    try {
      await metaReady;
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
      paint: { 'line-color': '#0f2329',
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
        'circle-color': '#045f76',
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
      if (f && !overDot(e.point)) { S.hold = null; pin(f.id, f.properties); }
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
