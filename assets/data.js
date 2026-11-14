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
    s = clean(s).replace(/_/g, '-').replace(/\b(\d{1,2})(st|nd|rd|th)\b/i, '$1'); if (!s) return null; let m;
    if ((m = s.match(/^(\d{1,2})[-\s.\/]+([A-Za-z]{3,})[-\s.,\/]+(\d{2,4})$/)) && MON[m[2].slice(0, 3).toLowerCase()]) return mk(+m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1]);
    if ((m = s.match(/^([A-Za-z]{3,})[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/)) && MON[m[1].slice(0, 3).toLowerCase()]) return mk(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]);
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return mk(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/))) return mk(+m[3], +m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return mk(+m[3], +m[1], +m[2]);
    return null;
  };

  /* ---------- Columns ---------- */
  // A source's layout: as the web app reports it, else guessed from its name.
  function kindOf(key, given) {
    if (given) return given;
    return key === 'team' ? 'team' : /^paid/.test(key || '') ? 'paid' : 'mkt';
  }
  const QTY = /^(no\.?\s*of\s*creatives?|number of creatives?|qty|quantity|creatives?\s*count|count of creatives?)$/;
  // kind: 'paid' | 'mkt' (the tab's layout); key: the source's name in the web app's CONFIG (used for edits)
  function parseSource(kind, src, key) {
    const name = (src && src.kind) || kindOf(kind);
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
      qty: find(QTY)
    });
    const v = (r, k) => (ix[k] >= 0 && r[ix[k]] != null ? clean(r[ix[k]]) : '');
    const rowNums = Array.isArray(src.rowNums) ? src.rowNums : [];
    return src.rows.map((r, i) => {
      const qn = parseInt(v(r, 'qty'), 10);
      return {
        src: key || kind, row: rowNums[i] || null,
        id: v(r, 'id'), req_date: parseDate(v(r, 'req')), req_text: v(r, 'req'), type: v(r, 'type'), brand: v(r, 'brand'), topic: v(r, 'topic'),
        channel: v(r, 'channel'), priority: v(r, 'priority'), brief: v(r, 'brief'), owner: v(r, 'owner'), content_status: v(r, 'cstatus'),
        eta: parseDate(v(r, 'eta')), eta_text: v(r, 'eta'), creative_link: v(r, 'link'), design_status: v(r, 'dstatus'), designer: v(r, 'designer'),
        open_file: v(r, 'file'), live_status: v(r, 'live'), live_date: parseDate(v(r, 'liveDate')),
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
  /* Status definitions from the Creative Head (Nov 2026). Design Status is the primary field; Content Status only decides
     whether a task that design has not started is ready to be picked up. Every task gets exactly one stage:
       TBP (or blank) + content DONE (or blank) = To be planned  ready for a designer/editor          OPEN design work
       WIP                                          = WIP                                               OPEN design work
       CHANGES                                      = Changes requested  shared, revisions asked       OPEN design work
       UNDER REVIEW                                 = Under review  team finished, Creative Head reviewing (not workload, never overdue)
       SHARED                                       = Shared  with the client, waiting for approval    SHARED work (never overdue)
       NO UPDATE                                    = No update  shared, no reply after follow-ups     SHARED work (never overdue)
       DONE                                         = Delivered  delivered and approved                COMPLETED work
       REJECTED                                     = Rejected  delivered, rejected by client          COMPLETED work (bandwidth),
                                                                                                        not an approved delivery
       TBP (or blank) + content PENDING / INCOMPLETE BRIEF / TBP / WIP / SHARED / CHANGES
                                                    = Awaiting brief  the brief is not approved yet (sub-status says why)
       HOLD, or not started + content HOLD          = Hold
       DEPRIORITIZED                                = Deprioritised  no longer required */
  const BRIEF = { 'PENDING': 'Brief pending discussion', 'TBD': 'Brief pending discussion', 'INCOMPLETE BRIEF': 'Incomplete brief', 'INCOMPLETE': 'Incomplete brief',
    'TBP': 'Brief ready for scripting', 'WIP': 'Brief in progress', 'SHARED': 'Brief with client', 'CHANGES': 'Brief changes requested' };
  function stageOf(ds0, cs0) {
    const ds = clean(ds0).toUpperCase(), cs = clean(cs0).toUpperCase();
    if (['DONE', 'DELIVERED', 'COMPLETED', 'COMPLETE', 'APPROVED'].includes(ds)) return ['Delivered', false];
    if (ds === 'REJECTED') return ['Rejected', false];
    if (ds === 'NO UPDATE') return ['No update', false];
    if (['UNDER REVIEW', 'IN REVIEW', 'REVIEW', 'INTERNAL REVIEW'].includes(ds)) return ['Under review', false];
    if (['SHARED', 'SENT', 'SENT FOR APPROVAL', 'PENDING APPROVAL'].includes(ds)) return ['Shared', false];
    if (['WIP', 'IN PROGRESS', 'WORK IN PROGRESS', 'ONGOING', 'IN-PROGRESS'].includes(ds)) return ['WIP', true];
    if (['CHANGES', 'CHANGES REQUESTED', 'REVISION', 'REWORK', 'FEEDBACK'].includes(ds)) return ['Changes requested', true];
    if (['HOLD', 'ON HOLD', 'PAUSED'].includes(ds)) return ['Hold', false];
    if (['DEPRIORITIZED', 'DEPRIORITISED', 'CANCELLED', 'CANCELED', 'DROPPED', 'NOT NEEDED'].includes(ds)) return ['Deprioritised', false];
    if (ds === '' || ['TBP', 'TO BE PLANNED', 'NOT STARTED', 'PLANNED', 'TODO', 'TO DO'].includes(ds)) {
      if (cs === 'HOLD') return ['Hold', false];
      if (BRIEF[cs]) return ['Awaiting brief', false, BRIEF[cs]];
      return ['To be planned', true];
    }
    return [title(clean(ds0)), true];
  }
  /* What each stage counts towards (one place, used by every page, report, briefing and the assistant). */
  const GROUPS = { 'To be planned': 'open', 'WIP': 'open', 'Changes requested': 'open', 'Under review': 'review', 'Shared': 'shared', 'No update': 'shared',
    'Delivered': 'done', 'Rejected': 'rejected', 'Awaiting brief': 'brief', 'Hold': 'hold', 'Deprioritised': 'dropped' };
  function groupOf(stage) { const g = GROUPS[stage] || 'open'; return { group: g, open: g === 'open', done: g === 'done', shared: g === 'shared', review: g === 'review', brief: g === 'brief' }; }
  const KNOWN = Object.keys(GROUPS);

  const TYPES = { 'video (in-house)': 'In-House Video', 'in-house video': 'In-House Video', 'a+': 'A+ Content', 'a++': 'A+ Content', 'static ad': 'Static', 'static ads': 'Static', 'carousel ': 'Carousel', 'carousel ads': 'Carousel', 'gif ads': 'GIF', 'ai ugc video': 'AI Video', 'in-house edit': 'Video Edit', 'reels': 'Reel' };
  const typeOf = (s) => { const c = clean(s); if (!c) return 'Unspecified'; return TYPES[c.toLowerCase()] || c; };

  /* ---------- Designers ---------- */
  const SPLIT = /\s*(?:,|&|\+|\/|;|\band\b)\s*/i;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Learn each person from cells that name one person, then split cells that run several names together.
  // known: names from the team list (and their other spellings), so names typed together split the same way
  // however few rows are loaded (for example when a person sees only their own tasks).
  function designerSplitter(cells, known) {
    const counts = new Map(), display = new Map();
    (known || []).forEach((n0) => { const n = clean(n0); if (!n) return; const k = n.toLowerCase(); counts.set(k, (counts.get(k) || 0) + 5); if (!display.has(k)) display.set(k, n); });
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
  /* ---------- Dates that need a year correction ---------- */
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
  const goodYear = (d) => !!d && +d.slice(0, 4) >= 2020 && +d.slice(0, 4) <= 2100;
  const reYear = (d, y) => { const c = String(y).padStart(4, '0') + d.slice(4); return isNaN(Date.parse(c)) ? null : c; };
  // Re-year date d so it falls within [lo, hi] days of ref, as close to ref as possible.
  const nearYear = (d, ref, lo, hi) => {
    let best = null;
    for (const y of [+ref.slice(0, 4) - 1, +ref.slice(0, 4), +ref.slice(0, 4) + 1]) {
      const c = reYear(d, y); if (!c) continue;
      const g = days(ref, c);
      if (g >= lo && g <= hi && (!best || Math.abs(g) < Math.abs(best[1]))) best = [c, g];
    }
    return best ? best[0] : null;
  };

  // sources: [{ kind: 'paid'|'mkt', rows }] in the web app's order (newest tab of each kind first),
  // or the older form { paid: rows, mkt: rows, mkt2025: rows }.
  // Returns the task list; rows that are too incomplete to be a task are on its `ignored` property.
  function buildTasks(sources, today, known) {
    if (!today) { const d = new Date(); today = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
    const list = Array.isArray(sources) ? sources : Object.keys(sources).map((k) => ({ kind: kindOf(k), rows: sources[k] || [] }));
    const seenIds = { paid: new Set(), mkt: new Set() };
    const both = [], ignored = [];
    for (const s of list) {
      if (s.kind !== 'paid' && s.kind !== 'mkt') continue;
      const ids = new Set();
      for (const r of s.rows || []) {
        const id = clean(r.id);
        if (id && seenIds[s.kind].has(id)) continue; // the same task in an older tab: the newer copy wins
        if (id) ids.add(id);
        const source = s.kind === 'paid' ? 'Paid' : 'Marketing';
        if (clean(r.brand) || clean(r.type) || clean(r.topic)) both.push([r, source]);
        else ignored.push({ src: r.src || '', row: r.row || null, id, source, owner: clean(r.owner), status: clean(r.design_status) || clean(r.content_status), eta: r.eta, req: r.req_date });
      }
      ids.forEach((id) => seenIds[s.kind].add(id));
    }

    // Designer cells: an email becomes a name ("neha@shiprocket.com" → "Neha").
    // Emails become names (neha@… → Neha), and names typed together without a space ("Shubham RanaHimanshu Saxena") are separated.
    const fromEmail = (v) => clean(v).replace(/([A-Za-z0-9._-]+)@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m, u) => u.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())).replace(/([a-z])([A-Z][a-z])/g, '$1 $2');
    const designersOf = designerSplitter(both.map(([r]) => fromEmail(r.designer)), known);

    // One spelling per brand and per creative type (case, spacing and plurals merged; the most used spelling wins).
    const canon = (values, keyOf, pretty) => {
      const votes = new Map();
      for (const v of values) { if (!v) continue; const k = keyOf(v); const m = votes.get(k) || new Map(); m.set(v, (m.get(v) || 0) + 1); votes.set(k, m); }
      const out = new Map();
      for (const [k, m] of votes) out.set(k, pretty([...m].sort((a, b) => b[1] - a[1])[0][0]));
      return out;
    };
    const brandKey = (b) => b.toLowerCase();
    const brandName = canon(both.map(([r]) => clean(r.brand)), brandKey, (b) => (b === b.toLowerCase() ? b.replace(/\b\w/g, (c) => c.toUpperCase()) : b));
    const typeKey = (t) => t.toLowerCase().replace(/s$/, '');
    const typeName = canon(both.map(([r]) => typeOf(r.type)), typeKey, (t) => (/^gif$/i.test(t) ? 'GIF' : t));

    // Request dates of neighbouring rows (rows are entered in date order), to tell which date has a mistyped year.
    const bySrc = new Map();
    for (const [r] of both) { const k = r.src || ''; if (!bySrc.has(k)) bySrc.set(k, []); bySrc.get(k).push(r); }
    const around = new Map(), span = new Map();
    for (const [k, rows] of bySrc) {
      // The tab's usual date range (its middle 90%, so a cluster of typos cannot stretch it).
      const all = rows.map((r) => r.req_date).filter(goodYear).sort();
      if (all.length >= 20) span.set(k, [all[Math.floor(all.length * 0.05)], all[Math.ceil(all.length * 0.95) - 1]]);
      rows.sort((x, y) => (x.row || 0) - (y.row || 0));
      rows.forEach((r, i) => {
        const near = [];
        for (let j = Math.max(0, i - 6); j <= Math.min(rows.length - 1, i + 6); j++) if (j !== i && goodYear(rows[j].req_date)) near.push(rows[j].req_date);
        near.sort();
        around.set(r, near.length >= 3 ? near[near.length >> 1] : null);
      });
    }

    // Rows sharing an ID within one tab are different tasks: both are kept and flagged.
    const idCount = new Map();
    for (const [r] of both) { const id = clean(r.id); if (id) { const k = (r.src || '') + '|' + id; idCount.set(k, (idCount.get(k) || 0) + 1); } }

    const seen = new Set();
    const tasks = both.map(([r, source], i) => {
      const flags = [];
      let req = r.req_date, eta = r.eta;
      const mid = around.get(r), sp = span.get(r.src || '');
      const inSpan = (d) => !sp || (days(sp[0], d) >= -60 && days(d, sp[1]) >= -60);
      // 1. Request date: a year outside the tab's range, or far from the neighbouring rows, is a typo.
      //    Re-year it to sit just before the ETA when the ETA looks right, else next to its neighbours.
      if (req && (!goodYear(req) || !inSpan(req) || (mid && Math.abs(days(mid, req)) > 120))) {
        let fix = null;
        if (eta && goodYear(eta) && inSpan(eta)) fix = nearYear(req, eta, -150, 30);
        if (!fix && mid) fix = nearYear(req, mid, -120, 120);
        if (fix && fix !== req) { req = fix; flags.push('Request date year looks mistyped'); }
      }
      if (req && !goodYear(req)) { req = null; flags.push('Request date unreadable'); }
      // 2. ETA: should land shortly after the request date.
      if (eta && req && (Math.abs(days(req, eta)) > 200 || !goodYear(eta))) {
        const fix = nearYear(eta, req, -45, 150);
        if (fix) { eta = fix; flags.push('ETA year looks mistyped'); }
      }
      if (eta && !goodYear(eta)) { eta = null; flags.push('ETA unreadable'); }
      if (!req && clean(r.req_text) && !flags.includes('Request date unreadable')) flags.push('Request date unreadable');
      if (!eta && clean(r.eta_text) && !flags.includes('ETA unreadable')) flags.push('ETA unreadable');
      if (req && eta && days(req, eta) < 0) flags.push('ETA before request date');
      const [stage, open0, sub] = stageOf(r.design_status, r.content_status);
      const G = groupOf(stage), open = KNOWN.includes(stage) ? G.open : open0;
      if (!KNOWN.includes(stage)) flags.push('Unrecognised status');
      const des = designersOf(fromEmail(r.designer));
      const dsU = clean(r.design_status).toUpperCase(), csU = clean(r.content_status).toUpperCase(), idU = clean(r.id).toUpperCase();
      if (open && !eta) flags.push('Open, no ETA');
      if ((open || G.review || G.shared) && !des.length) flags.push('No designer assigned');
      if (G.done && !des.length) flags.push('Completed, no designer');
      if (G.done && !/^https?:/i.test(clean(r.creative_link))) flags.push('Completed, no creative link');
      if (!dsU && !csU) flags.push('Design and content status blank');
      if ((G.done || G.shared || G.review) && ['PENDING', 'INCOMPLETE BRIEF', 'TBD'].includes(csU)) flags.push('Design finished but brief not approved');
      if (!clean(r.brand)) flags.push('No brand');
      if (!idU) flags.push('No Creative_ID');
      else if (source === 'Paid' ? !/^SRAP\d/.test(idU) : !/^SRA\d/.test(idU)) flags.push(source === 'Paid' ? 'ID should start with SRAP (External sheet)' : 'ID should start with SRA (Internal sheet)');
      if (clean(r.id) && idCount.get((r.src || '') + '|' + clean(r.id)) > 1) flags.push('Duplicate ID');
      let uid = (r.src || source) + ':' + (clean(r.id) || 'row' + (r.row || i + 2));
      while (seen.has(uid)) uid += '·';
      seen.add(uid);
      // Delivery date (Creative Head, Nov 2026): completed work (DONE, REJECTED) is dated by its Design ETA, which is the
      // actual delivery date once a task is done; else the request date. A delivered task can't be delivered in the future,
      // so a later ETA counts as today.
      let ddate = G.done ? (eta || req || null) : null;
      if (ddate && ddate > today) ddate = today;
      const pri = clean(r.priority).toUpperCase();
      const t0 = typeOf(r.type);
      return {
        uid, id: clean(r.id), source, src: r.src || '', row: r.row || null,
        brand: clean(r.brand) ? brandName.get(brandKey(clean(r.brand))) : 'No brand',
        topic: clean(r.topic), type: typeName.get(typeKey(t0)) || t0, channel: clean(r.channel), qty: 1, qtySheet: r.qty || 1, // each Creative ID is one creative request, whatever No. of Creatives says
        priority: /^P\d$/.test(pri) ? pri : '', owner: clean(r.owner),
        designers: des.join(' + '), stage, open, group: G.group, done: G.done, shared: G.shared, review: G.review, awaiting: G.brief,
        sub: sub || '', design_status: clean(r.design_status), content_status: clean(r.content_status), req, eta,
        ddate, month: ddate ? ddate.slice(0, 7) : '', date_basis: G.done ? (eta ? 'eta' : 'request') : '',
        live_status: clean(r.live_status).replace(/^Luanch/i, 'Launch'),
        brief: clean(r.brief), link: clean(r.creative_link), file: clean(r.open_file),
        flags: flags.join('; ')
      };
    });
    Object.defineProperty(tasks, 'ignored', { value: ignored, enumerable: false });
    return tasks;
  }

  // Which optional columns a source has (so the editor only offers what can be saved).
  function columnsOf(src) {
    const head = ((src && src.headers) || []).map((h) => clean(h).toLowerCase());
    return { qty: head.some((h) => QTY.test(h)), priority: head.includes('priority') };
  }
  const OPEN_STAGES = ['To be planned', 'WIP', 'Changes requested'];

  const api = { kindOf, parseDate, parseSource, parseTeam, stageOf, groupOf, GROUPS, buildTasks, designerSplitter, columnsOf, OPEN_STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CODATA = api;
})(typeof window !== 'undefined' ? window : globalThis);
