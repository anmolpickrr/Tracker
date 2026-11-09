/* Creative Ops Tracker: views, filters and the connection to the Apps Script data API. */
(function () {
  'use strict';

  /* ================= Store, settings and rendering ================= */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  const DEFAULTS = { tab: 'today', src: '', designer: '', brand: '', type: '', stage: 'active', susort: 'urgent', who: 'active', rpreset: 'this-month', rfrom: '', rto: '' };
  const P = Object.assign({}, DEFAULTS);
  try { Object.assign(P, JSON.parse(LS.get('co.view', '{}'))); } catch (e) { /* ignore */ }
  const TABS = ['today', 'standup', 'tasks', 'team', 'reports', 'health'];
  if (TABS.includes(location.hash.slice(1))) P.tab = location.hash.slice(1);

  const S = { status: 'idle', error: '', tasks: null, team: null, teamRaw: [], sources: {}, generatedAt: null, loadedAt: null };
  const colors = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
  const draws = new Map();
  const dash = {
    colors,
    params: () => P,
    setParams(o) {
      Object.assign(P, o);
      LS.set('co.view', JSON.stringify({ src: P.src, designer: P.designer, brand: P.brand, type: P.type, stage: P.stage, susort: P.susort, who: P.who, rpreset: P.rpreset, rfrom: P.rfrom, rto: P.rto }));
      if (o.tab) { try { history.replaceState(null, '', '#' + o.tab); } catch (e) { /* ignore */ } }
      renderAll();
    },
    setLink(id) { try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ } },
    data(id) {
      if (id === 'tasks') return { status: S.status === 'ok' ? 'ok' : S.status === 'error' ? 'error' : 'loading', data: S.tasks };
      if (id === 'team') return { status: S.team ? 'ok' : (S.status === 'error' ? 'error' : 'loading'), data: S.team };
      return { status: 'missing' };
    },
    draw(name, fn) { if (fn) draws.set(name, fn); else runDraw(name); }
  };
  const visible = (el) => !el.closest('[hidden]');
  function runDraw(name) {
    const fn = draws.get(name); if (!fn) return;
    document.querySelectorAll('[data-draw="' + name + '"]').forEach((el) => { if (visible(el)) { try { fn(el); } catch (err) { console.error(name, err); } } });
  }
  let raf = 0;
  function renderAll() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      syncControls();
      draws.forEach((_, name) => runDraw(name));
    });
  }
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => { if (Math.abs(window.innerWidth - lastW) > 20) { lastW = window.innerWidth; renderAll(); } });

  /* ================= Data loading ================= */
  const conn = () => ({ url: LS.get('co.api', ''), key: LS.get('co.key', '') });
  async function load(fresh) {
    const { url, key } = conn();
    if (!url || !key) { S.status = 'unconfigured'; renderAll(); return; }
    if (S.status !== 'ok') S.status = 'loading';
    S.refreshing = true; renderAll();
    try {
      const u = new URL(url); u.searchParams.set('key', key); if (fresh) u.searchParams.set('fresh', '1');
      const res = await fetch(u.toString(), { redirect: 'follow' });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch (e) { throw new Error(/<html/i.test(text) ? 'The web app answered with a web page instead of data. Check that it is deployed with access set to "Anyone".' : 'The web app returned something that is not data.'); }
      if (!body.ok) throw new Error(body.error === 'bad_key' ? 'The key was not accepted. Copy it again from the Apps Script execution log after running setup.' : 'The web app reported: ' + body.error);
      const src = body.sources || {};
      const taskKeys = Object.keys(src).filter((k) => CODATA.kindOf(k, src[k].kind) !== 'team' && !src[k].optional);
      if (taskKeys.length && taskKeys.every((k) => src[k].error)) throw new Error('None of the task sheets could be opened by the web app: ' + src[taskKeys[0]].error);
      S.sources = src;
      // Every task tab the web app reports, in its order (newest tab of each kind first).
      const keys = Object.keys(src).filter((k) => !src[k].error && CODATA.kindOf(k, src[k].kind) !== 'team');
      S.tasks = CODATA.buildTasks(keys.map((k) => ({ kind: CODATA.kindOf(k, src[k].kind), rows: CODATA.parseSource(CODATA.kindOf(k, src[k].kind), src[k], k) })));
      const teamKey = Object.keys(src).find((k) => CODATA.kindOf(k, src[k].kind) === 'team');
      S.teamRaw = CODATA.parseTeam(teamKey ? src[teamKey] : null);
      S.team = S.teamRaw;
      S.cols = {}; Object.keys(src).forEach((k) => { S.cols[k] = CODATA.columnsOf(src[k]); });
      S.ver = body.ver || null;
      S.generatedAt = body.generatedAt; S.loadedAt = new Date();
      S.status = 'ok'; S.error = '';
      loadHealth();
      LS.set('co.cacheAt', S.generatedAt);
    } catch (err) {
      S.error = err && err.message ? err.message : String(err);
      if (err instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(S.error)) {
        // Google's own error pages carry no cross-site header, so a script error looks like a network failure.
        // The version check touches no sheets: if it answers, the web app is reachable and the sheets are the problem.
        let reachable = false;
        try { const { url, key } = conn(); const u = new URL(url); u.searchParams.set('key', key); u.searchParams.set('mode', 'ver'); reachable = !!JSON.parse(await (await fetch(u.toString(), { redirect: 'follow' })).text()).ok; } catch (e2) { /* unreachable */ }
        S.error = reachable
          ? 'The web app is connected but could not open the sheets. In Apps Script, signed in as the account the web app runs as (Deploy → Manage deployments shows it), run setup once and approve the permissions, then click Refresh.'
          : 'This browser could not reach the web app. Check the URL is the full link ending in /exec, then turn off ad or privacy blockers for this page (or try a private window) and click Refresh.';
      }
      if (S.status !== 'ok') S.status = 'error';
      else S.staleError = S.error;
    }
    S.refreshing = false;
    renderAll();
  }
  /* Integration health from the web app (account, change detection, edit access). Best effort. */
  async function loadHealth() {
    try {
      const { url, key } = conn();
      const u = new URL(url); u.searchParams.set('key', key); u.searchParams.set('mode', 'health');
      const body = JSON.parse(await (await fetch(u.toString(), { redirect: 'follow' })).text());
      S.health = body.ok ? body : null;
    } catch (e) { S.health = null; }
    dash.draw('integration');
  }
  async function post(payload) {
    const { url, key } = conn();
    const res = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key }, payload)) });
    const body = JSON.parse(await res.text());
    if (!body.ok) throw new Error(body.error || 'save failed');
    return body;
  }
  /* Live sync: every 30 s ask the web app whether a sheet changed (a tiny request), and reload only then.
     A full reload also runs every 10 minutes as a safety net, and on return to the tab. */
  let checking = false;
  async function checkForChanges() {
    if (checking || S.refreshing || S.status !== 'ok' || document.visibilityState !== 'visible') return;
    checking = true;
    try {
      const { url, key } = conn();
      const u = new URL(url); u.searchParams.set('key', key); u.searchParams.set('mode', 'ver');
      const body = JSON.parse(await (await fetch(u.toString(), { redirect: 'follow' })).text());
      S.checkedAt = new Date();
      if (body.ok && body.ver && S.ver && body.ver !== S.ver) await load(true);
      else dash.draw('sync-text');
    } catch (e) { /* a missed check is retried on the next tick */ }
    checking = false;
  }
  setInterval(checkForChanges, 30 * 1000);
  setInterval(() => { if (document.visibilityState === 'visible' && S.status === 'ok') load(false); }, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.loadedAt) { if (Date.now() - S.loadedAt > 10 * 60 * 1000) load(false); else checkForChanges(); } });

  /* ================= Helpers ================= */
  const CO = (() => {
    const pad = (n) => String(n).padStart(2, '0');
    const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const today = () => isoOf(new Date());
    const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return isoOf(d); };
    const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const fmtDate = (s, withYear) => { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return d + ' ' + MON[m - 1] + (withYear || y !== new Date().getFullYear() ? ' ' + y : ''); };
    const thisMonth = () => today().slice(0, 7);
    const prevMonth = (k) => { const [y, m] = k.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + pad(m - 1); };
    const fmtMonth = (k, long) => { if (!k) return '—'; const [y, m] = k.split('-').map(Number); return (long ? MONTHS[m - 1] : MON[m - 1]) + ' ' + y; };
    const monthStart = (k) => k + '-01';
    const monthEnd = (k) => { const [y, m] = k.split('-').map(Number); return isoOf(new Date(y, m, 0)); };
    const addMonths = (k, n) => { const [y, m] = k.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
    const num = (n) => d3.format(',')(Math.round(n));
    const sumQty = (rs) => rs.reduce((a, r) => a + (r.qty || 1), 0);
    const CLOSED = new Set(['Delivered', 'Dropped']);
    const VIDEO = /video|gif|reel/i;

    let teamMemo = { data: undefined, out: null };
    const team = () => {
      const data = S.team;
      if (teamMemo.data === data && teamMemo.out) return teamMemo.out;
      const byKey = new Map(), alias = new Map(), first = new Map();
      (data || []).forEach((m) => {
        const rec = { name: m.name, status: m.status, role: m.role || '', listed: true };
        byKey.set(m.name.toLowerCase(), rec);
        (m.aliases || '').split(/[,;\/]/).map((a) => a.trim().toLowerCase()).filter(Boolean).forEach((a) => alias.set(a, rec));
        const f = m.name.split(' ')[0].toLowerCase(); first.set(f, first.has(f) ? null : rec);
      });
      const resolve = (n) => { const k = n.toLowerCase(); return byKey.get(k) || alias.get(k) || first.get(k.split(' ')[0]) || null; };
      teamMemo = { data, out: { ok: !!(data && data.length), byKey, resolve } };
      return teamMemo.out;
    };
    const canon = (n) => { const r = team().resolve(n); return r ? r.name : n; };
    const member = (n) => { const t = team(); const r = t.resolve(n); return r || { name: n, status: t.ok ? 'New' : 'Active', role: '', listed: false }; };
    const isActive = (n) => member(n).status !== 'Inactive';

    const due = (r, t) => {
      if (!r.open) return '';
      if (!r.eta) return 'noeta';
      const d = diffDays(t, r.eta);
      if (d < 0) return 'overdue';
      if (d === 0) return 'today';
      if (d <= 7) return 'week';
      return 'later';
    };
    let memo = { rows: null, team: null, key: '', out: null };
    const status = () => dash.data('tasks').status;
    const all = () => (S.status === 'ok' ? S.tasks : null);
    const rows = () => {
      const a = all(); if (!a) return null;
      const p = dash.params(), tm = team();
      const key = [p.src, p.designer, p.brand, p.type, today()].join('|');
      if (memo.rows === a && memo.team === tm && memo.key === key) return memo.out;
      const t = today(), out = [];
      for (const r0 of a) {
        if (p.src && r0.source !== p.src) continue;
        if (p.brand && r0.brand !== p.brand) continue;
        if (p.type && r0.type !== p.type) continue;
        const list = r0.designers ? [...new Set(r0.designers.split(' + ').map(canon))] : [];
        if (p.designer && (p.designer === '__none' ? list.length : !list.includes(p.designer))) continue;
        const r = Object.assign({}, r0, { list, designers: list.join(' + ') });
        r.due = due(r, t);
        out.push(r);
      }
      memo = { rows: a, team: tm, key, out };
      return out;
    };
    const stageMatch = (r, s, ctx) => {
      switch (s) {
        case 'active': return !CLOSED.has(r.stage);
        case 'open': return r.open;
        case 'tbp': return r.stage === 'To be planned';
        case 'wip': return r.stage === 'In progress';
        case 'changes': return r.stage === 'Changes requested';
        case 'overdue': case 'today': case 'week': case 'noeta': return r.due === s;
        case 'review': return r.stage === 'Under review';
        case 'awaiting': return r.stage === 'Awaiting brief';
        case 'hold': return r.stage === 'On hold';
        case 'delivered': return r.stage === 'Delivered';
        case 'delivered-month': return r.stage === 'Delivered' && r.month === thisMonth();
        case 'delivered-range': return r.stage === 'Delivered' && r.ddate && r.ddate >= ctx.from && r.ddate <= ctx.to;
        case 'dropped': return r.stage === 'Dropped';
        default: return true;
      }
    };
    const stageColor = (s) => ({ 'In progress': colors[0], 'Under review': colors[2], 'To be planned': colors[1], 'Awaiting brief': colors[3] })[s];
    const chip = (r) => {
      const el = document.createElement('span');
      let cls = 's-mute', txt = r.stage;
      if (r.due === 'overdue') { cls = 's-bad'; txt = r.stage + ' · late'; }
      else if (r.due === 'today') { cls = 's-warn'; txt = r.stage + ' · today'; }
      else if (r.stage === 'Changes requested') cls = 's-warn';
      else if (r.stage === 'Delivered') cls = 's-ok';
      else if (stageColor(r.stage)) { cls = ''; el.style.color = stageColor(r.stage); }
      el.className = 'chip ' + cls; el.textContent = txt;
      return el;
    };
    const td = (tr, text, cls) => { const c = tr.insertCell(); if (cls) c.className = cls; if (text instanceof Node) c.append(text); else c.textContent = text == null || text === '' ? '—' : text; return c; };
    const safeUrl = (u) => /^https?:\/\//i.test(u || '');
    const links = (r) => {
      const span = document.createElement('span'); span.className = 'co-links';
      const add = (u, label) => { if (safeUrl(u)) { const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label; span.append(a); } };
      add(r.brief, 'Brief'); add(r.link, 'Creative'); add(r.file, 'Source file');
      if (!span.childNodes.length) span.textContent = '—';
      return span;
    };
    const topic = (r) => { if (!safeUrl(r.topic)) return r.topic; const a = document.createElement('a'); a.href = r.topic; a.target = '_blank'; a.rel = 'noopener'; a.className = 'co-muted'; a.textContent = /drive\.google/.test(r.topic) ? 'Reference folder' : 'Reference link'; return a; };
    const topicText = (r) => safeUrl(r.topic) ? 'Reference folder' : (r.topic || 'Untitled');
    const srcTag = (r) => { const s = document.createElement('span'); s.className = 'src'; s.textContent = r.source === 'Paid' ? 'Paid' : 'Mkt'; return s; };
    const emptyRow = (tbody, cols, text) => { const tr = tbody.insertRow(); tr.className = 'co-empty'; const c = tr.insertCell(); c.colSpan = cols; c.textContent = text; };
    const notReady = (el, mode) => {
      const s = status();
      el.classList.toggle('is-refreshing', !!S.refreshing && s === 'ok');
      if (s === 'ok') { el.classList.remove('skeleton'); return false; }
      if (mode === 'text') el.textContent = '—';
      else el.replaceChildren();
      el.classList.toggle('skeleton', S.status === 'loading');
      return true;
    };
    const goTasks = (stage, extra) => dash.setParams(Object.assign({ tab: 'tasks', stage }, extra || {}));
    const typeColors = (types) => { const m = new Map(); types.forEach((t, i) => m.set(t, t === 'Other' ? 'var(--chart-muted)' : colors[i % colors.length])); return m; };
    const topTypes = (rs, n) => { const c = d3.rollups(rs, (v) => sumQty(v), (r) => r.type).sort((a, b) => b[1] - a[1]); const top = c.slice(0, n).map((d) => d[0]); return c.length > n ? top.concat('Other') : top; };
    const typeOf = (r, top) => top.includes(r.type) ? r.type : 'Other';
    const tip = (host) => { const t = document.createElement('div'); t.className = 'co-tip'; t.hidden = true; host.append(t); return t; };
    const placeTip = (t, host, x, y) => { t.hidden = false; const w = t.offsetWidth, hw = host.clientWidth; t.style.left = Math.max(0, Math.min(hw - w, x - w / 2)) + 'px'; t.style.top = Math.max(0, y - t.offsetHeight - 10) + 'px'; };
    const sign = (d) => (d > 0 ? '+' : d < 0 ? '−' : '±') + num(Math.abs(d));
    const delta = (cur, prev) => { const d = cur - prev; const s = document.createElement('span'); s.className = d > 0 ? 'co-up' : d < 0 ? 'co-down' : ''; s.textContent = sign(d) + (prev ? ' (' + (d >= 0 ? '+' : '−') + Math.round(Math.abs(d) / prev * 100) + '%)' : ''); return s; };
    const period = () => {
      const p = dash.params(), t = today(), m = thisMonth();
      const preset = p.rpreset || 'this-month';
      const qStart = (k) => { const [y, mm] = k.split('-').map(Number); return y + '-' + pad(Math.floor((mm - 1) / 3) * 3 + 1); };
      let from, to, pfrom = null, pto = null;
      const prevSpan = (startK, months, partial) => {
        const ps = addMonths(startK, -months);
        pfrom = monthStart(ps);
        if (partial) { const cand = addDays(pfrom, diffDays(from, to)); const cap = monthEnd(addMonths(startK, -1)); pto = cand > cap ? cap : cand; }
        else pto = monthEnd(addMonths(startK, -1));
      };
      if (preset === 'custom' && p.rfrom && p.rto) {
        from = p.rfrom <= p.rto ? p.rfrom : p.rto; to = p.rfrom <= p.rto ? p.rto : p.rfrom;
        if (from.endsWith('-01') && to === monthEnd(to.slice(0, 7))) { const n = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1; prevSpan(from.slice(0, 7), n, false); }
        else { const len = diffDays(from, to); pto = addDays(from, -1); pfrom = addDays(pto, -len); }
      }
      else if (preset === 'last-month') { const k = prevMonth(m); from = monthStart(k); to = monthEnd(k); prevSpan(k, 1, false); }
      else if (preset === 'last-3') { const k = addMonths(m, -3); from = monthStart(k); to = monthEnd(prevMonth(m)); prevSpan(k, 3, false); }
      else if (preset === 'this-quarter') { const k = qStart(m); from = monthStart(k); to = t; prevSpan(k, 3, true); }
      else if (preset === 'last-quarter') { const k = addMonths(qStart(m), -3); from = monthStart(k); to = monthEnd(addMonths(k, 2)); prevSpan(k, 3, false); }
      else if (preset === 'ytd') { from = t.slice(0, 4) + '-01-01'; to = t; pfrom = (Number(t.slice(0, 4)) - 1) + '-01-01'; pto = (Number(t.slice(0, 4)) - 1) + t.slice(4); }
      else if (preset === 'last-12') { const k = addMonths(m, -11); from = monthStart(k); to = t; prevSpan(k, 12, true); }
      else if (preset === 'all') { from = '2000-01-01'; to = '2099-12-31'; }
      else { from = monthStart(m); to = t; prevSpan(m, 1, true); }
      return { preset, from, to, pfrom, pto, all: preset === 'all' };
    };
    const label = (f, t) => {
      if (f === '2000-01-01') return 'all time';
      if (f.endsWith('-01') && f.slice(0, 7) === t.slice(0, 7)) return fmtMonth(f.slice(0, 7), true) + (t < monthEnd(f.slice(0, 7)) ? ' (1–' + Number(t.slice(8)) + ')' : '');
      if (f.endsWith('-01') && t === monthEnd(t.slice(0, 7))) return fmtMonth(f.slice(0, 7)) + ' – ' + fmtMonth(t.slice(0, 7));
      return fmtDate(f, true) + ' – ' + fmtDate(t, true);
    };
    const csv = (filename, header, rows) => {
      const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const text = [header.map(q).join(',')].concat(rows.map((r) => r.map(q).join(','))).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
      a.download = filename; document.body.append(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    return { today, addDays, diffDays, fmtDate, fmtMonth, thisMonth, prevMonth, monthEnd, addMonths, num, sumQty, CLOSED, VIDEO, team, member, isActive, canon, all, rows, status, stageMatch, stageColor, chip, td, links, topic, topicText, srcTag, emptyRow, notReady, goTasks, typeColors, topTypes, typeOf, tip, placeTip, sign, delta, period, label, csv };
  })();

  /* ================= Controls ================= */
  function syncControls() {
    const p = dash.params();
    const tab = TABS.includes(p.tab) ? p.tab : 'today';
    document.querySelectorAll('[data-panel]').forEach((s) => { s.hidden = s.dataset.panel !== tab; });
    document.querySelectorAll('.co-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const val = (sel, v) => { const el = document.querySelector(sel); if (el && el !== document.activeElement) el.value = v; };
    val('#f-src', p.src || ''); val('#t-stage', p.stage || 'active'); val('#su-sort', p.susort || 'urgent'); val('#team-who', p.who || 'active'); val('#r-preset', p.rpreset || 'this-month');
    const pr = CO.period();
    val('#r-from', pr.all ? '' : pr.from); val('#r-to', pr.all ? '' : pr.to);
    const banner = document.getElementById('banner');
    banner.hidden = !(S.status === 'unconfigured' || S.status === 'error');
  }
  document.querySelectorAll('.co-tab').forEach((b) => b.addEventListener('click', () => dash.setParams({ tab: b.dataset.tab })));
  document.querySelectorAll('.co-f').forEach((s) => s.addEventListener('change', () => dash.setParams({ [s.dataset.param]: s.value })));
  document.getElementById('f-reset').addEventListener('click', () => dash.setParams({ src: '', designer: '', brand: '', type: '' }));
  document.querySelectorAll('.co-kpi[data-go]').forEach((b) => b.addEventListener('click', () => CO.goTasks(b.dataset.go)));
  document.getElementById('t-stage').addEventListener('change', (e) => dash.setParams({ stage: e.target.value }));
  document.getElementById('su-sort').addEventListener('change', (e) => dash.setParams({ susort: e.target.value }));
  document.getElementById('team-who').addEventListener('change', (e) => dash.setParams({ who: e.target.value }));
  document.getElementById('r-preset').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'custom') { const pr = CO.period(); dash.setParams({ rpreset: 'custom', rfrom: pr.all ? CO.today().slice(0, 4) + '-01-01' : pr.from, rto: pr.all ? CO.today() : pr.to }); }
    else dash.setParams({ rpreset: v });
  });
  [['#r-from', 'rfrom'], ['#r-to', 'rto']].forEach(([sel, key]) => {
    const inp = document.querySelector(sel);
    inp.addEventListener('change', () => {
      if (!inp.value || !inp.validity.valid) return;
      const pr = CO.period();
      const other = key === 'rfrom' ? { rto: pr.all ? CO.today() : pr.to } : { rfrom: pr.all ? CO.today().slice(0, 4) + '-01-01' : pr.from };
      dash.setParams(Object.assign({ rpreset: 'custom' }, other, { [key]: inp.value }));
    });
    inp.addEventListener('blur', () => { const pr = CO.period(); inp.value = pr.all ? '' : (key === 'rfrom' ? pr.from : pr.to); });
  });
  const themeLabel = () => { const root = document.documentElement; const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; document.getElementById('btn-theme').textContent = dark ? 'Light theme' : 'Dark theme'; };
  themeLabel();
  document.getElementById('btn-refresh').addEventListener('click', () => load(true));
  document.getElementById('btn-theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark'; LS.set('co.theme', root.dataset.theme); themeLabel(); renderAll();
  });

  /* Connection dialog */
  const dlg = document.getElementById('settings');
  const openSettings = () => {
    const c = conn();
    document.getElementById('set-url').value = c.url; document.getElementById('set-key').value = c.key;
    document.getElementById('set-msg').textContent = S.error && S.status !== 'ok' ? S.error : '';
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  };
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-connect').addEventListener('click', openSettings);
  document.getElementById('set-cancel').addEventListener('click', () => dlg.close());
  document.getElementById('set-forget').addEventListener('click', () => { LS.set('co.api', null); LS.set('co.key', null); S.tasks = null; S.team = null; S.status = 'unconfigured'; dlg.close(); renderAll(); });
  document.getElementById('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = document.getElementById('set-url').value.trim(), key = document.getElementById('set-key').value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { document.getElementById('set-msg').textContent = 'The URL should start with https://script.google.com/macros/s/ and end with /exec.'; return; }
    LS.set('co.api', url); LS.set('co.key', key); dlg.close(); S.status = 'loading'; load(true);
  });

  /* Team edits */
  async function setMember(name, status, role) {
    const prev = S.team;
    const next = (S.team || []).filter((m) => m.name.toLowerCase() !== name.toLowerCase());
    const old = (S.team || []).find((m) => m.name.toLowerCase() === name.toLowerCase());
    next.push(Object.assign({ name, aliases: '', notes: '' }, old || {}, { status, role: role != null ? role : (old ? old.role : '') }));
    S.team = next; renderAll();
    try { await post({ action: 'setMember', name, status, role }); toast(name + (old ? ' is now ' + status : ' added to the team list')); }
    catch (err) { S.team = prev; renderAll(); toast('Could not save: ' + err.message + '. Check the web app is redeployed with the latest code.', true); }
  }
  document.getElementById('add-member').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('add-name').value.replace(/\s+/g, ' ').trim(), role = document.getElementById('add-role').value.trim();
    if (!name) return;
    if (S.status !== 'ok') { document.getElementById('add-msg').textContent = 'Connect the dashboard first.'; return; }
    setMember(name, 'Active', role); e.target.reset(); document.getElementById('add-msg').textContent = '';
  });
  let toastTimer = 0;
  function toast(text, bad) {
    let t = document.querySelector('.co-toast');
    if (!t) { t = document.createElement('div'); t.className = 'co-toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = text; t.classList.toggle('bad', !!bad); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  /* ================= Header, sync state and filters ================= */
  dash.draw('today-date', (el) => { el.textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); });
  dash.draw('sync-dot', (el) => { el.className = 'co-sync-dot ' + (S.status === 'ok' ? (S.staleError ? 'warn' : 'ok') : S.status === 'error' ? 'bad' : S.status === 'loading' ? 'busy' : ''); });
  dash.draw('sync-text', (el) => {
    if (S.status === 'ok') {
      const at = new Date(S.generatedAt || S.loadedAt);
      const live = S.ver && S.ver !== '0';
      el.textContent = (S.refreshing ? 'Syncing… ' : live ? 'Live · ' : '') + 'sheets read at ' + at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + (S.staleError ? ' · last refresh failed' : '');
      el.title = live ? 'Checks the sheets for changes every 30 seconds' : 'Run setup() in Apps Script to turn on instant change detection';
    } else el.textContent = S.status === 'loading' ? 'Loading sheets…' : S.status === 'error' ? 'Could not load' : 'Not connected';
  });
  dash.draw('banner-title', (el) => { el.textContent = S.status === 'error' ? 'The sheets could not be loaded' : 'Connect the dashboard to your sheets'; });
  dash.draw('banner-text', (el) => { el.textContent = S.status === 'error' ? S.error : 'Paste the web app URL and key from the Apps Script set-up (see the README). They are kept in this browser only.'; });
  dash.draw('foot', (el) => {
    const src = S.sources || {};
    const parts = Object.keys(src).map((k) => (src[k].error ? '⚠ ' : '') + (src[k].file ? src[k].file + ' / ' + src[k].tab : k) + (src[k].rows ? ' (' + CO.num(src[k].rows.length) + ' rows)' : ''));
    el.textContent = parts.length ? 'Sources: ' + parts.join(' · ') : 'Data is read live from the Google Sheets through your Apps Script web app.';
  });
  dash.draw('integration', (el) => {
    el.replaceChildren();
    const h = S.health; if (!h || S.status !== 'ok') return;
    const row = (k, v, cls) => { const r = document.createElement('div'); r.className = 'row'; const a = document.createElement('span'); a.className = 'k'; a.textContent = k; const b = document.createElement('span'); if (cls) b.className = cls; b.textContent = v; r.append(a, b); el.append(r); };
    row('Connected as', h.runsAs || 'unknown');
    row('Live change detection', h.liveTriggers ? 'On: sheet edits show here within about 30 seconds' : 'Off: run setup in Apps Script to turn it on (until then, changes arrive every 10 minutes)', h.liveTriggers ? 'good' : 'warn');
    const label = new Proxy({}, { get: (_, k) => { const s = (h.sources || {})[k]; return s && s.file ? s.file + ' / ' + (s.tab || 'first tab') : k; } });
    Object.keys(h.sources || {}).forEach((k) => {
      const s = h.sources[k];
      if (!s.ok) return row(label[k] || k, (s.optional ? 'Not loaded (optional): ' : 'Cannot open: ') + s.error, s.optional ? 'warn' : 'bad');
      row(label[k] || k, (s.canEdit ? 'can read and edit' : 'read only: dashboard edits to this sheet will fail') + ' (tab size ' + CO.num(s.rows) + ' rows)', s.canEdit ? 'good' : 'warn');
    });
  });
  dash.draw('sources-note', (el) => {
    const src = S.sources || {};
    const bad = Object.keys(src).filter((k) => src[k] && src[k].error);
    el.textContent = bad.length ? 'Not loaded: ' + bad.map((k) => k + ' (' + src[k].error + ')').join('; ') : '';
  });

  const count = (key) => (el) => {
    if (CO.notReady(el, 'text')) return;
    const rs = CO.rows(), m = CO.thisMonth();
    const n = key === 'open' ? rs.filter((r) => r.open).length
      : key === 'wip' ? rs.filter((r) => r.stage === 'In progress').length
      : key === 'delivered' ? CO.sumQty(rs.filter((r) => r.stage === 'Delivered' && r.month === m))
      : rs.filter((r) => r.due === key).length;
    el.textContent = CO.num(n);
  };
  dash.draw('t-open', count('open'));
  dash.draw('t-overdue', count('overdue'));
  dash.draw('t-today', count('today'));
  dash.draw('t-wip', count('wip'));
  dash.draw('t-delivered', count('delivered'));

  const fill = (sel, allLabel, values, current) => { sel.replaceChildren(new Option(allLabel, ''), ...values.map((v) => new Option(v, v))); sel.value = current || ''; };
  dash.draw('f-designer', (sel) => {
    if (sel === document.activeElement) return;
    const a = CO.all(); if (!a) { sel.replaceChildren(new Option('All designers', '')); return; }
    const c = new Map(); a.forEach((r) => r.designers && r.designers.split(' + ').forEach((d) => { const n = CO.canon(d); c.set(n, (c.get(n) || 0) + 1); }));
    CO.team().byKey.forEach((m) => { if (!c.has(m.name)) c.set(m.name, 0); });
    const names = [...c].sort((x, y) => y[1] - x[1]).map((d) => d[0]);
    const groups = [['Active', names.filter((n) => CO.member(n).status === 'Active')], ['New, not on team list', names.filter((n) => CO.member(n).status === 'New')], ['Inactive', names.filter((n) => CO.member(n).status === 'Inactive')]];
    const kids = [new Option('All designers', ''), new Option('Unassigned', '__none')];
    groups.forEach(([lab, list]) => { if (!list.length) return; const g = document.createElement('optgroup'); g.label = lab; list.forEach((n) => g.append(new Option(n, n))); kids.push(g); });
    sel.replaceChildren(...kids); sel.value = dash.params().designer || '';
  });
  dash.draw('f-brand', (sel) => {
    if (sel === document.activeElement) return;
    const a = CO.all(); if (!a) { sel.replaceChildren(new Option('All brands', '')); return; }
    fill(sel, 'All brands', [...new Set(a.map((r) => r.brand))].sort((x, y) => x.localeCompare(y)), dash.params().brand);
  });
  dash.draw('f-type', (sel) => {
    if (sel === document.activeElement) return;
    const a = CO.all(); if (!a) { sel.replaceChildren(new Option('All types', '')); return; }
    fill(sel, 'All types', d3.rollups(a, (v) => v.length, (r) => r.type).sort((x, y) => y[1] - x[1]).map((d) => d[0]), dash.params().type);
  });

  /* ================= Today ================= */
  const tiles = {
    open: (rs) => rs.filter((r) => r.open),
    wip: (rs) => rs.filter((r) => r.stage === 'In progress'),
    overdue: (rs) => rs.filter((r) => r.due === 'overdue'),
    today: (rs) => rs.filter((r) => r.due === 'today'),
    review: (rs) => rs.filter((r) => r.stage === 'Under review'),
    delivered: (rs) => rs.filter((r) => r.stage === 'Delivered' && r.month === CO.thisMonth())
  };
  dash.draw('kpi', (el) => {
    if (CO.notReady(el, 'text')) return;
    const list = tiles[el.dataset.kpi](CO.rows());
    el.textContent = CO.num(el.dataset.kpi === 'delivered' ? CO.sumQty(list) : list.length);
  });
  dash.draw('kpi-sub', (el) => {
    if (CO.notReady(el, 'text')) return;
    const rs = CO.rows(), k = el.dataset.kpi, list = tiles[k](rs);
    el.replaceChildren();
    if (k === 'open') { const n = rs.filter((r) => r.due === 'noeta').length; el.textContent = CO.num(CO.sumQty(list)) + ' creatives' + (n ? ' · ' + n + ' without ETA' : ''); }
    else if (k === 'wip') { el.textContent = rs.filter((r) => r.stage === 'To be planned').length + ' to be planned (TBP)'; }
    else if (k === 'overdue') { if (!list.length) { el.textContent = 'Nothing late'; return; } const worst = Math.max(...list.map((r) => CO.diffDays(r.eta, CO.today()))); el.textContent = 'Oldest ' + worst + (worst === 1 ? ' day' : ' days') + ' late'; }
    else if (k === 'today') { el.textContent = rs.filter((r) => r.due === 'week').length + ' more in the next 7 days'; }
    else if (k === 'review') { el.textContent = rs.filter((r) => r.stage === 'Awaiting brief').length + ' awaiting brief'; }
    else if (k === 'delivered') {
      const pm = CO.prevMonth(CO.thisMonth()), day = Number(CO.today().slice(8));
      const prevSame = CO.sumQty(rs.filter((r) => r.stage === 'Delivered' && r.month === pm && Number(r.ddate.slice(8)) <= day));
      el.append(CO.delta(CO.sumQty(list), prevSame), ' vs same days of ' + CO.fmtMonth(pm).split(' ')[0]);
    }
  });
  const whenChip = (r) => { const s = document.createElement('span'); const d = r.eta ? CO.diffDays(CO.today(), r.eta) : null; s.className = 'chip ' + (d == null ? 's-mute' : d < 0 ? 's-bad' : d === 0 ? 's-warn' : r.stage === 'Changes requested' ? 's-warn' : 's-mute'); s.textContent = d == null ? 'No ETA' : d < 0 ? (-d) + 'd late' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : 'In ' + d + 'd'; return s; };
  const cells = (tr, r, cols) => {
    tr.dataset.uid = r.uid; tr.classList.add('click');
    for (const c of cols) {
      if (c === 'when') CO.td(tr, whenChip(r), 'co-nowrap');
      else if (c === 'id') CO.td(tr, r.id || '—', 'co-id');
      else if (c === 'topic') CO.td(tr, CO.topic(r), 'co-topic');
      else if (c === 'stage') CO.td(tr, CO.chip(r));
      else if (c === 'eta') CO.td(tr, CO.fmtDate(r.eta), 'co-nowrap');
      else if (c === 'qty') CO.td(tr, String(r.qty), 'n');
      else if (c === 'designers') CO.td(tr, r.designers || 'Unassigned', r.designers ? 'co-nowrap' : 'co-muted co-nowrap');
      else if (c === 'links') CO.td(tr, CO.links(r), 'co-hide-sm');
      else if (c === 'source') CO.td(tr, CO.srcTag(r));
      else CO.td(tr, r[c], 'co-nowrap');
    }
  };
  dash.draw('attention', (tb) => {
    if (CO.notReady(tb, 'table')) return;
    tb.replaceChildren();
    const tm = CO.addDays(CO.today(), 1);
    const list = CO.rows().filter((r) => r.due === 'overdue' || r.due === 'today' || (r.open && r.eta === tm) || r.stage === 'Changes requested')
      .sort((a, b) => (a.eta || '9999').localeCompare(b.eta || '9999') || (a.priority || 'P9').localeCompare(b.priority || 'P9'));
    if (!list.length) return CO.emptyRow(tb, 10, 'Nothing overdue or due today. The team is on schedule.');
    list.forEach((r) => cells(tb.insertRow(), r, ['when', 'id', 'brand', 'topic', 'type', 'qty', 'designers', 'stage', 'eta', 'links']));
  });
  dash.draw('upcoming', (tb) => {
    if (CO.notReady(tb, 'table')) return;
    tb.replaceChildren();
    const t = CO.today(), lim = CO.addDays(t, 14);
    const list = CO.rows().filter((r) => r.open && (!r.eta || (r.eta > t && r.eta <= lim))).sort((a, b) => (a.eta || '9999').localeCompare(b.eta || '9999'));
    if (!list.length) return CO.emptyRow(tb, 9, 'No open work due in the next two weeks.');
    list.forEach((r) => { const tr = tb.insertRow(); CO.td(tr, r.eta ? CO.fmtDate(r.eta) : whenChip(r), 'co-nowrap'); cells(tr, r, ['id', 'brand', 'topic', 'type', 'qty', 'designers', 'stage', 'source']); });
  });
  dash.draw('workload', (el) => {
    if (CO.notReady(el, 'box')) return;
    const m = new Map();
    const openRows = CO.rows().filter((r) => r.open);
    const unassigned = openRows.filter((r) => !r.list.length);
    openRows.forEach((r) => { r.list.filter(CO.isActive).forEach((d) => { const o = m.get(d) || { name: d, overdue: 0, week: 0, later: 0 }; const q = r.qty || 1; if (r.due === 'overdue') o.overdue += q; else if (r.due === 'today' || r.due === 'week') o.week += q; else o.later += q; m.set(d, o); }); });
    const data = [...m.values()].map((d) => Object.assign(d, { total: d.overdue + d.week + d.later })).sort((a, b) => b.total - a.total);
    el.replaceChildren();
    if (unassigned.length) { const b = document.createElement('button'); b.type = 'button'; b.className = 'co-unassigned'; b.textContent = CO.num(CO.sumQty(unassigned)) + ' open creatives have no designer yet' + (unassigned.some((r) => r.due === 'overdue') ? ', ' + unassigned.filter((r) => r.due === 'overdue').length + ' of them overdue' : '') + '. Assign them →'; b.addEventListener('click', () => CO.goTasks('open', { designer: '__none' })); el.append(b); }
    if (!data.length) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'No open work assigned in this view.'; el.append(p); return; }
    const W = Math.max(280, el.clientWidth), rowH = 28, H = data.length * rowH + 24;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Open creatives per designer');
    const meas = svg.append('text').attr('class', 'lbl').text(data.reduce((a, d) => d.name.length > a.length ? d.name : a, ''));
    const L = Math.min(W * 0.45, meas.node().getComputedTextLength() + 14); meas.remove();
    const x = d3.scaleLinear([0, d3.max(data, (d) => d.total)], [L, W - 34]);
    const y = d3.scaleBand(data.map((d) => d.name), [0, H - 24]).padding(0.28);
    const keys = [['overdue', 'var(--bad)', 'Overdue'], ['week', 'var(--warn)', 'Due in 7 days'], ['later', 'var(--chart-muted)', 'Later or no ETA']];
    const ticks = x.ticks(Math.max(2, Math.floor((W - L) / 70))).filter(Number.isInteger);
    svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'grid').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', H - 24);
    svg.append('g').selectAll('text').data(ticks).join('text').attr('class', 'tick').attr('x', x).attr('y', H - 8).attr('text-anchor', 'middle').text((d) => d);
    const tipEl = CO.tip(el);
    const g = svg.append('g').selectAll('g').data(data).join('g').attr('class', 'bar')
      .on('click', (e, d) => CO.goTasks('open', { designer: d.name }))
      .on('mousemove', (e, d) => { tipEl.replaceChildren(); const k = document.createElement('div'); k.className = 'k'; k.textContent = d.name + ' · ' + d.total + ' open'; tipEl.append(k); keys.forEach(([key, c, lab]) => { const r = document.createElement('div'); const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = c; r.append(sw, lab + ': ' + d[key]); tipEl.append(r); }); const [px, py] = d3.pointer(e, el); CO.placeTip(tipEl, el, px, py); })
      .on('mouseleave', () => { tipEl.hidden = true; });
    g.append('text').attr('class', 'lbl').attr('x', L - 8).attr('y', (d) => y(d.name) + y.bandwidth() / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text((d) => d.name);
    g.each(function (d) { let x0 = 0; const gg = d3.select(this); keys.forEach(([k, c]) => { if (!d[k]) return; gg.append('rect').attr('x', x(x0)).attr('y', y(d.name)).attr('width', Math.max(1, x(x0 + d[k]) - x(x0) - 1)).attr('height', y.bandwidth()).attr('rx', 3).style('fill', c); x0 += d[k]; }); });
    g.append('text').attr('class', 'tick').attr('x', (d) => x(d.total) + 6).attr('y', (d) => y(d.name) + y.bandwidth() / 2).attr('dy', '0.35em').text((d) => d.total);
  });
  dash.draw('pipeline', (el) => {
    if (CO.notReady(el, 'box')) return;
    const rs = CO.rows().filter((r) => !CO.CLOSED.has(r.stage));
    const base = [['To be planned', 'tbp'], ['In progress', 'wip'], ['Changes requested', 'changes'], ['Under review', 'review'], ['Awaiting brief', 'awaiting'], ['On hold', 'hold']];
    const known = new Set(base.map((b) => b[0]));
    const other = [...new Set(rs.map((r) => r.stage).filter((s) => !known.has(s)))];
    const color = (s) => s === 'Changes requested' ? 'var(--warn)' : s === 'On hold' ? 'var(--chart-muted)' : CO.stageColor(s) || colors[4];
    const st = base.concat(other.map((s) => [s, 'active'])).map(([s, go]) => ({ s, go, c: color(s), n: rs.filter((r) => r.stage === s).length }));
    const total = d3.sum(st, (d) => d.n);
    el.replaceChildren();
    const bar = document.createElement('div'); bar.className = 'co-pipe'; bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', 'Pipeline by design status');
    st.forEach((d) => { if (!d.n) return; const s = document.createElement('div'); s.style.flex = d.n + ' 1 0'; s.style.background = d.c; bar.append(s); });
    const leg = document.createElement('div'); leg.className = 'co-pipe-legend';
    st.forEach((d) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'co-pipe-item';
      const v = document.createElement('span'); v.className = 'v'; v.textContent = CO.num(d.n);
      const l = document.createElement('span'); l.className = 'l'; const i = document.createElement('i'); i.style.background = d.c; l.append(i, d.s + (total ? ' · ' + Math.round(d.n / total * 100) + '%' : ''));
      b.append(v, l); b.addEventListener('click', () => CO.goTasks(d.go)); leg.append(b);
    });
    el.append(bar, leg);
  });

  /* ================= Stand-up ================= */
  (() => {
    const line = (r) => {
      const d = document.createElement('div'); d.className = 'su-item click'; d.dataset.uid = r.uid; d.tabIndex = 0;
      const t = document.createElement('span'); t.className = 't'; const b = document.createElement('b'); b.textContent = r.brand; t.append(b, ' · ' + CO.topicText(r));
      const m = document.createElement('span'); m.className = 'm';
      const dd = r.eta ? CO.diffDays(CO.today(), r.eta) : null;
      m.textContent = (r.qty > 1 ? r.qty + '× · ' : '') + (dd == null ? 'No ETA' : dd < 0 ? (-dd) + 'd late' : dd === 0 ? 'Today' : dd === 1 ? 'Tomorrow' : CO.fmtDate(r.eta));
      if (dd != null && dd < 0) m.classList.add('bad'); else if (dd === 0) m.classList.add('warn');
      const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = [r.id, r.type, r.stage, r.priority, r.source === 'Paid' ? 'Paid' : 'Mkt'].filter(Boolean).join(' · ');
      d.append(t, m, meta); return d;
    };
    const section = (title, list, max, onMore) => {
      if (!list.length) return null;
      const s = document.createElement('div'); s.className = 'su-sec';
      const h = document.createElement('h3'); h.textContent = title + ' · ' + list.length; s.append(h);
      list.slice(0, max).forEach((r) => s.append(line(r)));
      if (list.length > max) { const b = document.createElement('button'); b.type = 'button'; b.className = 'co-link'; b.textContent = '+' + (list.length - max) + ' more'; b.addEventListener('click', onMore); s.append(b); }
      return s;
    };
    const byEta = (a, b) => (a.eta || '9999').localeCompare(b.eta || '9999');
    dash.draw('standup', (el) => {
      if (CO.notReady(el, 'box')) return;
      const rs = CO.rows(), t = CO.today(), wkAgo = CO.addDays(t, -6);
      const people = new Map();
      CO.team().byKey.forEach((m) => { if (m.status === 'Active') people.set(m.name, []); });
      rs.forEach((r) => {
        const recentDone = r.stage === 'Delivered' && r.ddate && r.ddate >= wkAgo && r.ddate <= t;
        if (CO.CLOSED.has(r.stage) && !recentDone) return;
        if (!r.list.length) { if (r.open) { if (!people.has('Unassigned')) people.set('Unassigned', []); people.get('Unassigned').push(r); } return; }
        r.list.forEach((d) => { if (!CO.isActive(d)) return; if (!people.has(d)) people.set(d, []); people.get(d).push(r); });
      });
      const p = dash.params();
      if (p.designer && p.designer !== '__none') [...people.keys()].forEach((k) => { if (k !== p.designer) people.delete(k); });
      if (p.designer === '__none') [...people.keys()].forEach((k) => { if (k !== 'Unassigned') people.delete(k); });
      const notLateOrToday = (r) => r.due !== 'overdue' && r.due !== 'today';
      const cards = [...people].map(([name, list]) => {
        const open = list.filter((r) => r.open);
        return { name, open, overdue: open.filter((r) => r.due === 'overdue').sort(byEta), today: open.filter((r) => r.due === 'today'),
          wip: open.filter((r) => r.stage === 'In progress' && notLateOrToday(r)).sort(byEta),
          changes: open.filter((r) => r.stage === 'Changes requested' && notLateOrToday(r)).sort(byEta),
          next: open.filter((r) => r.stage !== 'In progress' && r.stage !== 'Changes requested' && notLateOrToday(r)).sort(byEta),
          review: list.filter((r) => r.stage === 'Under review'), done: list.filter((r) => r.stage === 'Delivered') };
      });
      const sort = p.susort || 'urgent';
      cards.sort((a, b) => (a.name === 'Unassigned') - (b.name === 'Unassigned') || (sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'load' ? CO.sumQty(b.open) - CO.sumQty(a.open) || a.name.localeCompare(b.name)
        : b.overdue.length - a.overdue.length || b.today.length - a.today.length || CO.sumQty(b.open) - CO.sumQty(a.open) || a.name.localeCompare(b.name)));
      el.replaceChildren();
      if (!cards.length) { const n = document.createElement('p'); n.className = 'co-note'; n.textContent = 'No active team members match these filters.'; el.append(n); return; }
      cards.forEach((c) => {
        const card = document.createElement('article'); card.className = 'su ' + (c.overdue.length ? 'late' : c.open.length ? 'busy' : 'free');
        const head = document.createElement('div'); head.className = 'su-head';
        const nm = document.createElement('span'); nm.className = 'su-name'; nm.append(c.name);
        const mem = CO.member(c.name);
        if (mem.role) { const r = document.createElement('span'); r.className = 'su-role'; r.textContent = mem.role; nm.append(r); }
        if (mem.status === 'New' && c.name !== 'Unassigned') { const n = document.createElement('span'); n.className = 'tag-new'; n.textContent = 'New'; nm.append(n); }
        const load = document.createElement('span'); load.className = 'su-load'; load.append(CO.num(CO.sumQty(c.open))); const sm = document.createElement('small'); sm.textContent = 'open'; load.append(sm);
        head.append(nm, load); card.append(head);
        const stats = document.createElement('div'); stats.className = 'su-stats';
        const st = (n, lab, cls, color) => { if (!n) return; const s = document.createElement('span'); s.className = 'chip ' + cls; if (color) s.style.color = color; s.textContent = n + ' ' + lab; stats.append(s); };
        st(c.overdue.length, 'overdue', 's-bad'); st(c.today.length, 'due today', 's-warn'); st(c.open.filter((r) => r.stage === 'In progress').length, 'WIP', '', CO.stageColor('In progress'));
        st(c.open.filter((r) => r.stage === 'To be planned').length, 'TBP', 's-mute'); st(c.review.length, 'in review', '', CO.stageColor('Under review'));
        if (stats.childNodes.length) card.append(stats);
        const more = () => CO.goTasks('open', { designer: c.name === 'Unassigned' ? '__none' : c.name });
        [section('Overdue', c.overdue, 4, more), section('Due today', c.today, 4, more), section('In progress', c.wip, 4, more), section('Changes requested', c.changes, 3, more), section('Up next', c.next, 3, more)].forEach((s) => { if (s) card.append(s); });
        if (!c.open.length) { const f = document.createElement('p'); f.className = 'su-free'; f.textContent = c.review.length ? 'No open design work, ' + c.review.length + ' with reviewers. Free to take new tasks.' : 'No open design work. Free to take new tasks.'; card.append(f); }
        if (c.done.length) { const d = document.createElement('p'); d.className = 'su-done'; const nd = CO.sumQty(c.done); d.textContent = CO.num(nd) + (nd === 1 ? ' creative' : ' creatives') + ' delivered in the last 7 days (by ETA)'; card.append(d); }
        el.append(card);
      });
    });
  })();

  /* ================= All tasks ================= */
  (() => {
    let q = '', sortKey = 'eta', dir = 1, timer = null;
    document.getElementById('t-search').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { q = e.target.value.trim().toLowerCase(); dash.draw('tasks'); dash.draw('task-count'); }, 150); });
    document.querySelectorAll('#task-table th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.sort; if (sortKey === k) dir = -dir; else { sortKey = k; dir = 1; }
      document.querySelectorAll('#task-table th[data-sort]').forEach((h) => h.setAttribute('aria-sort', h.dataset.sort === sortKey ? (dir > 0 ? 'ascending' : 'descending') : 'none'));
      dash.draw('tasks');
    }));
    const filtered = () => {
      const s = dash.params().stage || 'active', ctx = CO.period();
      let rs = CO.rows().filter((r) => CO.stageMatch(r, s, ctx));
      if (q) rs = rs.filter((r) => [r.id, r.brand, r.topic, r.type, r.designers, r.owner, r.channel, r.stage].join(' ').toLowerCase().includes(q));
      const blank = dir > 0 ? '￿' : '';
      const val = (r) => sortKey === 'qty' ? String(r.qty).padStart(4, '0') : String(r[sortKey] || blank);
      return rs.sort((a, b) => val(a).localeCompare(val(b), undefined, { numeric: true }) * dir || String(a.eta || '￿').localeCompare(String(b.eta || '￿')));
    };
    document.getElementById('t-csv').addEventListener('click', () => {
      if (CO.status() !== 'ok') return;
      CO.csv('creative-tasks-' + CO.today() + '.csv', ['ID', 'Sheet', 'Brand', 'Creative', 'Type', 'Qty', 'Designer', 'Priority', 'Requested', 'Design ETA', 'Status', 'Delivery date', 'Content owner', 'Channel', 'Live status', 'Brief', 'Creative link'],
        filtered().map((r) => [r.id, r.source, r.brand, r.topic, r.type, r.qty, r.designers, r.priority, r.req, r.eta, r.stage, r.ddate, r.owner, r.channel, r.live_status, r.brief, r.link]));
    });
    dash.draw('task-count', (el) => { if (CO.notReady(el, 'text')) return; el.textContent = CO.num(filtered().length); });
    dash.draw('tasks', (tb) => {
      if (CO.notReady(tb, 'table')) return;
      tb.replaceChildren();
      const rs = filtered();
      if (!rs.length) return CO.emptyRow(tb, 14, 'No tasks match these filters.');
      const LIMIT = 600;
      rs.slice(0, LIMIT).forEach((r) => {
        const tr = tb.insertRow(); tr.dataset.uid = r.uid; tr.className = 'click';
        CO.td(tr, r.id || '—', 'co-id'); CO.td(tr, CO.srcTag(r)); CO.td(tr, r.brand, 'co-nowrap'); CO.td(tr, CO.topic(r), 'co-topic'); CO.td(tr, r.type, 'co-nowrap'); CO.td(tr, String(r.qty), 'n');
        CO.td(tr, r.designers || 'Unassigned', r.designers ? 'co-nowrap' : 'co-muted co-nowrap'); CO.td(tr, r.priority || '—', r.priority === 'P0' ? 'pri' : 'co-muted');
        CO.td(tr, CO.fmtDate(r.req), 'co-nowrap'); CO.td(tr, CO.fmtDate(r.eta), 'co-nowrap'); CO.td(tr, CO.chip(r));
        CO.td(tr, r.owner, 'co-hide-sm co-nowrap'); CO.td(tr, r.live_status, 'co-hide-sm co-nowrap'); CO.td(tr, CO.links(r));
      });
      if (rs.length > LIMIT) CO.emptyRow(tb, 14, 'Showing the first ' + LIMIT + ' of ' + CO.num(rs.length) + '. Narrow it with search or filters, or download the CSV for all of them.');
    });
  })();

  /* ================= Team ================= */
  (() => {
    const shown = (n) => (dash.params().who || 'active') === 'all' || CO.isActive(n);
    const statusCell = (name) => {
      const m = CO.member(name);
      const wrap = document.createElement('span'); wrap.className = 'co-status';
      const tag = document.createElement('span');
      tag.className = m.status === 'New' ? 'tag-new' : m.status === 'Inactive' ? 'tag-off' : 'chip s-ok';
      tag.textContent = m.status === 'New' ? 'New · not on list' : m.status;
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'co-link';
      btn.textContent = m.status === 'New' ? 'Add to team' : m.status === 'Active' ? 'Set inactive' : 'Set active';
      btn.addEventListener('click', (e) => { e.stopPropagation(); setMember(name, m.status === 'Active' ? 'Inactive' : 'Active'); });
      wrap.append(tag, btn); return wrap;
    };
    dash.draw('team', (tb) => {
      if (CO.notReady(tb, 'table')) return;
      tb.replaceChildren();
      const rs = CO.rows(), m = CO.thisMonth(), pm = CO.prevMonth(m);
      const top = CO.topTypes(rs.filter((r) => r.stage === 'Delivered'), 6), cmap = CO.typeColors(top);
      const by = new Map();
      CO.team().byKey.forEach((mm) => by.set(mm.name, []));
      rs.forEach((r) => r.list.forEach((d) => { if (!by.has(d)) by.set(d, []); by.get(d).push(r); }));
      const p = dash.params();
      const data = [...by].filter(([name]) => shown(name) && (!p.designer || p.designer === name)).map(([name, list]) => {
        const del = list.filter((r) => r.stage === 'Delivered');
        const ms = new Set(del.map((r) => r.month).filter(Boolean));
        const open = list.filter((r) => r.open);
        return {
          name, open: CO.sumQty(open), wip: open.filter((r) => r.stage === 'In progress').length, overdue: list.filter((r) => r.due === 'overdue').length,
          week: list.filter((r) => r.due === 'today' || r.due === 'week').length, review: list.filter((r) => r.stage === 'Under review').length,
          thisM: CO.sumQty(del.filter((r) => r.month === m)), lastM: CO.sumQty(del.filter((r) => r.month === pm)),
          avg: ms.size ? CO.sumQty(del) / ms.size : 0, del,
          brands: d3.rollups(list, (v) => v.length, (r) => r.brand).sort((a, b) => b[1] - a[1]).slice(0, 3).map((d) => d[0]).join(', ')
        };
      }).sort((a, b) => (CO.member(a.name).status === 'Inactive') - (CO.member(b.name).status === 'Inactive') || b.open - a.open || b.thisM - a.thisM);
      if (!data.length) return CO.emptyRow(tb, 12, 'No team members in this view.');
      const maxOpen = d3.max(data, (d) => d.open) || 1;
      data.forEach((d) => {
        const tr = tb.insertRow();
        const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'co-name'; nb.textContent = d.name; nb.addEventListener('click', () => CO.goTasks('active', { designer: d.name }));
        CO.td(tr, nb, 'co-nowrap'); CO.td(tr, statusCell(d.name), 'co-nowrap');
        const ob = document.createElement('span'); ob.className = 'co-inbar'; const bi = document.createElement('i'); bi.style.width = (d.open / maxOpen * 4) + 'rem'; ob.append(bi, String(d.open)); CO.td(tr, ob, 'n');
        CO.td(tr, String(d.wip), 'n');
        CO.td(tr, String(d.overdue), 'n' + (d.overdue ? ' bad' : ''));
        CO.td(tr, String(d.week), 'n'); CO.td(tr, String(d.review), 'n'); CO.td(tr, CO.num(d.thisM), 'n num-b'); CO.td(tr, CO.num(d.lastM), 'n'); CO.td(tr, d.avg ? d.avg.toFixed(1) : '—', 'n');
        CO.td(tr, d.brands, 'co-hide-sm co-clip').title = d.brands;
        const mix = document.createElement('span'); mix.className = 'co-mix';
        const total = CO.sumQty(d.del);
        top.forEach((t) => { const c = CO.sumQty(d.del.filter((r) => CO.typeOf(r, top) === t)); if (!c) return; const i = document.createElement('i'); i.style.width = (c / total * 100) + '%'; i.style.background = cmap.get(t); i.title = t + ': ' + c; mix.append(i); });
        CO.td(tr, mix, 'co-hide-sm');
      });
    });
    dash.draw('team-legend', (el) => {
      if (CO.notReady(el, 'list')) return;
      const top = CO.topTypes(CO.rows().filter((r) => r.stage === 'Delivered'), 6), cmap = CO.typeColors(top);
      el.replaceChildren(...top.map((t) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = cmap.get(t); s.append(i, t); return s; }));
    });
    dash.draw('heat', (table) => {
      if (CO.notReady(table, 'table')) return;
      table.replaceChildren();
      const del = CO.rows().filter((r) => r.stage === 'Delivered' && r.month);
      const ms = [...new Set(del.map((r) => r.month))].sort().filter((m) => m <= CO.thisMonth()).slice(-12);
      const cell = new Map(); del.forEach((r) => r.list.forEach((d) => { const k = d + '|' + r.month; cell.set(k, (cell.get(k) || 0) + (r.qty || 1)); }));
      const names = [...new Set(del.flatMap((r) => r.list))].filter(shown);
      const tot = (d) => ms.reduce((a, m) => a + (cell.get(d + '|' + m) || 0), 0);
      names.sort((a, b) => tot(b) - tot(a));
      if (!names.length) { CO.emptyRow(table.createTBody(), 1, 'No deliveries in this view.'); return; }
      const max = d3.max(names, (d) => d3.max(ms, (m) => cell.get(d + '|' + m) || 0)) || 1;
      const th = table.createTHead().insertRow();
      const h0 = document.createElement('th'); h0.textContent = 'Designer'; th.append(h0);
      ms.forEach((m) => { const h = document.createElement('th'); h.className = 'n'; h.textContent = CO.fmtMonth(m).replace(' 20', " '"); th.append(h); });
      const ht = document.createElement('th'); ht.className = 'n'; ht.textContent = 'Total'; th.append(ht);
      const tb = table.createTBody();
      names.forEach((d) => {
        const tr = tb.insertRow(); CO.td(tr, d, 'co-nowrap');
        ms.forEach((m) => {
          const v = cell.get(d + '|' + m) || 0; const c = CO.td(tr, v ? String(v) : '·', 'h');
          if (v) { const a = 0.1 + 0.7 * (v / max); c.style.background = `color-mix(in srgb, var(--c1) ${Math.round(a * 100)}%, transparent)`; if (a > 0.5) c.classList.add('hot'); } else c.classList.add('co-muted');
          c.addEventListener('click', () => dash.setParams({ rpreset: 'custom', rfrom: m + '-01', rto: CO.monthEnd(m), tab: 'reports', designer: d }));
        });
        CO.td(tr, CO.num(tot(d)), 'n num-b');
      });
    });
  })();

  /* ================= Reports ================= */
  (() => {
    const inRange = (rs, f, t) => rs.filter((r) => r.stage === 'Delivered' && r.ddate && r.ddate >= f && r.ddate <= t);
    const delivered = () => CO.rows().filter((r) => r.stage === 'Delivered' && r.ddate);
    const monthsIn = (f, t, rs) => f === '2000-01-01' ? Math.max(1, new Set(rs.map((r) => r.month)).size) : Math.max(1, (CO.diffDays(f, t) + 1) / 30.44);
    const stats = (f, t) => {
      const rs = inRange(CO.rows(), f, t);
      const people = new Set(rs.flatMap((r) => r.list));
      const total = CO.sumQty(rs);
      return { rs, total, tasks: rs.length, paid: CO.sumQty(rs.filter((r) => r.source === 'Paid')), mkt: CO.sumQty(rs.filter((r) => r.source === 'Marketing')),
        brands: new Set(rs.map((r) => r.brand)).size, people: people.size, per: people.size ? total / people.size / monthsIn(f, t, rs) : 0 };
    };
    dash.draw('r-period', (el) => { const pr = CO.period(); el.textContent = 'Reporting on ' + CO.label(pr.from, pr.to) + (pr.pfrom ? ', compared with ' + CO.label(pr.pfrom, pr.pto) : '') + '.'; });
    dash.draw('rkpi', (el) => {
      if (CO.notReady(el, 'text')) return;
      const pr = CO.period(), s = stats(pr.from, pr.to), k = el.dataset.kpi;
      el.textContent = k === 'per' ? (s.per ? s.per.toFixed(1) : '—') : CO.num(s[k]);
    });
    dash.draw('rkpi-sub', (el) => {
      if (CO.notReady(el, 'text')) return;
      const pr = CO.period(), s = stats(pr.from, pr.to), k = el.dataset.kpi;
      el.replaceChildren();
      if (k === 'paid' || k === 'mkt') { el.textContent = (s.total ? Math.round(s[k] / s.total * 100) : 0) + '% of the period'; return; }
      if (k === 'per') { el.textContent = s.people + (s.people === 1 ? ' person' : ' people') + ' delivered'; return; }
      if (!pr.pfrom) { el.textContent = k === 'total' ? CO.num(CO.sumQty(s.rs.filter((r) => CO.VIDEO.test(r.type)))) + ' video, reel or GIF' : ''; return; }
      el.append(CO.delta(s[k], stats(pr.pfrom, pr.pto)[k]), ' vs previous');
    });
    dash.draw('r-legend', (el) => {
      if (CO.notReady(el, 'list')) return;
      const top = CO.topTypes(delivered(), 7), cmap = CO.typeColors(top);
      el.replaceChildren(...top.map((t) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = cmap.get(t); s.append(i, t); return s; }));
    });
    dash.draw('r-chart', (el) => {
      if (CO.notReady(el, 'box')) return;
      const del = delivered().filter((r) => r.month <= CO.thisMonth());
      el.replaceChildren();
      if (!del.length) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'No deliveries in this view.'; el.append(p); return; }
      const pr = CO.period();
      const top = CO.topTypes(del, 7), cmap = CO.typeColors(top);
      const ms = [...new Set(del.map((r) => r.month))].sort().slice(-18);
      const inSel = (m) => pr.all || (m + '-01' <= pr.to && CO.monthEnd(m) >= pr.from);
      const series = ms.map((m) => { const o = { m }; top.forEach((t) => { o[t] = 0; }); del.filter((r) => r.month === m).forEach((r) => { o[CO.typeOf(r, top)] += r.qty || 1; }); o.total = top.reduce((a, t) => a + o[t], 0); return o; });
      const W = Math.max(300, el.clientWidth), H = 260, mB = 24, mT = 18;
      const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Creatives delivered by month');
      const yt = d3.scaleLinear([0, d3.max(series, (d) => d.total) || 1], [H - mB, mT]).nice();
      const ticks = yt.ticks(4);
      const meas = svg.append('text').attr('class', 'tick').text(d3.format(',')(d3.max(ticks)));
      const mL = meas.node().getComputedTextLength() + 10; meas.remove();
      const x = d3.scaleBand(ms, [mL, W - 4]).padding(0.25);
      svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'grid').attr('x1', mL).attr('x2', W - 4).attr('y1', yt).attr('y2', yt);
      svg.append('g').selectAll('text').data(ticks).join('text').attr('class', 'tick').attr('x', mL - 6).attr('y', yt).attr('dy', '0.35em').attr('text-anchor', 'end').text(d3.format(','));
      const every = Math.ceil(ms.length / Math.max(1, Math.floor((W - mL) / 52)));
      svg.append('g').selectAll('text').data(ms).join('text').attr('class', (m) => 'tick' + (inSel(m) && !pr.all ? ' on' : '')).attr('x', (m) => x(m) + x.bandwidth() / 2).attr('y', H - 6).attr('text-anchor', 'middle')
        .text((m, i) => (i % every === 0) ? CO.fmtMonth(m).replace(' 20', " '") : '');
      const stack = d3.stack().keys(top)(series);
      const bw = Math.min(34, x.bandwidth()), off = (x.bandwidth() - bw) / 2;
      svg.append('g').selectAll('g').data(stack).join('g').style('fill', (s) => cmap.get(s.key))
        .selectAll('rect').data((s) => s).join('rect').attr('x', (d) => x(d.data.m) + off).attr('width', bw)
        .attr('y', (d) => yt(d[1])).attr('height', (d) => Math.max(0, yt(d[0]) - yt(d[1]) - (d[1] > d[0] ? 1 : 0))).attr('rx', 2)
        .style('opacity', (d) => inSel(d.data.m) ? 1 : 0.45);
      svg.append('g').selectAll('text').data(series).join('text').attr('class', (d) => 'tick' + (inSel(d.m) ? ' on' : '')).attr('x', (d) => x(d.m) + x.bandwidth() / 2).attr('y', (d) => yt(d.total) - 5).attr('text-anchor', 'middle').text((d) => bw >= 20 ? d.total : '');
      const tipEl = CO.tip(el);
      svg.append('g').selectAll('rect').data(series).join('rect').attr('class', 'bar hit').attr('x', (d) => x(d.m)).attr('width', x.bandwidth()).attr('y', mT).attr('height', H - mB - mT)
        .on('click', (e, d) => dash.setParams({ rpreset: 'custom', rfrom: d.m + '-01', rto: CO.monthEnd(d.m) }))
        .on('mousemove', (e, d) => { tipEl.replaceChildren(); const k = document.createElement('div'); k.className = 'k'; k.textContent = CO.fmtMonth(d.m, true) + ' · ' + d.total + ' creatives'; tipEl.append(k); top.slice().reverse().forEach((t) => { if (!d[t]) return; const r = document.createElement('div'); const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = cmap.get(t); r.append(sw, t + ': ' + d[t]); tipEl.append(r); }); const [px] = d3.pointer(e, el); CO.placeTip(tipEl, el, px, el.clientHeight * 0.3); })
        .on('mouseleave', () => { tipEl.hidden = true; });
    });
    const crossTable = (table, keyFn, label, tag) => {
      if (CO.notReady(table, 'table')) return;
      table.replaceChildren();
      const pr = CO.period(), rs = inRange(CO.rows(), pr.from, pr.to);
      const prev = pr.pfrom ? inRange(CO.rows(), pr.pfrom, pr.pto) : null;
      const top = CO.topTypes(rs, 5);
      const groups = new Map();
      rs.forEach((r) => keyFn(r).forEach((k) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }));
      const hr = table.createTHead().insertRow();
      [label].concat(top, ['Total'], prev ? ['vs previous'] : []).forEach((h, i) => { const th = document.createElement('th'); th.textContent = h; if (i) th.className = 'n'; hr.append(th); });
      const tb = table.createTBody();
      if (!groups.size) return CO.emptyRow(tb, top.length + 2 + (prev ? 1 : 0), 'Nothing delivered in this period for this view.');
      const data = [...groups].map(([k, list]) => [k, list, CO.sumQty(list)]).sort((a, b) => b[2] - a[2]);
      const max = data[0][2];
      data.forEach(([k, list, n]) => {
        const tr = tb.insertRow(); const c0 = CO.td(tr, k, 'co-nowrap'); if (tag) { const t = tag(k); if (t) c0.append(' ', t); }
        top.forEach((t) => { const v = CO.sumQty(list.filter((r) => CO.typeOf(r, top) === t)); CO.td(tr, v ? CO.num(v) : '·', v ? 'n' : 'n co-muted'); });
        const b = document.createElement('span'); b.className = 'co-inbar'; const i = document.createElement('i'); i.style.width = (n / max * 3.5) + 'rem'; b.append(i, CO.num(n)); CO.td(tr, b, 'n num-b');
        if (prev) { const d = n - CO.sumQty(prev.filter((r) => keyFn(r).includes(k))); CO.td(tr, CO.sign(d), 'n ' + (d > 0 ? 'co-up' : d < 0 ? 'co-down' : 'co-muted')); }
      });
      const tr = tb.insertRow(); tr.className = 'total'; CO.td(tr, 'All');
      top.forEach((t) => CO.td(tr, CO.num(CO.sumQty(rs.filter((r) => CO.typeOf(r, top) === t))), 'n'));
      CO.td(tr, CO.num(CO.sumQty(rs)), 'n');
      if (prev) { const d = CO.sumQty(rs) - CO.sumQty(prev); CO.td(tr, CO.sign(d), 'n ' + (d > 0 ? 'co-up' : d < 0 ? 'co-down' : 'co-muted')); }
    };
    dash.draw('r-brand', (t) => crossTable(t, (r) => [r.brand], 'Brand'));
    dash.draw('r-designer', (t) => crossTable(t, (r) => r.list.length ? r.list : ['Unassigned'], 'Designer', (k) => { const m = CO.member(k); if (k === 'Unassigned' || m.status === 'Active') return null; const s = document.createElement('span'); s.className = m.status === 'New' ? 'tag-new' : 'tag-off'; s.textContent = m.status; return s; }));
    dash.draw('r-type', (table) => {
      if (CO.notReady(table, 'table')) return;
      table.replaceChildren();
      const pr = CO.period(), cur = inRange(CO.rows(), pr.from, pr.to), prev = pr.pfrom ? inRange(CO.rows(), pr.pfrom, pr.pto) : [];
      const hr = table.createTHead().insertRow();
      ['Creative type', 'This period', 'Share', 'Previous period', 'Change', 'Paid', 'Marketing', 'Brands', 'Designers'].forEach((h, i) => { const th = document.createElement('th'); th.textContent = h; if (i) th.className = 'n'; hr.append(th); });
      const tb = table.createTBody();
      const types = [...new Set(cur.concat(prev).map((r) => r.type))];
      if (!types.length) return CO.emptyRow(tb, 9, 'Nothing delivered in this period or the one before.');
      const curTotal = CO.sumQty(cur);
      types.map((t) => { const c = cur.filter((r) => r.type === t); return { t, c, n: CO.sumQty(c), p: CO.sumQty(prev.filter((r) => r.type === t)) }; }).sort((a, b) => b.n - a.n || b.p - a.p).forEach((d) => {
        const tr = tb.insertRow(); CO.td(tr, d.t, 'co-nowrap');
        CO.td(tr, CO.num(d.n), 'n num-b'); CO.td(tr, curTotal ? Math.round(d.n / curTotal * 100) + '%' : '—', 'n'); CO.td(tr, pr.pfrom ? CO.num(d.p) : '—', 'n');
        const diff = d.n - d.p; CO.td(tr, pr.pfrom ? CO.sign(diff) : '—', 'n ' + (!pr.pfrom ? '' : diff > 0 ? 'co-up' : diff < 0 ? 'co-down' : 'co-muted'));
        CO.td(tr, CO.num(CO.sumQty(d.c.filter((r) => r.source === 'Paid'))), 'n'); CO.td(tr, CO.num(CO.sumQty(d.c.filter((r) => r.source === 'Marketing'))), 'n');
        CO.td(tr, String(new Set(d.c.map((r) => r.brand)).size), 'n'); CO.td(tr, String(new Set(d.c.flatMap((r) => r.list)).size), 'n');
      });
    });
    document.getElementById('r-csv').addEventListener('click', () => {
      if (CO.status() !== 'ok') return;
      const pr = CO.period(), rs = inRange(CO.rows(), pr.from, pr.to), out = [];
      const add = (dim, keyFn) => { const m = new Map(); rs.forEach((r) => keyFn(r).forEach((k) => { const key = k + '\u0000' + r.type; m.set(key, (m.get(key) || 0) + (r.qty || 1)); })); [...m].sort().forEach(([key, n]) => { const [k, t] = key.split('\u0000'); out.push([CO.label(pr.from, pr.to), dim, k, t, n]); }); };
      add('Brand', (r) => [r.brand]); add('Designer', (r) => r.list.length ? r.list : ['Unassigned']); add('Sheet', (r) => [r.source]);
      CO.csv('creative-report-' + (pr.all ? 'all-time' : pr.from + '-to-' + pr.to) + '.csv', ['Period', 'Breakdown', 'Name', 'Creative type', 'Creatives delivered'], out);
    });
  })();

  /* ================= Sheet health ================= */
  (() => {
    let pick = '';
    const ORDER = ['Open, no ETA', 'No designer assigned', 'Unrecognised status', 'Delivered, no designer', 'Delivered, no creative link', 'ETA before request date', 'Request date year looks mistyped', 'ETA year looks mistyped', 'Request date unreadable', 'ETA unreadable', 'No brand'];
    const flagged = () => CO.rows().filter((r) => r.flags);
    dash.draw('health-sum', (el) => {
      if (CO.notReady(el, 'box')) return;
      const rs = flagged();
      el.replaceChildren(...ORDER.map((f) => {
        const n = rs.filter((r) => r.flags.split('; ').includes(f)).length;
        const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(pick === f));
        const s = document.createElement('span'); s.textContent = f; const v = document.createElement('b'); v.textContent = CO.num(n); if (n) v.className = /Open|No designer|Unrecognised/.test(f) ? 'bad' : 'warn';
        b.append(s, v); b.addEventListener('click', () => { pick = pick === f ? '' : f; dash.draw('health-sum'); dash.draw('health'); });
        return b;
      }));
    });
    dash.draw('health', (tb) => {
      if (CO.notReady(tb, 'table')) return;
      tb.replaceChildren();
      const rs = flagged().filter((r) => !pick || r.flags.split('; ').includes(pick)).sort((a, b) => (b.open - a.open) || String(b.req || '').localeCompare(String(a.req || '')));
      if (!rs.length) return CO.emptyRow(tb, 9, 'No issues found in this view.');
      rs.slice(0, 400).forEach((r) => {
        const tr = tb.insertRow(); tr.dataset.uid = r.uid; tr.className = 'click';
        CO.td(tr, r.id || '—', 'co-id'); CO.td(tr, CO.srcTag(r)); CO.td(tr, r.brand, 'co-nowrap'); CO.td(tr, CO.topic(r), 'co-topic');
        CO.td(tr, r.designers || 'Unassigned', r.designers ? 'co-nowrap' : 'co-muted co-nowrap'); CO.td(tr, CO.chip(r));
        CO.td(tr, CO.fmtDate(r.req), 'co-nowrap'); CO.td(tr, CO.fmtDate(r.eta), 'co-nowrap'); CO.td(tr, r.flags);
      });
      if (rs.length > 400) CO.emptyRow(tb, 9, 'Showing 400 of ' + CO.num(rs.length) + '. Pick a check above to narrow the list.');
    });
  })();

  /* ================= Edit a task (writes back to the sheet) ================= */
  (() => {
    const dlgE = document.getElementById('editor');
    const $ = (id) => document.getElementById(id);
    const SHEET = new Proxy({}, { get: (_, k) => { const s = S.sources && S.sources[k]; return s && s.file ? s.file + ' / ' + s.tab : null; } });
    let current = null, before = null;
    function openEditor(uid) {
      if (S.status !== 'ok' || !S.tasks) return;
      const r = S.tasks.find((t) => t.uid === uid); if (!r) return;
      current = r;
      const list = r.designers ? [...new Set(r.designers.split(' + ').map(CO.canon))] : [];
      before = { status: r.stage, eta: r.eta || '', designer: list.join(', '), priority: r.priority || '', qty: String(r.qty || 1) };
      $('ed-where').textContent = (SHEET[r.src] || r.source) + (r.row ? ' · row ' + r.row : '') + (r.id ? ' · ' + r.id : '');
      $('ed-title').textContent = r.brand + ' · ' + r.type;
      $('ed-topic').textContent = CO.topicText(r);
      const st = $('ed-status');
      [...st.querySelectorAll('option[data-extra]')].forEach((o) => o.remove());
      if (![...st.options].some((o) => o.value === r.stage)) { const o = new Option(r.stage + ' (as in the sheet)', r.stage); o.dataset.extra = '1'; o.disabled = true; st.append(o); }
      st.value = r.stage;
      $('ed-eta').value = r.eta || '';
      $('ed-designer').value = before.designer;
      const names = new Set(); (S.team || []).forEach((m) => { if (m.status !== 'Inactive') names.add(m.name); }); S.tasks.forEach((t) => t.designers && t.designers.split(' + ').forEach((d) => names.add(CO.canon(d))));
      $('ed-people').replaceChildren(...[...names].sort().map((n) => new Option(n)));
      $('ed-priority').value = /^P[0-3]$/.test(r.priority) ? r.priority : '';
      const cols = (S.cols && S.cols[r.src]) || {};
      $('ed-qty-wrap').hidden = !cols.qty; $('ed-qty').value = before.qty;
      $('ed-priority').disabled = cols.priority === false;
      $('ed-info').textContent = r.stage === 'Awaiting brief' ? 'Waiting on the brief: design has not started because the content status is not done yet.' : (r.stage === 'Delivered' && !cols.delivered ? '' : '');
      const links = CO.links(r); $('ed-links').replaceChildren(links);
      $('ed-msg').textContent = r.id ? '' : 'This row has no ID in the sheet, so it can only be edited there.';
      $('ed-save').disabled = !r.id; $('ed-save').textContent = 'Save to sheet';
      if (dlgE.showModal) dlgE.showModal(); else dlgE.setAttribute('open', '');
    }
    const openFrom = (e) => {
      if (e.target.closest('a, button, input, select')) return;
      const el = e.target.closest('[data-uid]'); if (el) openEditor(el.dataset.uid);
    };
    document.querySelector('.co').addEventListener('click', openFrom);
    document.querySelector('.co').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.su-item[data-uid]')) openEditor(e.target.dataset.uid); });
    $('ed-cancel').addEventListener('click', () => dlgE.close());
    $('editor-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = current; if (!r) return;
      const now = { status: $('ed-status').value, eta: $('ed-eta').value, designer: $('ed-designer').value.replace(/\s*\+\s*/g, ', ').replace(/\s+/g, ' ').trim(), priority: $('ed-priority').value, qty: $('ed-qty').value };
      if ($('ed-eta').value && !$('ed-eta').validity.valid) { $('ed-msg').textContent = 'Pick a complete date.'; return; }
      const fields = {};
      if (now.status !== before.status) fields.status = now.status;
      if (now.eta !== before.eta) fields.eta = now.eta;
      if (now.designer !== before.designer) fields.designer = now.designer;
      if (now.priority !== before.priority && !$('ed-priority').disabled) fields.priority = now.priority;
      if (!$('ed-qty-wrap').hidden && now.qty !== before.qty) fields.qty = now.qty;
      if (!Object.keys(fields).length) { dlgE.close(); return; }
      $('ed-save').disabled = true; $('ed-save').textContent = 'Saving…'; $('ed-msg').textContent = '';
      try {
        const res = await post({ action: 'updateTask', source: r.src, id: r.id, row: r.row, fields });
        // Show the change at once; the reload that follows confirms it from the sheet.
        const t = Object.assign({}, r);
        if (fields.status) { t.stage = fields.status; t.open = CODATA.OPEN_STAGES.includes(fields.status); }
        if ('eta' in fields) t.eta = fields.eta || null;
        if ('designer' in fields) t.designers = fields.designer ? fields.designer.split(/\s*,\s*/).join(' + ') : '';
        if ('priority' in fields) t.priority = fields.priority;
        if (fields.qty) t.qty = Number(fields.qty);
        if (t.stage === 'Delivered') { t.ddate = res.written && res.written.deliveredOn ? CO.today() : (t.eta || t.req); t.month = t.ddate ? t.ddate.slice(0, 7) : ''; } else { t.ddate = null; t.month = ''; }
        if (res.row) t.row = res.row;
        S.tasks = S.tasks.map((x) => (x.uid === r.uid ? t : x));
        dlgE.close(); renderAll();
        toast('Saved to the ' + (SHEET[r.src] || 'sheet') + ', row ' + (res.row || r.row) + (res.written && res.written.status ? ' (status "' + res.written.status + '")' : ''));
        setTimeout(() => load(true), 1500);
      } catch (err) {
        $('ed-msg').textContent = 'Not saved: ' + err.message;
        $('ed-save').disabled = false; $('ed-save').textContent = 'Save to sheet';
      }
    });
  })();

  /* ================= Start ================= */
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== P.tab) dash.setParams({ tab: h }); });
  renderAll();
  load(false);
})();
