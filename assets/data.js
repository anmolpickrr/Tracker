/* Creative Ops Tracker: turns raw sheet rows into one clean task list.
   Pure functions, no DOM, so they can be tested outside the browser. */
(function (root) {
  'use strict';

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /* ---------- Dates ---------- */
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const p2 = (n) => String(n).padStart(2, '0');
  const mk = (y, mo, d) => { if (y < 100) y += 2000; if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null; return String(y).padStart(4, '0') + '-' + p2(mo) + '-' + p2(d); };
  // Sheets show dates as "20-Apr-2026", "22 April 2026", "23-10-2026" (day first) or "6/3/2026" (month first).
  const parseDate = (s) => {
    s = clean(s).replace(/_/g, '-'); if (!s) return null; let m;
    if ((m = s.match(/^(\d{1,2})[-\s.\/]+([A-Za-z]{3,})[-\s.,\/]+(\d{2,4})$/)) && MON[m[2].slice(0, 3).toLowerCase()]) return mk(+m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1]);
    if ((m = s.match(/^([A-Za-z]{3,})[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/)) && MON[m[1].slice(0, 3).toLowerCase()]) return mk(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]);
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return mk(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/))) return mk(+m[3], +m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return mk(+m[3], +m[1], +m[2]);
    return null;
  };

  /* ---------- Columns ---------- */
  const QTY = /^(no\.?\s*of\s*creatives?|number of creatives?|qty|quantity|creatives?\s*count|count of creatives?)$/;
  // name: 'paid' | 'mkt' | 'mkt2025'
  function parseSource(name, src) {
    if (!src || !Array.isArray(src.rows)) return [];
    const head = (src.headers || []).map((h) => clean(h).toLowerCase());
    const col = (n, nth = 0) => { let seen = 0; for (let i = 0; i < head.length; i++) if (head[i] === n) { if (seen === nth) return i; seen++; } return -1; };
    const any = (...names) => { for (const n of names) { const i = col(n); if (i >= 0) return i; } return -1; };
    const find = (re) => head.findIndex((h) => re.test(h));
    let ix;
    if (name === 'paid') {
      // Paid sheet: column A holds the ID and column B the request date (their headers are shifted);
      // the second "Design ETA" column holds the design status.
      ix = {
        id: 0, req: 1, eta: col('design eta', 0),
        dstatus: col('design eta', 1) >= 0 ? col('design eta', 1) : any('design status'),
        designer: any('designer/editor', 'designer', 'creator')
      };
    } else {
      ix = {
        id: any('creative_id', 'req. id', 'id') >= 0 ? any('creative_id', 'req. id', 'id') : 0,
        req: any('req. date', 'request date'), eta: any('design eta'), dstatus: any('design status'),
        designer: any('creator', 'designer/editor', 'designer')
      };
      if (ix.id === ix.req) ix.id = 0;
    }
    Object.assign(ix, {
      type: any('creative type'), brand: any('brands', 'brand'), topic: any('sku/topic'), channel: any('marketing channel'),
      priority: any('priority'), brief: any('creative brief'), owner: any('content owner'), cstatus: any('content status'),
      link: any('creative link'), file: any('open file'), live: any('live status'), liveDate: any('status live date', 'live status date'),
      delivered: find(/deliver/), qty: find(QTY)
    });
    const v = (r, k) => (ix[k] >= 0 && r[ix[k]] != null ? clean(r[ix[k]]) : '');
    const rowNums = Array.isArray(src.rowNums) ? src.rowNums : [];
    return src.rows.map((r, i) => {
      const qn = parseInt(v(r, 'qty'), 10);
      return {
        src: name, row: rowNums[i] || null,
        id: v(r, 'id'), req_date: parseDate(v(r, 'req')), req_text: v(r, 'req'), type: v(r, 'type'), brand: v(r, 'brand'), topic: v(r, 'topic'),
        channel: v(r, 'channel'), priority: v(r, 'priority'), brief: v(r, 'brief'), owner: v(r, 'owner'), content_status: v(r, 'cstatus'),
        eta: parseDate(v(r, 'eta')), eta_text: v(r, 'eta'), creative_link: v(r, 'link'), design_status: v(r, 'dstatus'), designer: v(r, 'designer'),
        open_file: v(r, 'file'), live_status: v(r, 'live'), live_date: parseDate(v(r, 'liveDate')), delivered_on: parseDate(v(r, 'delivered')),
        qty: qn > 0 ? qn : null
      };
    });
  }

  function parseTeam(src) {
    if (!src || !Array.isArray(src.rows)) return [];
    const head = (src.headers || []).map((h) => clean(h).toLowerCase());
    const f = (re) => head.findIndex((h) => re.test(h));
    const ix = { name: f(/^name/), status: f(/^status/), role: f(/^role/), aliases: f(/also|alias/), notes: f(/^notes?/) };
    const v = (r, k) => (ix[k] >= 0 && r[ix[k]] != null ? clean(r[ix[k]]) : '');
    return src.rows.filter((r) => v(r, 'name')).map((r) => ({
      name: v(r, 'name'),
      status: /inactive|left|former|^no$/i.test(v(r, 'status')) ? 'Inactive' : 'Active',
      role: v(r, 'role'), aliases: v(r, 'aliases'), notes: v(r, 'notes')
    }));
  }

  /* ---------- Status ---------- */
  const title = (s) => s.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
  function stageOf(ds0, cs0) {
    const ds = clean(ds0).toUpperCase(), cs = clean(cs0).toUpperCase();
    if (['DONE', 'DELIVERED', 'COMPLETED', 'COMPLETE'].includes(ds)) return ['Delivered', false];
    if (['WIP', 'IN PROGRESS', 'WORK IN PROGRESS', 'ONGOING', 'IN-PROGRESS'].includes(ds)) return ['In progress', true];
    if (['SHARED', 'UNDER REVIEW', 'IN REVIEW', 'REVIEW', 'SENT FOR REVIEW'].includes(ds)) return ['Under review', false];
    if (['CHANGES', 'CHANGES REQUESTED', 'REVISION', 'REWORK', 'FEEDBACK'].includes(ds)) return ['Changes requested', true];
    if (['HOLD', 'ON HOLD', 'NO UPDATE', 'PAUSED'].includes(ds)) return ['On hold', false];
    if (['DEPRIORITIZED', 'DEPRIORITISED', 'REJECTED', 'CANCELLED', 'CANCELED', 'DROPPED', 'NOT NEEDED'].includes(ds)) return ['Dropped', false];
    if (ds === '' || ['TBP', 'TO BE PLANNED', 'NOT STARTED', 'PLANNED', 'TODO', 'TO DO'].includes(ds)) {
      if (cs === 'HOLD') return ['On hold', false];
      if (['INCOMPLETE BRIEF', 'PENDING', 'TBD', 'TBP', 'WIP'].includes(cs)) return ['Awaiting brief', false];
      return ['To be planned', true];
    }
    return [title(clean(ds0)), true];
  }
  const KNOWN = ['Delivered', 'In progress', 'Under review', 'Changes requested', 'On hold', 'Dropped', 'To be planned', 'Awaiting brief'];

  const TYPES = { 'video (in-house)': 'In-House Video', 'in-house video': 'In-House Video', 'a+': 'A+ Content', 'a++': 'A+ Content', 'static ad': 'Static', 'static ads': 'Static', 'carousel ': 'Carousel', 'carousel ads': 'Carousel', 'gif ads': 'GIF', 'ai ugc video': 'AI Video', 'in-house edit': 'Video Edit', 'reels': 'Reel' };
  const typeOf = (s) => { const c = clean(s); if (!c) return 'Unspecified'; return TYPES[c.toLowerCase()] || c; };

  /* ---------- Designers ---------- */
  const SPLIT = /\s*(?:,|&|\+|\/|;|\band\b)\s*/i;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Learn each person from cells that name one person, then split cells that run several names together.
  function designerSplitter(cells) {
    const counts = new Map(), display = new Map();
    for (const c0 of cells) { const c = clean(c0); if (!c) continue; for (const part of c.split(SPLIT).filter(Boolean)) { const k = part.toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1); if (!display.has(k)) display.set(k, part); } }
    const keys = [...counts.keys()];
    const firstOf = (k) => k.split(' ')[0];
    const covers = (k) => {
      const others = keys.filter((o) => o !== k && k.includes(o));
      let rest = ' ' + k + ' ';
      others.sort((x, y) => y.length - x.length).forEach((o) => { rest = rest.replace(' ' + o + ' ', ' '); });
      const leftover = rest.trim().split(' ').filter(Boolean);
      return others.length >= 2 || (others.length === 1 && leftover.length > 0 && leftover.every((w) => keys.some((o) => o !== k && firstOf(o) === w)));
    };
    const names = new Map();
    for (const k of keys) if (!covers(k)) names.set(k, display.get(k));
    const firsts = new Map();
    for (const [k, d] of names) { const f = firstOf(k); const prev = firsts.get(f); if (!prev || k.length > prev[0].length) firsts.set(f, [k, d]); }
    return (s) => {
      const c = clean(s); if (!c) return [];
      const out = [];
      for (const part of c.split(SPLIT).filter(Boolean)) {
        const k = part.toLowerCase();
        if (names.has(k) && !(k.split(' ').length === 1 && firsts.has(k) && firsts.get(k)[0] !== k)) { out.push(names.get(k)); continue; }
        const hits = [];
        for (const [kk, d] of names) { if (kk.split(' ').length < 2) continue; const i = k.search(new RegExp('\\b' + esc(kk) + '\\b')); if (i >= 0) hits.push([i, kk.length, d]); }
        for (const [f, [, d]] of firsts) { const i = k.search(new RegExp('\\b' + esc(f) + '\\b')); if (i >= 0) hits.push([i, f.length, d]); }
        hits.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
        const kept = []; let end = -1;
        for (const h of hits) { if (h[0] >= end && !kept.includes(h[2])) { kept.push(h[2]); end = h[0] + h[1]; } }
        if (kept.length) out.push(...kept); else out.push(part);
      }
      return [...new Set(out)];
    };
  }

  /* ---------- One task list ---------- */
  // sources: { paid: rows, mkt: rows, mkt2025: rows }  (rows from parseSource)
  function buildTasks(sources) {
    const mktIds = new Set((sources.mkt || []).map((r) => clean(r.id)).filter(Boolean));
    const both = []
      .concat((sources.paid || []).map((r) => [r, 'Paid']))
      .concat((sources.mkt || []).map((r) => [r, 'Marketing']))
      .concat((sources.mkt2025 || []).filter((r) => !mktIds.has(clean(r.id))).map((r) => [r, 'Marketing']))
      .filter(([r]) => clean(r.brand) || clean(r.type) || clean(r.topic));
    const designersOf = designerSplitter(both.map(([r]) => r.designer));
    const yr = (s) => +s.slice(0, 4);
    const gap = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
    const brandVotes = new Map();
    for (const [r] of both) { const b = clean(r.brand); if (!b) continue; const k = b.toLowerCase(); const m = brandVotes.get(k) || new Map(); m.set(b, (m.get(b) || 0) + 1); brandVotes.set(k, m); }
    const brandName = new Map();
    for (const [k, m] of brandVotes) { let best = [...m].sort((a, b) => b[1] - a[1])[0][0]; if (best === best.toLowerCase()) best = best.replace(/\b\w/g, (c) => c.toUpperCase()); brandName.set(k, best); }
    const seen = new Set();
    return both.map(([r, source], i) => {
      const flags = [];
      let req = r.req_date, eta = r.eta;
      if (req && eta && Math.abs(gap(req, eta)) > 200) {
        const alt = yr(eta) + req.slice(4), g = gap(alt, eta);
        if (yr(eta) >= 2020 && g >= -30 && g <= 120) { req = alt; flags.push('Request date year looks mistyped'); }
        else { const alt2 = yr(req) + eta.slice(4), g2 = gap(req, alt2); if (yr(req) >= 2020 && g2 >= -30 && g2 <= 120) { eta = alt2; flags.push('ETA year looks mistyped'); } }
      }
      if (req && yr(req) < 2020) { req = null; flags.push('Request date unreadable'); }
      if (eta && yr(eta) < 2020) { eta = null; flags.push('ETA unreadable'); }
      if (!req && clean(r.req_text) && !flags.includes('Request date unreadable')) flags.push('Request date unreadable');
      if (!eta && clean(r.eta_text) && !flags.includes('ETA unreadable')) flags.push('ETA unreadable');
      if (req && eta && gap(req, eta) < 0) flags.push('ETA before request date');
      const [stage, open] = stageOf(r.design_status, r.content_status);
      if (!KNOWN.includes(stage)) flags.push('Unrecognised status');
      const des = designersOf(r.designer);
      if (open && !eta) flags.push('Open, no ETA');
      if ((open || stage === 'Under review') && !des.length) flags.push('No designer assigned');
      if (stage === 'Delivered' && !des.length) flags.push('Delivered, no designer');
      if (stage === 'Delivered' && !/^https?:/i.test(clean(r.creative_link))) flags.push('Delivered, no creative link');
      if (!clean(r.brand)) flags.push('No brand');
      let uid = clean(r.id) || (source === 'Paid' ? 'P-row' : 'M-row') + (i + 2);
      while (seen.has(uid)) uid += '·';
      seen.add(uid);
      const ddate = stage === 'Delivered' ? (r.delivered_on || eta || req || null) : null;
      const pri = clean(r.priority).toUpperCase();
      return {
        uid, id: clean(r.id), source, src: r.src || '', row: r.row || null,
        brand: clean(r.brand) ? brandName.get(clean(r.brand).toLowerCase()) : 'No brand',
        topic: clean(r.topic), type: typeOf(r.type), channel: clean(r.channel), qty: r.qty || 1,
        priority: /^P\d$/.test(pri) ? pri : '', owner: clean(r.owner),
        designers: des.join(' + '), stage, open, design_status: clean(r.design_status), req, eta,
        ddate, month: ddate ? ddate.slice(0, 7) : '', date_basis: stage === 'Delivered' ? (r.delivered_on ? 'delivered' : eta ? 'eta' : 'request') : '',
        live_status: clean(r.live_status).replace(/^Luanch/i, 'Launch'),
        brief: clean(r.brief), link: clean(r.creative_link), file: clean(r.open_file),
        flags: flags.join('; ')
      };
    });
  }

  // Which optional columns a source has (so the editor only offers what can be saved).
  function columnsOf(src) {
    const head = ((src && src.headers) || []).map((h) => clean(h).toLowerCase());
    return { qty: head.some((h) => QTY.test(h)), delivered: head.some((h) => /deliver/.test(h)), priority: head.includes('priority') };
  }
  const OPEN_STAGES = ['To be planned', 'In progress', 'Changes requested'];

  const api = { parseDate, parseSource, parseTeam, stageOf, buildTasks, designerSplitter, columnsOf, OPEN_STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CODATA = api;
})(typeof window !== 'undefined' ? window : globalThis);
