/* Creative Ops Tracker: views, filters and the connection to the Apps Script data API. */
(function () {
  'use strict';

  /* ================= Store, settings and rendering ================= */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  const DEFAULTS = { tab: 'today', src: '', designer: '', brand: '', type: '', stage: 'active', susort: 'urgent', who: 'active', rpreset: 'this-month', rfrom: '', rto: '', rchart: 'total' };
  const P = Object.assign({}, DEFAULTS);
  try { Object.assign(P, JSON.parse(LS.get('co.view', '{}'))); } catch (e) { /* ignore */ }
  const TABS = ['today', 'standup', 'tasks', 'team', 'reports', 'health', 'access'];
  /* Access. 'auth': people sign in with Google and have a role. 'key': the older shared key (before sign-in is set up). */
  const CFG = window.CO_CONFIG || {};
  const RANK = { Viewer: 1, Editor: 2, Admin: 3 };
  const ROLE_LABEL = { Viewer: 'View only', Editor: 'Can edit', Admin: 'Admin' };
  const A = { mode: null, url: '', clientId: '', domains: [], session: LS.get('co.session', ''), user: null };
  const can = (need) => A.mode === 'key' || !!(A.user && RANK[A.user.role] >= RANK[need]);
  if (TABS.includes(location.hash.slice(1))) P.tab = location.hash.slice(1);

  const S = { status: 'idle', error: '', tasks: null, team: null, teamRaw: [], sources: {}, generatedAt: null, loadedAt: null };
  // Chart categories in a fixed, validated order (never cycled past the last slot: the tail folds into "Other").
  const colors = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
  const draws = new Map();
  const dash = {
    colors,
    params: () => P,
    setParams(o) {
      Object.assign(P, o);
      LS.set('co.view', JSON.stringify({ src: P.src, designer: P.designer, brand: P.brand, type: P.type, stage: P.stage, susort: P.susort, who: P.who, rpreset: P.rpreset, rfrom: P.rfrom, rto: P.rto, rchart: P.rchart }));
      if (o.tab) { try { history.replaceState(null, '', '#' + o.tab); } catch (e) { /* ignore */ } }
      if (o.tab === 'access') axRefresh(true);
      if (o.tab) { closeNav(); window.scrollTo({ top: 0 }); }
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
  const conn = () => ({ url: LS.get('co.api', '') || CFG.webApp || '', key: LS.get('co.key', '') });
  class AuthLost extends Error {}
  const parse = (text) => {
    try { return JSON.parse(text); } catch (e) { throw new Error(/<html/i.test(text) ? 'The web app answered with a web page instead of data. Check that it is deployed with access set to "Anyone".' : 'The web app returned something that is not data.'); }
  };
  /* Signed-in requests: everything goes by POST with the session, never in the URL. */
  async function callApi(payload) {
    const res = await fetch(A.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ session: A.session }, payload)) });
    const body = parse(await res.text());
    if (!body.ok && ['signin_required', 'session_expired', 'no_access'].includes(body.error)) { lostAccess(body); throw new AuthLost(body.error); }
    return body;
  }
  async function keyGet(params) {
    const { url, key } = conn();
    const u = new URL(url); u.searchParams.set('key', key);
    Object.keys(params).forEach((k) => u.searchParams.set(k, params[k]));
    return parse(await (await fetch(u.toString(), { redirect: 'follow' })).text());
  }
  const probeVer = () => (A.mode === 'auth' ? callApi({ action: 'ver' }) : keyGet({ mode: 'ver' }));
  const errText = (e) => (e === 'bad_key' ? 'The key was not accepted. Copy it again from the Apps Script execution log after running setup.' : e === 'forbidden' ? 'Your role does not allow this. Ask the admin for more access.' : 'The web app reported: ' + e);

  async function load(fresh) {
    if (A.mode === 'auth' && !A.user) return;
    if (A.mode !== 'auth') { const { url, key } = conn(); if (!url || !key) { S.status = 'unconfigured'; renderAll(); return; } }
    if (S.status !== 'ok') S.status = 'loading';
    S.refreshing = true; renderAll();
    try {
      const body = A.mode === 'auth' ? await callApi({ action: 'data', fresh: !!fresh }) : await keyGet(fresh ? { fresh: '1' } : {});
      if (!body.ok) throw new Error(errText(body.error));
      const src = body.sources || {};
      const taskKeys = Object.keys(src).filter((k) => CODATA.kindOf(k, src[k].kind) !== 'team' && !src[k].optional);
      if (taskKeys.length && taskKeys.every((k) => src[k].error)) throw new Error('None of the task sheets could be opened by the web app: ' + src[taskKeys[0]].error);
      S.sources = src;
      // Every task tab the web app reports, in its order (newest tab of each kind first).
      const keys = Object.keys(src).filter((k) => !src[k].error && CODATA.kindOf(k, src[k].kind) !== 'team');
      S.tasks = CODATA.buildTasks(keys.map((k) => ({ kind: CODATA.kindOf(k, src[k].kind), rows: CODATA.parseSource(CODATA.kindOf(k, src[k].kind), src[k], k) })));
      S.ignored = S.tasks.ignored || [];
      const teamKey = Object.keys(src).find((k) => CODATA.kindOf(k, src[k].kind) === 'team');
      S.teamRaw = CODATA.parseTeam(teamKey ? src[teamKey] : null);
      S.team = S.teamRaw;
      S.cols = {}; Object.keys(src).forEach((k) => { S.cols[k] = CODATA.columnsOf(src[k]); });
      S.ver = body.ver || null;
      S.generatedAt = body.generatedAt; S.loadedAt = new Date();
      S.status = 'ok'; S.error = ''; S.staleError = '';
      loadHealth();
      if (P.tab === 'access') axRefresh(true);
      LS.set('co.cacheAt', S.generatedAt);
    } catch (err) {
      if (err instanceof AuthLost) { S.refreshing = false; return; }
      S.error = err && err.message ? err.message : String(err);
      if (err instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(S.error)) {
        // Google's own error pages carry no cross-site header, so a script error looks like a network failure.
        // The version check touches no sheets: if it answers, the web app is reachable and the sheets are the problem.
        let reachable = false;
        try { reachable = !!(await probeVer()).ok; } catch (e2) { /* unreachable */ }
        S.error = reachable
          ? 'The web app is connected but could not open the sheets. In Apps Script, signed in as the account the web app runs as (Deploy → Manage deployments shows it), run setup once and approve the permissions, then click Refresh.'
          : 'This browser could not reach the web app. Check your connection, turn off ad or privacy blockers for this page (or try a private window) and click Refresh.';
      }
      if (S.status !== 'ok') S.status = 'error';
      else S.staleError = S.error;
    }
    S.refreshing = false;
    renderAll();
  }
  /* Integration health from the web app (account, change detection, edit access). Admins only. Best effort. */
  async function loadHealth() {
    if (!can('Admin')) { S.health = null; return; }
    try {
      const body = A.mode === 'auth' ? await callApi({ action: 'health' }) : await keyGet({ mode: 'health' });
      S.health = body.ok ? body : null;
    } catch (e) { S.health = null; }
    dash.draw('integration');
  }
  async function post(payload) {
    let body;
    if (A.mode === 'auth') body = await callApi(payload);
    else {
      const { url, key } = conn();
      const res = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key }, payload)) });
      body = parse(await res.text());
    }
    if (!body.ok) throw new Error(body.error === 'forbidden' ? 'your role (' + (A.user ? A.user.role : '?') + ') cannot do this' : body.error || 'save failed');
    return body;
  }
  /* Live sync: every 30 s ask the web app whether a sheet changed (a tiny request), and reload only then.
     A full reload also runs every 10 minutes as a safety net, and on return to the tab. */
  let checking = false;
  async function checkForChanges() {
    if (checking || S.refreshing || S.status !== 'ok' || document.visibilityState !== 'visible') return;
    checking = true;
    try {
      const body = await probeVer();
      S.checkedAt = new Date();
      if (A.mode === 'auth' && body.ok && body.role && A.user && body.role !== A.user.role) {
        A.user.role = body.role; toast('Your access is now: ' + ROLE_LABEL[body.role] + '.'); renderAll(); loadHealth();
      }
      if (A.mode === 'auth' && body.ok && typeof body.pending === 'number' && body.pending !== AX.pending) { AX.pending = body.pending; syncControls(); }
      if (P.tab === 'access') axRefresh(false);
      if (body.ok && body.ver && S.ver && body.ver !== S.ver) await load(false);
      dash.draw('sync-text');
    } catch (e) { /* a missed check is retried on the next tick */ }
    checking = false;
  }
  setInterval(checkForChanges, 30 * 1000);
  setInterval(() => { if (document.visibilityState === 'visible' && S.status === 'ok') load(false); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.loadedAt) { if (Date.now() - S.loadedAt > 5 * 60 * 1000) load(false); else checkForChanges(); } });
  // Keep the 'checked … ago' line current, and redraw everything when the date changes (overdue and due-today move at midnight).
  let shownDay = new Date().toDateString();
  setInterval(() => { const d = new Date().toDateString(); if (d !== shownDay) { shownDay = d; renderAll(); } else dash.draw('sync-text'); }, 15 * 1000);

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
    const stageColor = (s) => ({ 'In progress': 'var(--st-wip)', 'Under review': 'var(--st-review)', 'To be planned': 'var(--st-plan)', 'Awaiting brief': 'var(--st-await)', 'On hold': 'var(--st-hold)', 'Changes requested': 'var(--warn)', 'Delivered': 'var(--ok)' })[s];
    // plain: the row already shows how late it is (a "when" badge), so the chip shows only the status.
    const chip = (r, plain) => {
      const el = document.createElement('span');
      let cls = 's-mute', txt = r.stage;
      if (r.due === 'overdue') { cls = 's-bad'; if (!plain) txt = r.stage + ' · late'; }
      else if (r.due === 'today') { cls = 's-warn'; if (!plain) txt = r.stage + ' · today'; }
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
    const typeColors = (types) => { const m = new Map(); types.forEach((t, i) => m.set(t, t === 'Other' || i >= colors.length ? 'var(--chart-muted)' : colors[i])); return m; };
    /* People: initials avatar + name. Several designers show stacked avatars. */
    const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const av = (n, cls) => { const a = document.createElement('span'); a.className = 'av' + (cls ? ' ' + cls : ''); a.textContent = initials(n); a.setAttribute('aria-hidden', 'true'); return a; };
    const who = (r) => {
      const w = document.createElement('span'); w.className = 'who' + (r.list.length ? '' : ' none');
      if (!r.list.length) { w.append(av('?', 'none'), 'Unassigned'); return w; }
      r.list.slice(0, 2).forEach((n) => w.append(av(n)));
      const t = document.createElement('span'); t.textContent = r.list.length > 2 ? r.list[0] + ' +' + (r.list.length - 1) : r.list.join(' + '); w.append(t);
      return w;
    };
    /* Task: brand · creative, with ID, type, quantity, sheet and priority underneath. */
    const task = (r) => {
      const d = document.createElement('div'); d.className = 'tk';
      const t = document.createElement('span'); t.className = 'tk-t'; const b = document.createElement('b'); b.textContent = r.brand; t.append(b, ' · ' + topicText(r)); t.title = r.brand + ' · ' + topicText(r);
      const m = document.createElement('span'); m.className = 'tk-m';
      const id = document.createElement('span'); id.className = 'co-id'; id.textContent = r.id || 'no ID';
      m.append(id, '·', r.type + (r.qty > 1 ? ' ×' + r.qty : ''), srcTag(r));
      if (/^P[01]$/.test(r.priority || '')) { const p = document.createElement('span'); p.className = 'pri'; p.textContent = r.priority; m.append(p); }
      d.append(t, m); return d;
    };
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
      const q = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const text = [header.map(q).join(',')].concat(rows.map((r) => r.map(q).join(','))).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
      a.download = filename; document.body.append(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    return { today, addDays, diffDays, fmtDate, fmtMonth, thisMonth, prevMonth, monthEnd, addMonths, num, sumQty, CLOSED, VIDEO, team, member, isActive, canon, all, rows, status, stageMatch, stageColor, chip, td, links, topic, topicText, srcTag, emptyRow, notReady, goTasks, typeColors, topTypes, typeOf, tip, placeTip, sign, delta, period, label, csv, av, who, task, initials };
  })();

  /* ================= Controls ================= */
  function syncControls() {
    const p = dash.params();
    const admin = A.mode === 'auth' && can('Admin');
    const axTab = document.querySelector('.co-tab[data-tab="access"]');
    axTab.hidden = !admin;
    const badge = axTab.querySelector('.nav-badge'); badge.hidden = !AX.pending; badge.textContent = AX.pending ? AX.pending + ' waiting' : '';
    document.querySelector('.bt-dot').hidden = !(admin && AX.pending);
    const bell = document.getElementById('btn-bell'); bell.hidden = !admin; bell.querySelector('.bell-dot').hidden = !AX.pending;
    bell.title = AX.pending ? AX.pending + (AX.pending === 1 ? ' access request waiting' : ' access requests waiting') : 'Access and activity'; bell.setAttribute('aria-label', bell.title);
    document.getElementById('add-member').hidden = !can('Admin');
    const tab = TABS.includes(p.tab) && (p.tab !== 'access' || admin) ? p.tab : 'today';
    document.querySelectorAll('[data-panel]').forEach((s) => { s.hidden = s.dataset.panel !== tab; });
    document.querySelectorAll('.co-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.bt[data-tab]').forEach((b) => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    document.getElementById('bt-more').toggleAttribute('aria-current', !['today', 'standup', 'tasks', 'reports'].includes(tab));
    document.getElementById('filter-bar').hidden = tab === 'access';
    ['src', 'designer', 'brand', 'type'].forEach((k) => { const el = document.querySelector('.co-f[data-param="' + k + '"]'); if (el) el.classList.toggle('is-set', !!p[k]); });
    document.getElementById('f-reset').hidden = !(p.src || p.designer || p.brand || p.type);
    document.querySelectorAll('[data-rchart]').forEach((b) => b.setAttribute('aria-pressed', String((p.rchart || 'total') === b.dataset.rchart)));
    const meta = PAGES[tab]; document.title = meta[0] + ' · Creative Ops Tracker';
    const val = (sel, v) => { const el = document.querySelector(sel); if (el && el !== document.activeElement) el.value = v; };
    val('#f-src', p.src || ''); val('#t-stage', p.stage || 'active'); val('#su-sort', p.susort || 'urgent'); val('#team-who', p.who || 'active'); val('#r-preset', p.rpreset || 'this-month');
    const pr = CO.period();
    val('#r-from', pr.all ? '' : pr.from); val('#r-to', pr.all ? '' : pr.to);
    const banner = document.getElementById('banner');
    banner.hidden = !(S.status === 'unconfigured' || S.status === 'error');
    document.getElementById('btn-connect').hidden = A.mode === 'auth';
  }
  document.querySelectorAll('.co-tab, .bt[data-tab]').forEach((b) => b.addEventListener('click', () => dash.setParams({ tab: b.dataset.tab })));
  /* Navigation drawer (phones and narrow windows) */
  function closeNav() { document.body.classList.remove('nav-open'); document.getElementById('scrim').hidden = true; document.getElementById('btn-menu').setAttribute('aria-expanded', 'false'); }
  function openNav() { document.body.classList.add('nav-open'); document.getElementById('scrim').hidden = false; document.getElementById('btn-menu').setAttribute('aria-expanded', 'true'); }
  document.getElementById('btn-menu').addEventListener('click', openNav);
  document.getElementById('btn-bell').addEventListener('click', () => dash.setParams({ tab: 'access' }));
  document.getElementById('bt-more').addEventListener('click', openNav);
  document.getElementById('scrim').addEventListener('click', closeNav);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('nav-open')) closeNav(); });
  document.getElementById('btn-filters').addEventListener('click', (e) => { const bar = document.getElementById('filter-bar'); bar.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(bar.classList.contains('open'))); });
  document.querySelectorAll('[data-go-tasks]').forEach((b) => b.addEventListener('click', () => CO.goTasks(b.dataset.goTasks)));
  document.querySelectorAll('[data-rchart]').forEach((b) => b.addEventListener('click', () => dash.setParams({ rchart: b.dataset.rchart })));
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
  const themeLabel = () => { const root = document.documentElement; const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; const b = document.getElementById('btn-theme'); b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme'); b.title = b.getAttribute('aria-label'); };
  themeLabel();
  document.getElementById('btn-refresh').addEventListener('click', () => (A.mode ? load(true) : start()));
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
  const PAGES = {
    today: ['Overview', () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · what needs attention today'],
    standup: ['Daily stand-up', 'One card per active designer: what is late, due today, in progress and up next.'],
    tasks: ['Tasks', 'Every task from both sheets. Click a row to open or edit it.'],
    team: ['Team', 'Workload, output and who is on the team.'],
    reports: ['Delivery reports', 'Creatives delivered by month, brand, designer and creative type.'],
    health: ['Data health', 'Rows that make tracking less reliable, and the connection to the sheets.'],
    access: ['Access & activity', 'Who can use the dashboard, and every change they made.']
  };
  const curTab = () => { const t = dash.params().tab; return PAGES[t] && (t !== 'access' || (A.mode === 'auth' && can('Admin'))) ? t : 'today'; };
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  const firstName = () => (A.user && A.user.name ? A.user.name.split(' ')[0] : '');
  dash.draw('page-title', (el) => { const t = curTab(); el.textContent = t === 'today' && firstName() ? greeting() + ', ' + firstName() : PAGES[t][0]; });
  dash.draw('page-eyebrow', (el) => { const t = curTab(); el.textContent = t === 'today' && firstName() ? 'Overview' : ''; });
  dash.draw('top-av', (el) => { el.replaceChildren(); if (A.user) { const a = CO.av(A.user.name || A.user.email); a.title = (A.user.name || A.user.email) + ' · ' + (ROLE_LABEL[A.user.role] || A.user.role); el.append(a); } });
  dash.draw('page-sub', (el) => { const s = PAGES[curTab()][1]; el.textContent = typeof s === 'function' ? s() : s; });
  dash.draw('filter-count', (el) => { const p = dash.params(); const n = ['src', 'designer', 'brand', 'type'].filter((k) => p[k]).length; el.textContent = n ? String(n) : ''; });
  dash.draw('me-card', (el) => {
    el.replaceChildren(); if (!A.user) return;
    const w = document.createElement('span'); w.className = 'su-who';
    const b = document.createElement('b'); b.textContent = A.user.name || A.user.email;
    const sm = document.createElement('small'); sm.textContent = (ROLE_LABEL[A.user.role] || A.user.role) + ' · ' + A.user.email;
    w.append(b, sm); el.append(CO.av(A.user.name || A.user.email, 'lg'), w); el.title = A.user.email;
  });
  dash.draw('today-date', (el) => { el.textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); });
  dash.draw('sync-dot', (el) => { el.className = 'co-sync-dot ' + (S.status === 'ok' ? (S.staleError ? 'warn' : 'ok') : S.status === 'error' ? 'bad' : S.status === 'loading' ? 'busy' : ''); });
  dash.draw('sync-text', (el) => {
    if (S.status === 'ok') {
      const at = new Date(S.generatedAt || S.loadedAt);
      const live = S.ver && S.ver !== '0';
      const ago = S.checkedAt || S.loadedAt ? Math.max(0, Math.round((Date.now() - (S.checkedAt > S.loadedAt ? S.checkedAt : S.loadedAt)) / 1000)) : null;
      el.textContent = (S.refreshing ? 'Syncing… ' : live ? 'Live · ' : '') + 'data from ' + at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + (ago != null && !S.refreshing ? ' · checked ' + (ago < 5 ? 'just now' : ago + 's ago') : '') + (S.staleError ? ' · last refresh failed' : '');
      el.title = live ? 'Checks the sheets for changes every 30 seconds' : 'Run setup() in Apps Script to turn on instant change detection';
    } else el.textContent = S.status === 'loading' ? 'Loading sheets…' : S.status === 'error' ? 'Could not load' : 'Not connected';
  });
  dash.draw('me', (el) => { el.textContent = A.user ? (A.user.name || A.user.email) + ' · ' + (ROLE_LABEL[A.user.role] || A.user.role) : ''; el.title = A.user ? A.user.email : ''; });
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
    row('Edits by scripts and integrations', h.driveCheck ? 'Detected within 30 seconds' : 'Not detected until the 5-minute refresh: add the Drive permission (README, Live sync)', h.driveCheck ? 'good' : 'warn');
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
  const whenChip = (r) => { const s = document.createElement('span'); const d = r.eta ? CO.diffDays(CO.today(), r.eta) : null; s.className = 'when' + (d == null ? '' : d < 0 ? ' bad' : d <= 1 ? ' warn' : ''); s.textContent = d == null ? 'No ETA' : d < 0 ? (-d) + 'd late' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : CO.fmtDate(r.eta); s.title = r.eta ? 'Design ETA ' + CO.fmtDate(r.eta, true) : 'No Design ETA'; return s; };
  const cells = (tr, r, cols) => {
    tr.dataset.uid = r.uid; tr.classList.add('click');
    for (const c of cols) {
      if (c === 'when') CO.td(tr, whenChip(r), 'co-nowrap');
      else if (c === 'task') CO.td(tr, CO.task(r));
      else if (c === 'who') CO.td(tr, CO.who(r));
      else if (c === 'id') CO.td(tr, r.id || '—', 'co-id');
      else if (c === 'topic') CO.td(tr, CO.topic(r), 'co-topic');
      else if (c === 'stage') CO.td(tr, CO.chip(r, true));
      else if (c === 'eta') CO.td(tr, CO.fmtDate(r.eta), 'co-nowrap');
      else if (c === 'qty') CO.td(tr, String(r.qty), 'n');
      else if (c === 'designers') CO.td(tr, r.designers || 'Unassigned', r.designers ? 'co-nowrap' : 'co-muted co-nowrap');
      else if (c === 'links') CO.td(tr, CO.links(r), 'co-hide-lg');
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
    if (!list.length) return CO.emptyRow(tb, 5, 'Nothing overdue or due today. The team is on schedule.');
    list.forEach((r) => cells(tb.insertRow(), r, ['when', 'task', 'who', 'stage', 'links']));
  });
  dash.draw('upcoming', (tb) => {
    if (CO.notReady(tb, 'table')) return;
    tb.replaceChildren();
    const t = CO.today(), lim = CO.addDays(t, 14);
    // Dated work only: open tasks with no ETA are one click away (link in the card header), not 40 rows of noise.
    const list = CO.rows().filter((r) => r.open && r.eta && r.eta > t && r.eta <= lim).sort((a, b) => a.eta.localeCompare(b.eta) || (a.priority || 'P9').localeCompare(b.priority || 'P9'));
    if (!list.length) return CO.emptyRow(tb, 4, 'No open work due in the next two weeks.');
    list.forEach((r) => cells(tb.insertRow(), r, ['when', 'task', 'who', 'stage']));
  });
  dash.draw('upcoming-noeta', (el) => {
    if (CO.status() !== 'ok') { el.textContent = ''; return; }
    const n = CO.rows().filter((r) => r.due === 'noeta').length;
    el.textContent = n ? n + ' open with no ETA →' : '';
  });
  /* Overview: work nobody has picked up yet. */
  dash.draw('unassigned', (el) => {
    if (CO.notReady(el, 'box')) return;
    el.replaceChildren();
    const open = CO.rows().filter((r) => r.open && !r.list.length);
    el.classList.toggle('accent-bad', open.length > 0); el.classList.toggle('accent-ok', !open.length);
    const head = document.createElement('div'); head.className = 'co-card-head';
    const hd = document.createElement('div'); const h = document.createElement('h2'); h.className = 'co-h2'; h.textContent = 'Unassigned'; const n = document.createElement('p'); n.className = 'co-note'; n.textContent = 'Open tasks with no designer yet.'; hd.append(h, n); head.append(hd);
    if (open.length) { const go = document.createElement('button'); go.type = 'button'; go.className = 'co-link'; go.textContent = 'Open queue →'; go.addEventListener('click', () => CO.goTasks('open', { designer: '__none' })); head.append(go); }
    el.append(head);
    if (!open.length) { const p = document.createElement('p'); p.className = 'su-free'; p.textContent = 'Every open task has a designer.'; el.append(p); return; }
    const late = open.filter((r) => r.due === 'overdue').length, noeta = open.filter((r) => r.due === 'noeta').length;
    const big = document.createElement('div'); big.className = 'uq-big';
    const b = document.createElement('b'); b.textContent = CO.num(CO.sumQty(open)); const sp = document.createElement('span');
    sp.textContent = (CO.sumQty(open) === 1 ? 'creative' : 'creatives') + ' waiting' + (late ? ' · ' : '') ; if (late) { const x = document.createElement('span'); x.className = 'bad'; x.textContent = late + ' overdue'; sp.append(x); } if (noeta) sp.append(' · ' + noeta + ' with no ETA');
    big.append(b, sp); el.append(big);
    const list = document.createElement('div'); list.className = 'uq-list';
    open.slice().sort((a, b2) => (a.due === 'overdue' ? 0 : 1) - (b2.due === 'overdue' ? 0 : 1) || (a.eta || '9999').localeCompare(b2.eta || '9999') || String(a.req || '').localeCompare(String(b2.req || ''))).slice(0, 5).forEach((r) => {
      const row = document.createElement('div'); row.className = 'row click'; row.dataset.uid = r.uid; row.tabIndex = 0;
      row.append(CO.task(r), whenChip(r)); list.append(row);
    });
    el.append(list);
  });
  dash.draw('workload', (el) => {
    if (CO.notReady(el, 'box')) return;
    const m = new Map();
    const openRows = CO.rows().filter((r) => r.open);
    // Everyone holding open work is shown; an inactive person's work is labelled so it gets reassigned.
    openRows.forEach((r) => { r.list.forEach((d) => { const o = m.get(d) || { key: d, name: CO.isActive(d) ? d : d + ' (inactive, reassign)', overdue: 0, week: 0, later: 0 }; const q = r.qty || 1; if (r.due === 'overdue') o.overdue += q; else if (r.due === 'today' || r.due === 'week') o.week += q; else o.later += q; m.set(d, o); }); });
    const data = [...m.values()].map((d) => Object.assign(d, { total: d.overdue + d.week + d.later })).sort((a, b) => b.total - a.total);
    el.replaceChildren();
    if (!data.length) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'No open work assigned in this view.'; el.append(p); return; }
    const W = Math.max(280, el.clientWidth), rowH = 30, H = data.length * rowH + 24;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Open creatives per designer');
    const meas = svg.append('text').attr('class', 'lbl').text(data.reduce((a, d) => d.name.length > a.length ? d.name : a, ''));
    const L = Math.min(W * 0.45, meas.node().getComputedTextLength() + 14); meas.remove();
    const x = d3.scaleLinear([0, d3.max(data, (d) => d.total)], [L, W - 34]);
    const y = d3.scaleBand(data.map((d) => d.name), [0, H - 24]).padding(0.42);
    const keys = [['overdue', 'var(--bad)', 'Overdue'], ['week', 'var(--warn)', 'Due in 7 days'], ['later', 'var(--chart-muted)', 'Later or no ETA']];
    const ticks = x.ticks(Math.max(2, Math.floor((W - L) / 70))).filter(Number.isInteger);
    svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'grid').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', H - 24);
    svg.append('g').selectAll('text').data(ticks).join('text').attr('class', 'tick').attr('x', x).attr('y', H - 8).attr('text-anchor', 'middle').text((d) => d);
    const tipEl = CO.tip(el);
    const g = svg.append('g').selectAll('g').data(data).join('g').attr('class', 'bar')
      .on('click', (e, d) => CO.goTasks('open', { designer: d.key }))
      .on('mousemove', (e, d) => { tipEl.replaceChildren(); const k = document.createElement('div'); k.className = 'k'; k.textContent = d.name + ' · ' + d.total + ' open'; tipEl.append(k); keys.forEach(([key, c, lab]) => { const r = document.createElement('div'); const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = c; r.append(sw, lab + ': ' + d[key]); tipEl.append(r); }); const [px, py] = d3.pointer(e, el); CO.placeTip(tipEl, el, px, py); })
      .on('mouseleave', () => { tipEl.hidden = true; });
    g.append('text').attr('class', 'lbl').attr('x', L - 8).attr('y', (d) => y(d.name) + y.bandwidth() / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text((d) => d.name);
    g.each(function (d) { let x0 = 0; const gg = d3.select(this); keys.forEach(([k, c]) => { if (!d[k]) return; gg.append('rect').attr('x', x(x0)).attr('y', y(d.name)).attr('width', Math.max(2, x(x0 + d[k]) - x(x0) - 2)).attr('height', y.bandwidth()).attr('rx', y.bandwidth() / 2).style('fill', c); x0 += d[k]; }); });
    // A full-width hit area per row, so the whole line is clickable, not just the bar.
    g.insert('rect', ':first-child').attr('class', 'hit').attr('x', 0).attr('width', W).attr('y', (d) => y(d.name) - y.step() * y.paddingInner() / 2).attr('height', y.step());
    g.append('text').attr('class', 'tick').attr('x', (d) => x(d.total) + 6).attr('y', (d) => y(d.name) + y.bandwidth() / 2).attr('dy', '0.35em').text((d) => d.total);
  });
  dash.draw('pipeline', (el) => {
    if (CO.notReady(el, 'box')) return;
    const rs = CO.rows().filter((r) => !CO.CLOSED.has(r.stage));
    const base = [['To be planned', 'tbp'], ['In progress', 'wip'], ['Changes requested', 'changes'], ['Under review', 'review'], ['Awaiting brief', 'awaiting'], ['On hold', 'hold']];
    const known = new Set(base.map((b) => b[0]));
    const other = [...new Set(rs.map((r) => r.stage).filter((s) => !known.has(s)))];
    const st = base.concat(other.map((s) => [s, 'active'])).map(([s, go]) => ({ s, go, c: CO.stageColor(s) || 'var(--chart-muted)', n: rs.filter((r) => r.stage === s).length })).filter((d) => d.n || known.has(d.s));
    const total = d3.sum(st, (d) => d.n), max = d3.max(st, (d) => d.n) || 1;
    el.replaceChildren();
    const box = document.createElement('div'); box.className = 'pipe';
    st.forEach((d) => {
      const b = document.createElement('button'); b.type = 'button'; b.title = d.s + ': ' + d.n + (total ? ' (' + Math.round(d.n / total * 100) + '%)' : '') + '. Click to list them.';
      const l = document.createElement('span'); l.className = 'l'; const i = document.createElement('i'); i.style.background = d.c; l.append(i, d.s);
      const tr = document.createElement('span'); tr.className = 'track'; const f = document.createElement('i'); f.style.width = (d.n / max * 100) + '%'; f.style.background = d.c; tr.append(f);
      const v = document.createElement('span'); v.className = 'v'; v.textContent = CO.num(d.n);
      b.append(l, tr, v); b.addEventListener('click', () => CO.goTasks(d.go)); box.append(b);
    });
    const t = document.createElement('div'); t.className = 'pipe-total'; t.append('Not yet delivered'); const tb = document.createElement('b'); tb.textContent = CO.num(total); t.append(tb);
    el.append(box, t);
  });
  /* Delivered tile: the last six months, current month (partial) as the end dot. */
  dash.draw('kpi-spark', (el) => {
    el.replaceChildren(); if (CO.status() !== 'ok') return;
    const m = CO.thisMonth(), ms = [-5, -4, -3, -2, -1, 0].map((k) => CO.addMonths(m, k));
    const rs = CO.rows().filter((r) => r.stage === 'Delivered' && r.month);
    const v = ms.map((k) => CO.sumQty(rs.filter((r) => r.month === k)));
    const W = 72, H = 26, max = d3.max(v) || 1;
    const x = (i) => 2 + i * (W - 4) / (v.length - 1), y = (n) => H - 3 - n / max * (H - 6);
    const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Delivered per month, last six months: ' + v.join(', '));
    svg.append('path').attr('d', d3.line().curve(d3.curveMonotoneX).x((d, i) => x(i)).y(y)(v)).attr('fill', 'none').attr('stroke', 'var(--spark)').attr('stroke-opacity', 0.45).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    svg.append('circle').attr('cx', x(v.length - 1)).attr('cy', y(v[v.length - 1])).attr('r', 4).attr('fill', 'var(--spark)').attr('stroke', 'var(--panel)').attr('stroke-width', 2);
    el.title = ms.map((k, i) => CO.fmtMonth(k) + ': ' + v[i]).join(' · ');
  });

  /* ================= Stand-up ================= */
  const SU = { cards: null };
  dash.draw('su-summary', (el) => {
    el.replaceChildren(); const cs = SU.cards; if (!cs || CO.status() !== 'ok') return;
    const people = cs.filter((c) => c.name !== 'Unassigned'), un = cs.find((c) => c.name === 'Unassigned');
    const pill = (n, label, cls) => { const s = document.createElement('span'); if (cls) s.className = cls; const b = document.createElement('b'); b.textContent = CO.num(n); s.append(b, label); el.append(s); };
    pill(people.length, people.length === 1 ? 'person' : 'people');
    pill(d3.sum(cs, (c) => c.overdue.length), 'overdue', 'bad');
    pill(d3.sum(cs, (c) => c.today.length), 'due today');
    pill(people.filter((c) => !c.open.length).length, 'free to take work');
    if (un) pill(un.open.length, 'unassigned', un.overdue.length ? 'bad' : '');
  });
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
        // Inactive people appear only while they still hold open work, so it can be reassigned.
        r.list.forEach((d) => { if (!CO.isActive(d) && !r.open) return; if (!people.has(d)) people.set(d, []); people.get(d).push(r); });
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
      SU.cards = cards;
      dash.draw('su-summary');
      if (!cards.length) { const n = document.createElement('p'); n.className = 'co-note'; n.textContent = 'No active team members match these filters.'; el.append(n); return; }
      cards.forEach((c) => {
        const card = document.createElement('article'); card.className = 'su ' + (c.overdue.length ? 'late' : c.open.length ? 'busy' : 'free');
        const head = document.createElement('div'); head.className = 'su-head';
        const nm = document.createElement('span'); nm.className = 'su-name'; nm.append(CO.av(c.name === 'Unassigned' ? '?' : c.name, 'lg' + (c.name === 'Unassigned' ? ' none' : '')), c.name);
        const mem = CO.member(c.name);
        if (mem.role) { const r = document.createElement('span'); r.className = 'su-role'; r.textContent = mem.role; nm.append(r); }
        if (mem.status === 'New' && c.name !== 'Unassigned') { const n = document.createElement('span'); n.className = 'tag-new'; n.textContent = 'New'; nm.append(n); }
        if (mem.status === 'Inactive') { const n = document.createElement('span'); n.className = 'tag-new'; n.textContent = 'Inactive · reassign'; nm.append(n); }
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
    // One-click status views with live counts; the full list stays in the status menu.
    const CHIPS = [['active', 'Not delivered'], ['open', 'Open'], ['overdue', 'Overdue'], ['week', 'Due this week'], ['noeta', 'No ETA'], ['review', 'Under review'], ['delivered-month', 'Delivered this month'], ['all', 'All']];
    dash.draw('t-chips', (el) => {
      if (CO.status() !== 'ok') { el.replaceChildren(); return; }
      const rs = CO.rows(), ctx = CO.period(), cur = dash.params().stage || 'active';
      el.replaceChildren(...CHIPS.map(([k, label]) => {
        const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(cur === k));
        const n = rs.filter((r) => CO.stageMatch(r, k, ctx)).length;
        if (k === 'overdue' && n) b.className = 'bad';
        const c = document.createElement('b'); c.textContent = CO.num(n); b.append(label, c);
        b.addEventListener('click', () => dash.setParams({ stage: k }));
        return b;
      }));
    });
    dash.draw('tasks', (tb) => {
      if (CO.notReady(tb, 'table')) return;
      tb.replaceChildren();
      const rs = filtered();
      if (!rs.length) return CO.emptyRow(tb, 14, 'No tasks match these filters.');
      const LIMIT = 600;
      rs.slice(0, LIMIT).forEach((r) => {
        const tr = tb.insertRow(); tr.dataset.uid = r.uid; tr.className = 'click';
        CO.td(tr, r.id || '—', 'co-id'); CO.td(tr, r.brand, 'co-nowrap'); CO.td(tr, CO.topic(r), 'co-topic'); CO.td(tr, r.type, 'co-nowrap co-hide-md'); CO.td(tr, String(r.qty), 'n co-hide-lg');
        CO.td(tr, CO.who(r)); CO.td(tr, r.priority || '—', /^P[01]$/.test(r.priority || '') ? 'pri' : 'co-muted');
        CO.td(tr, r.open && r.eta ? whenChip(r) : CO.fmtDate(r.eta), 'co-nowrap'); CO.td(tr, CO.chip(r)); CO.td(tr, CO.srcTag(r), 'co-hide-lg');
        CO.td(tr, CO.fmtDate(r.req), 'co-hide-xl co-nowrap'); CO.td(tr, r.owner, 'co-hide-xl co-nowrap'); CO.td(tr, r.live_status, 'co-hide-xxl co-nowrap'); CO.td(tr, CO.links(r), 'co-hide-xxl');
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
      if (!can('Admin')) { wrap.append(tag); return wrap; }
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'co-link';
      btn.textContent = m.status === 'New' ? 'Add to team' : m.status === 'Active' ? 'Set inactive' : 'Set active';
      btn.addEventListener('click', (e) => { e.stopPropagation(); setMember(name, m.status === 'Active' ? 'Inactive' : 'Active'); });
      wrap.append(tag, btn); return wrap;
    };
    dash.draw('team', (tb) => {
      if (CO.notReady(tb, 'table')) return;
      tb.replaceChildren();
      const rs = CO.rows(), m = CO.thisMonth(), pm = CO.prevMonth(m);
      const top = CO.topTypes(rs.filter((r) => r.stage === 'Delivered'), 5), cmap = CO.typeColors(top);
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
        const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'co-name'; const nt = document.createElement('span'); nt.textContent = d.name; nb.append(CO.av(d.name), nt); nb.title = 'Open ' + d.name + "'s tasks"; nb.addEventListener('click', () => CO.goTasks('active', { designer: d.name }));
        CO.td(tr, nb, 'co-nowrap'); CO.td(tr, statusCell(d.name), 'co-nowrap');
        const ob = document.createElement('span'); ob.className = 'co-inbar'; const bi = document.createElement('i'); bi.style.width = (d.open / maxOpen * 3) + 'rem'; ob.append(bi, String(d.open)); CO.td(tr, ob, 'n');
        CO.td(tr, String(d.wip), 'n co-hide-lg');
        CO.td(tr, String(d.overdue), 'n' + (d.overdue ? ' bad' : ''));
        CO.td(tr, String(d.week), 'n co-hide-md'); CO.td(tr, String(d.review), 'n'); CO.td(tr, CO.num(d.thisM), 'n num-b'); CO.td(tr, CO.num(d.lastM), 'n'); CO.td(tr, d.avg ? d.avg.toFixed(1) : '—', 'n');
        CO.td(tr, d.brands, 'co-hide-lg co-clip').title = d.brands;
        const mix = document.createElement('span'); mix.className = 'co-mix';
        const total = CO.sumQty(d.del);
        top.forEach((t) => { const c = CO.sumQty(d.del.filter((r) => CO.typeOf(r, top) === t)); if (!c) return; const i = document.createElement('i'); i.style.flex = c + ' 1 0'; i.style.background = cmap.get(t); i.title = t + ': ' + c; mix.append(i); });
        mix.title = top.map((t) => t + ': ' + CO.sumQty(d.del.filter((r) => CO.typeOf(r, top) === t))).filter((x) => !/: 0$/.test(x)).join(' · ');
        CO.td(tr, mix, 'co-hide-md');
      });
    });
    dash.draw('team-legend', (el) => {
      if (CO.notReady(el, 'list')) return;
      const top = CO.topTypes(CO.rows().filter((r) => r.stage === 'Delivered'), 5), cmap = CO.typeColors(top);
      el.replaceChildren(...top.map((t) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = cmap.get(t); s.append(i, t); return s; }));
    });
    dash.draw('heat', (table) => {
      if (CO.notReady(table, 'table')) return;
      table.replaceChildren();
      const del = CO.rows().filter((r) => r.stage === 'Delivered' && r.month);
      const room = table.parentElement.clientWidth, months = room < 700 ? 6 : room < 1050 ? 9 : 12; // as many recent months as fit
      const ms = [...new Set(del.map((r) => r.month))].sort().filter((m) => m <= CO.thisMonth()).slice(-months);
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
          if (v) { const a = 0.1 + 0.7 * (v / max); c.style.background = `color-mix(in srgb, var(--heat) ${Math.round(a * 100)}%, transparent)`; c.title = d + ', ' + CO.fmtMonth(m, true) + ': ' + v + ' creatives'; if (a > 0.5) c.classList.add('hot'); } else c.classList.add('co-muted');
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
      if ((dash.params().rchart || 'total') === 'total') { el.replaceChildren(); return; }
      const top = CO.topTypes(delivered(), 5), cmap = CO.typeColors(top);
      el.replaceChildren(...top.map((t) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = cmap.get(t); s.append(i, t); return s; }));
    });
    dash.draw('r-chart', (el) => {
      if (CO.notReady(el, 'box')) return;
      const del = delivered().filter((r) => r.month <= CO.thisMonth());
      el.replaceChildren();
      if (!del.length) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'No deliveries in this view.'; el.append(p); return; }
      const pr = CO.period();
      const byType = (dash.params().rchart || 'total') === 'type';
      const top = byType ? CO.topTypes(del, 5) : ['Total'], cmap = byType ? CO.typeColors(top) : new Map([['Total', 'var(--brand)']]);
      const ms = [...new Set(del.map((r) => r.month))].sort().slice(-18);
      const inSel = (m) => pr.all || (m + '-01' <= pr.to && CO.monthEnd(m) >= pr.from);
      const series = ms.map((m) => { const o = { m }; top.forEach((t) => { o[t] = 0; }); del.filter((r) => r.month === m).forEach((r) => { o[byType ? CO.typeOf(r, top) : 'Total'] += r.qty || 1; }); o.total = top.reduce((a, t) => a + o[t], 0); return o; });
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
      if (!byType) {
        // Total: pill bars. The report period is solid; other months are hatched so the selection reads first.
        const pid = 'hatch-' + Math.random().toString(36).slice(2, 8);
        const pat = svg.append('defs').append('pattern').attr('id', pid).attr('width', 7).attr('height', 7).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
        pat.append('rect').attr('width', 7).attr('height', 7).style('fill', 'var(--bar)').style('opacity', 0.22);
        pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 7).style('stroke', 'var(--bar)').attr('stroke-width', 2.2).style('opacity', 0.75);
        const pw = Math.max(8, Math.min(46, x.bandwidth() * 0.78)), po = (x.bandwidth() - pw) / 2, base = yt(0);
        svg.append('g').selectAll('rect').data(series).join('rect').attr('x', (d) => x(d.m) + po).attr('width', pw)
          .attr('y', (d) => Math.min(yt(d.total), base - pw)).attr('height', (d) => d.total ? Math.max(pw, base - yt(d.total)) : 0).attr('rx', pw / 2)
          .style('fill', (d) => inSel(d.m) && !pr.all ? 'var(--bar)' : 'url(#' + pid + ')');
        svg.append('g').selectAll('circle').data(series.filter((d) => d.total)).join('circle').attr('cx', (d) => x(d.m) + x.bandwidth() / 2).attr('cy', (d) => Math.min(yt(d.total), base - pw) + pw / 2).attr('r', Math.min(5, pw / 4))
          .style('fill', (d) => inSel(d.m) && !pr.all ? 'var(--panel)' : 'var(--bar)');
      } else {
      const stack = d3.stack().keys(top)(series);
      const bw = Math.min(24, x.bandwidth()), off = (x.bandwidth() - bw) / 2;
      svg.append('g').selectAll('g').data(stack).join('g').style('fill', (s) => cmap.get(s.key))
        .selectAll('rect').data((s) => s).join('rect').attr('x', (d) => x(d.data.m) + off).attr('width', bw)
        .attr('y', (d) => yt(d[1])).attr('height', (d) => Math.max(0, yt(d[0]) - yt(d[1]) - (d[1] > d[0] && d[0] > 0 ? 2 : 0))).attr('rx', 3)
        .style('opacity', (d) => inSel(d.data.m) ? 1 : 0.45);
      }
      const lw = byType ? Math.min(24, x.bandwidth()) : Math.min(46, x.bandwidth() * 0.78);
      svg.append('g').selectAll('text').data(series).join('text').attr('class', (d) => 'tick' + (inSel(d.m) ? ' on' : '')).attr('x', (d) => x(d.m) + x.bandwidth() / 2).attr('y', (d) => (byType ? yt(d.total) : Math.min(yt(d.total), yt(0) - lw)) - 7).attr('text-anchor', 'middle').text((d) => lw >= 16 && (x.bandwidth() >= 30 || inSel(d.m)) ? d.total : '');
      const tipEl = CO.tip(el);
      svg.append('g').selectAll('rect').data(series).join('rect').attr('class', 'bar hit').attr('x', (d) => x(d.m)).attr('width', x.bandwidth()).attr('y', mT).attr('height', H - mB - mT)
        .on('click', (e, d) => dash.setParams({ rpreset: 'custom', rfrom: d.m + '-01', rto: CO.monthEnd(d.m) }))
        .on('mousemove', (e, d) => { tipEl.replaceChildren(); const k = document.createElement('div'); k.className = 'k'; k.textContent = CO.fmtMonth(d.m, true) + ' · ' + d.total + ' creatives'; tipEl.append(k); (byType ? top.slice().reverse() : []).forEach((t) => { if (!d[t]) return; const r = document.createElement('div'); const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = cmap.get(t); r.append(sw, t + ': ' + d[t]); tipEl.append(r); }); const [px] = d3.pointer(e, el); CO.placeTip(tipEl, el, px, el.clientHeight * 0.3); })
        .on('mouseleave', () => { tipEl.hidden = true; });
    });
    const crossTable = (table, keyFn, label, tag) => {
      if (CO.notReady(table, 'table')) return;
      table.replaceChildren();
      const pr = CO.period(), rs = inRange(CO.rows(), pr.from, pr.to);
      const prev = pr.pfrom ? inRange(CO.rows(), pr.pfrom, pr.pto) : null;
      const top = CO.topTypes(rs, 3);
      const groups = new Map();
      rs.forEach((r) => keyFn(r).forEach((k) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }));
      const hr = table.createTHead().insertRow();
      [label].concat(top, ['Total'], prev ? ['vs prev.'] : []).forEach((h, i) => { const th = document.createElement('th'); th.textContent = h; if (i) th.className = 'n'; hr.append(th); });
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
    const ORDER = ['Duplicate ID', 'Incomplete row, not counted', 'Open, no ETA', 'No designer assigned', 'Unrecognised status', 'Delivered, no designer', 'Delivered, no creative link', 'ETA before request date', 'Request date year looks mistyped', 'ETA year looks mistyped', 'Request date unreadable', 'ETA unreadable', 'No brand'];
    // Rows too incomplete to be a task are listed here so nothing drops out unseen.
    const ignoredRows = () => (S.ignored || []).filter((x) => !dash.params().src || x.source === dash.params().src).map((x) => ({ uid: 'ignored:' + x.src + ':' + x.row, id: x.id, source: x.source, src: x.src, row: x.row, brand: '—', topic: 'Row ' + x.row + ' of ' + ((S.sources[x.src] && S.sources[x.src].tab) || x.src) + (x.owner ? ' · ' + x.owner : '') + (x.status ? ' · ' + x.status : ''), designers: '', list: [], stage: 'Not counted', req: x.req, eta: x.eta, flags: 'Incomplete row, not counted', open: false }));
    const flagged = () => CO.rows().filter((r) => r.flags).concat(dash.params().designer || dash.params().brand || dash.params().type ? [] : ignoredRows());
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
        CO.td(tr, r.id || '—', 'co-id'); CO.td(tr, CO.srcTag(r), 'co-hide-md'); CO.td(tr, r.brand, 'co-nowrap'); CO.td(tr, CO.topic(r), 'co-topic');
        CO.td(tr, r.designers || 'Unassigned', r.designers ? 'co-nowrap' : 'co-muted co-nowrap'); CO.td(tr, CO.chip(r));
        CO.td(tr, CO.fmtDate(r.req), 'co-nowrap co-hide-md'); CO.td(tr, CO.fmtDate(r.eta), 'co-nowrap'); CO.td(tr, r.flags);
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
      const edit = can('Editor');
      ['ed-status', 'ed-eta', 'ed-designer', 'ed-qty'].forEach((id) => { $(id).disabled = !edit; });
      if (!edit) $('ed-priority').disabled = true;
      $('ed-save').hidden = !edit;
      if (!edit) $('ed-msg').textContent = 'View only. Ask the admin for Editor access to change tasks.';
      $('ed-history').hidden = !(A.mode === 'auth' && can('Admin') && r.id);
      if (dlgE.showModal) dlgE.showModal(); else dlgE.setAttribute('open', '');
    }
    const openFrom = (e) => {
      if (e.target.closest('a, button, input, select')) return;
      const el = e.target.closest('[data-uid]'); if (el) openEditor(el.dataset.uid);
    };
    document.querySelector('.co').addEventListener('click', openFrom);
    document.querySelector('.co').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-uid][tabindex]')) openEditor(e.target.dataset.uid); });
    $('ed-cancel').addEventListener('click', () => dlgE.close());
    $('ed-history').addEventListener('click', () => { if (!current) return; dlgE.close(); AX.q = current.id; AX.kind = ''; document.getElementById('ax-q').value = current.id; document.getElementById('ax-kind').value = ''; dash.setParams({ tab: 'access' }); });
    $('editor-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = current; if (!r || !can('Editor')) return;
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
  /* ================= Access (admins): requests, people, activity log ================= */
  const AX = { users: null, you: '', log: null, next: null, total: 0, q: '', kind: '', who: '', err: '', busy: false, pending: 0 };
  async function axRefresh(withLog) {
    if (A.mode !== 'auth' || !can('Admin')) return;
    try {
      const b = await callApi({ action: 'users' });
      if (b.ok) { AX.users = b.users; AX.you = b.you; AX.err = ''; AX.pending = b.users.filter((u) => u.status === 'Pending').length; syncControls(); fillWho(); if (PR.email) drawPerson(); } else AX.err = errText(b.error);
    } catch (e) { if (e instanceof AuthLost) return; AX.err = e.message; }
    dash.draw('ax-pending'); dash.draw('ax-users');
    // On the 30-second tick the log is refreshed only while it shows the newest page, so "Load older" is not undone.
    if (withLog || !AX.log || AX.log.length <= 200) axLog(false);
  }
  async function axLog(more) {
    if (AX.busy) return; AX.busy = true;
    try {
      const b = await callApi({ action: 'audit', limit: 200, q: AX.q, kind: AX.kind, who: AX.who, before: more ? AX.next : undefined });
      if (b.ok) { AX.log = more ? (AX.log || []).concat(b.entries) : b.entries; AX.next = b.next; AX.total = b.total; AX.err = ''; } else AX.err = errText(b.error);
    } catch (e) { if (!(e instanceof AuthLost)) AX.err = e.message; }
    AX.busy = false;
    dash.draw('ax-log'); dash.draw('ax-count');
  }
  async function setAccess(email, patch, okText) {
    try { await post(Object.assign({ action: 'setAccess', email }, patch)); toast(okText); }
    catch (err) { toast('Not saved: ' + err.message, true); }
    axRefresh(true);
  }
  const when = (iso) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined, hour: 'numeric', minute: '2-digit' }); };
  const nameOf = (email) => { const u = (AX.users || []).find((x) => x.email === String(email).toLowerCase()); return u && u.name ? u.name : email; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const roleSelect = (value) => { const s = el('select', 'co-select'); ['Viewer', 'Editor', 'Admin'].forEach((r) => s.append(new Option(ROLE_LABEL[r], r))); s.value = value || 'Viewer'; s.setAttribute('aria-label', 'Access level'); return s; };
  const STATUS_LABEL = { Approved: 'Has access', Pending: 'Waiting for approval', Revoked: 'Revoked', Denied: 'Declined' };
  /* Google profile photo, or the person's initial. */
  const avatar = (u, size) => {
    const box = el('span', 'ax-avatar' + (size ? ' ' + size : ''));
    if (u.photo && /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(u.photo)) { const i = document.createElement('img'); i.src = u.photo; i.alt = ''; i.referrerPolicy = 'no-referrer'; i.loading = 'lazy'; i.onerror = () => { i.remove(); box.textContent = (u.name || u.email).charAt(0).toUpperCase(); }; box.append(i); }
    else box.textContent = (u.name || u.email || '?').charAt(0).toUpperCase();
    return box;
  };
  const personLink = (u) => {
    const b = el('button', 'ax-person'); b.type = 'button';
    b.append(avatar(u), el('span', '', (u.name || u.email) + (u.owner ? ' (owner)' : u.email === AX.you ? ' (you)' : '')));
    b.addEventListener('click', () => openPerson(u.email));
    return b;
  };
  function fillWho() {
    const sel = document.getElementById('ax-who'); if (!sel || sel === document.activeElement) return;
    const cur = AX.who;
    sel.replaceChildren(new Option('Everyone', ''), ...(AX.users || []).slice().sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map((u) => new Option((u.name || u.email) + (u.name ? ' · ' + u.email : ''), u.email)));
    sel.value = cur;
  }
  const showActivityOf = (email) => { AX.who = email; AX.q = ''; AX.kind = ''; document.getElementById('ax-q').value = ''; document.getElementById('ax-kind').value = ''; fillWho(); document.getElementById('ax-who').value = email; axLog(false); document.getElementById('ax-log-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  /* Person profile: details, access controls and their own activity. */
  const PR = { email: '', log: null, busy: false };
  const dlgP = document.getElementById('person');
  async function openPerson(email) {
    PR.email = email; PR.log = null; drawPerson();
    if (dlgP.showModal && !dlgP.open) dlgP.showModal(); else dlgP.setAttribute('open', '');
    try { const b = await callApi({ action: 'audit', who: email, limit: 50 }); PR.log = b.ok ? b.entries : []; PR.total = b.ok ? b.entries.length : 0; PR.more = b.ok && !!b.next; } catch (e) { if (!(e instanceof AuthLost)) PR.log = []; }
    if (PR.email === email) drawPerson();
  }
  function drawPerson() {
    const u = (AX.users || []).find((x) => x.email === PR.email);
    const head = document.getElementById('pr-head'), facts = document.getElementById('pr-facts'), act = document.getElementById('pr-actions'), log = document.getElementById('pr-log');
    head.replaceChildren(); facts.replaceChildren(); act.replaceChildren(); log.replaceChildren();
    if (!u) { head.append(el('p', 'co-note', 'Not on the access list.')); return; }
    const who = el('div', 'pr-who');
    who.append(el('h2', 'co-h2', u.name || u.email), el('span', 'co-note', u.email));
    const chip = el('span', 'chip ' + (u.status === 'Approved' ? 's-ok' : u.status === 'Pending' ? 's-warn' : 's-mute'), STATUS_LABEL[u.status] + (u.status === 'Approved' ? ' · ' + ROLE_LABEL[u.role] : ''));
    who.append(chip);
    head.append(avatar(u, 'lg'), who);
    const fact = (k, v) => { if (!v) return; facts.append(el('dt', '', k), el('dd', '', v)); };
    fact('Team / role', u.team); fact('Note to admin', u.note); fact('First asked', when(u.requestedOn));
    fact('Decided by', u.decidedBy ? nameOf(u.decidedBy) + ' · ' + when(u.decidedOn) : ''); fact('Last sign-in', when(u.lastSignIn));
    const locked = u.owner || u.email === AX.you;
    if (locked) act.append(el('p', 'co-note', u.owner ? 'The owner always has Admin access.' : 'You cannot change your own access.'));
    else {
      const sel = roleSelect(u.role);
      const lab = el('label', 'co-field', 'Access level'); lab.append(sel);
      act.append(lab);
      const btn = (text, cls, fn) => { const b = el('button', 'co-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.addEventListener('click', fn); act.append(b); };
      if (u.status === 'Pending') {
        btn('Approve', 'primary', () => setAccess(u.email, { status: 'Approved', role: sel.value }, (u.name || u.email) + ' approved: ' + ROLE_LABEL[sel.value]));
        btn('Reject', '', () => { if (confirm('Reject the request from ' + u.email + '?')) setAccess(u.email, { status: 'Denied' }, 'Request from ' + u.email + ' rejected'); });
      } else if (u.status === 'Approved') {
        sel.addEventListener('change', () => setAccess(u.email, { role: sel.value }, (u.name || u.email) + ': ' + ROLE_LABEL[sel.value]));
        btn('Revoke access', 'danger', () => { if (confirm('Revoke access for ' + (u.name || u.email) + '? They are signed out within 30 seconds. Their past changes stay in the log.')) setAccess(u.email, { status: 'Revoked' }, 'Access revoked for ' + (u.name || u.email)); });
      } else {
        btn('Give access', 'primary', () => setAccess(u.email, { status: 'Approved', role: sel.value }, (u.name || u.email) + ' has access: ' + ROLE_LABEL[sel.value]));
      }
    }
    if (!PR.log) { log.append(el('p', 'co-note', 'Loading activity…')); return; }
    if (!PR.log.length) { log.append(el('p', 'co-note', 'No activity yet.')); return; }
    const ul = el('ul', 'pr-list');
    PR.log.forEach((e) => {
      const li = el('li');
      li.append(el('span', 'pr-when', when(e.when)));
      const what = el('span', 'pr-what');
      what.append(el('b', '', e.action));
      if (e.record) what.append(document.createTextNode(' · ' + e.record));
      if (e.field) what.append(document.createTextNode(' · ' + e.field + ': '), el('span', 'ax-before', e.before === '' ? '(blank)' : e.before), document.createTextNode(' → '), el('span', '', e.after === '' ? '(blank)' : e.after));
      else if (e.details) what.append(document.createTextNode(' · ' + e.details));
      li.append(what); ul.append(li);
    });
    log.append(ul);
    if (PR.more) log.append(el('p', 'co-note', 'Showing the latest 50. Use "Full activity" for everything.'));
  }
  document.getElementById('pr-close').addEventListener('click', () => { dlgP.close(); });
  dlgP.addEventListener('close', () => { PR.email = ''; });
  document.getElementById('pr-all').addEventListener('click', () => { const e = PR.email; dlgP.close(); showActivityOf(e); });

  dash.draw('ax-pending', (box) => {
    box.replaceChildren();
    if (!AX.users) { box.append(el('p', 'co-note', AX.err || 'Loading…')); return; }
    const list = AX.users.filter((u) => u.status === 'Pending').sort((a, b) => String(b.requestedOn).localeCompare(String(a.requestedOn)));
    if (!list.length) { box.append(el('p', 'co-note', 'No requests waiting.')); return; }
    list.forEach((u) => {
      const card = el('div', 'ax-req-item');
      const info = el('div', 'ax-req-info');
      info.append(personLink(u), el('span', 'co-note', u.email + ' · asked ' + when(u.requestedOn) + (u.lastSignIn && u.lastSignIn !== u.requestedOn ? ' · last tried ' + when(u.lastSignIn) : '')));
      if (u.team) info.append(el('span', '', 'Team / role: ' + u.team));
      if (u.note) info.append(el('span', 'co-note', '“' + u.note + '”'));
      const act = el('div', 'ax-req-act');
      const sel = roleSelect('Viewer');
      const ok = el('button', 'co-btn primary', 'Approve'); ok.type = 'button';
      ok.addEventListener('click', () => setAccess(u.email, { status: 'Approved', role: sel.value }, (u.name || u.email) + ' approved: ' + ROLE_LABEL[sel.value]));
      const no = el('button', 'co-btn', 'Reject'); no.type = 'button';
      no.addEventListener('click', () => { if (confirm('Reject the request from ' + u.email + '?')) setAccess(u.email, { status: 'Denied' }, 'Request from ' + u.email + ' rejected'); });
      act.append(sel, ok, no);
      card.append(info, act); box.append(card);
    });
  });
  dash.draw('ax-users', (tb) => {
    tb.replaceChildren();
    if (!AX.users) { CO.emptyRow(tb, 7, AX.err || 'Loading…'); return; }
    const order = { Approved: 0, Revoked: 1, Denied: 2 };
    const list = AX.users.filter((u) => u.status !== 'Pending').sort((a, b) => (order[a.status] - order[b.status]) || (RANK[b.role] - RANK[a.role]) || (a.name || a.email).localeCompare(b.name || b.email));
    if (!list.length) { CO.emptyRow(tb, 7, 'Nobody yet.'); return; }
    list.forEach((u) => {
      const tr = tb.insertRow();
      const locked = u.owner || u.email === AX.you;
      CO.td(tr, personLink(u), 'co-nowrap');
      CO.td(tr, u.email, 'co-nowrap');
      const rc = tr.insertCell();
      if (locked || u.status !== 'Approved') rc.textContent = ROLE_LABEL[u.role];
      else { const s = roleSelect(u.role); s.addEventListener('change', () => setAccess(u.email, { role: s.value }, (u.name || u.email) + ': ' + ROLE_LABEL[s.value])); rc.append(s); }
      const sc = tr.insertCell(); const chip = el('span', 'chip ' + (u.status === 'Approved' ? 's-ok' : 's-mute'), STATUS_LABEL[u.status]); sc.append(chip);
      CO.td(tr, when(u.lastSignIn), 'co-nowrap');
      CO.td(tr, u.decidedBy ? nameOf(u.decidedBy) + ' · ' + when(u.decidedOn) : '—', 'co-nowrap co-muted co-hide-md');
      const ac = tr.insertCell(); ac.className = 'co-nowrap ax-acts';
      const actv = el('button', 'co-link', 'Activity'); actv.type = 'button'; actv.addEventListener('click', () => showActivityOf(u.email)); ac.append(actv);
      if (!locked) {
        const b = el('button', 'co-link', u.status === 'Approved' ? 'Revoke' : 'Give access again'); b.type = 'button';
        b.classList.add(u.status === 'Approved' ? 'ax-revoke' : 'ax-restore');
        b.addEventListener('click', () => {
          if (u.status === 'Approved') { if (confirm('Remove access for ' + (u.name || u.email) + '? They are signed out within 30 seconds, and their past changes stay in the log.')) setAccess(u.email, { status: 'Revoked' }, 'Access removed for ' + (u.name || u.email)); }
          else setAccess(u.email, { status: 'Approved' }, (u.name || u.email) + ' has access again (' + u.role + ')');
        });
        ac.append(b);
      }
    });
  });
  dash.draw('ax-log', (tb) => {
    tb.replaceChildren();
    if (!AX.log) { CO.emptyRow(tb, 8, AX.err || 'Loading…'); return; }
    if (!AX.log.length) { CO.emptyRow(tb, 8, AX.q || AX.kind || AX.who ? 'Nothing matches.' : 'No activity recorded yet.'); return; }
    AX.log.forEach((e) => {
      const tr = tb.insertRow();
      CO.td(tr, when(e.when), 'co-nowrap');
      const w = CO.td(tr, e.who.includes('@') ? nameOf(e.who) : e.who, 'co-nowrap'); w.title = e.who + (e.role ? ' · ' + (ROLE_LABEL[e.role] || e.role) : '');
      CO.td(tr, e.action, 'co-nowrap');
      CO.td(tr, e.record || '—', 'co-id');
      CO.td(tr, e.field || (e.details ? '' : '—'));
      const bc = CO.td(tr, e.before === '' ? (e.field ? '(blank)' : '') : e.before, 'ax-val ax-before'); bc.title = e.before;
      const acell = CO.td(tr, e.after === '' ? (e.field ? '(blank)' : e.details) : e.after, 'ax-val'); acell.title = e.after || e.details;
      CO.td(tr, [[e.sheet, e.tab].filter(Boolean).join(' / '), e.row ? 'row ' + e.row : '', e.via].filter(Boolean).join(' · '), 'co-muted');
    });
  });
  dash.draw('ax-count', (n) => {
    const older = document.getElementById('ax-older');
    older.hidden = !AX.next; older.disabled = AX.busy;
    n.textContent = AX.log ? 'Showing ' + CO.num(AX.log.length) + (AX.q || AX.kind || AX.who ? ' matching' : '') + ' of ' + CO.num(AX.total) + ' entries.' : '';
  });
  let axTimer = 0;
  document.getElementById('ax-q').addEventListener('input', (e) => { clearTimeout(axTimer); axTimer = setTimeout(() => { AX.q = e.target.value.trim(); axLog(false); }, 400); });
  document.getElementById('ax-kind').addEventListener('change', (e) => { AX.kind = e.target.value; axLog(false); });
  document.getElementById('ax-who').addEventListener('change', (e) => { AX.who = e.target.value; axLog(false); });
  document.getElementById('ax-older').addEventListener('click', () => axLog(true));
  document.getElementById('ax-csv').addEventListener('click', () => {
    CO.csv('activity-log-' + CO.today() + '.csv', ['When', 'Who', 'Their role', 'Action', 'Sheet', 'Tab', 'Task / record', 'Row', 'Field', 'Before', 'After', 'Details', 'Via'],
      (AX.log || []).map((e) => [e.when, e.who, e.role, e.action, e.sheet, e.tab, e.record, e.row, e.field, e.before, e.after, e.details, e.via]));
  });
  document.getElementById('ax-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('ax-email').value.trim().toLowerCase(), role = document.getElementById('ax-role').value;
    const msg = document.getElementById('ax-msg');
    if (!A.domains.some((d) => email.endsWith('@' + d))) { msg.textContent = 'Use a ' + A.domains.map((d) => '@' + d).join(' or ') + ' address.'; return; }
    const exists = (AX.users || []).find((u) => u.email === email);
    msg.textContent = '';
    setAccess(email, exists ? { status: 'Approved', role } : { status: 'Approved', role }, email + ' can now sign in: ' + ROLE_LABEL[role]);
    e.target.reset();
  });

  /* ================= Sign-in ================= */
  const gate = document.getElementById('gate');
  const $g = (id) => document.getElementById(id);
  const G = { tab: 'login', cred: null, credAt: 0, unknown: null };
  let gisReady = null;
  function gis() {
    if (!gisReady) {
      gisReady = new Promise((res, rej) => {
        if (window.google && google.accounts && google.accounts.id) return res();
        const sc = document.createElement('script');
        sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
        sc.onload = () => res(); sc.onerror = () => { gisReady = null; rej(new Error('Google sign-in could not load. Turn off ad or privacy blockers for this page and reload.')); };
        document.head.append(sc);
      }).then(() => {
        google.accounts.id.initialize({ client_id: A.clientId, callback: (r) => onCredential(r.credential), auto_select: true, cancel_on_tap_outside: true, itp_support: true, use_fedcm_for_prompt: true });
      });
    }
    return gisReady;
  }
  const gateMsg = (text, bad) => { const m = $g('gate-msg'); m.textContent = text || ''; m.classList.toggle('bad', !!bad); };
  function gateTab(t) {
    G.tab = t;
    $g('gate-state').hidden = true; $g('gate-tabs').hidden = false;
    document.querySelectorAll('[data-gtab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.gtab === t)));
    document.querySelectorAll('[data-gpanel]').forEach((p) => { p.hidden = p.dataset.gpanel !== t; });
    const asMe = !!(G.cred && G.unknown && t === 'signup');
    $g('gate-asme').hidden = !asMe; $g('g-signup').hidden = asMe;
    if (asMe) $g('gate-asme').textContent = 'Request access as ' + G.unknown.email;
  }
  function gateState(title, text, again) {
    $g('gate-tabs').hidden = true; document.querySelectorAll('[data-gpanel]').forEach((p) => { p.hidden = true; });
    $g('gate-state').hidden = false; $g('gs-title').textContent = title; $g('gs-text').textContent = text; $g('gs-again').hidden = !again;
    gateMsg('');
  }
  async function showGate(msg) {
    document.body.dataset.gate = '1'; gate.hidden = false;
    let m = msg; try { m = m || sessionStorage.getItem('co.gatemsg') || ''; sessionStorage.removeItem('co.gatemsg'); } catch (e) { /* ignore */ }
    gateTab(G.tab); gateMsg(m);
    $g('gate-domains').textContent = A.domains.map((d) => '@' + d).join(' or ');
    try {
      await gis();
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      const opts = (text) => ({ type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', text, shape: 'pill', logo_alignment: 'left', width: 280 });
      google.accounts.id.renderButton($g('g-login'), opts('signin_with'));
      google.accounts.id.renderButton($g('g-signup'), opts('signup_with'));
      if (!m) google.accounts.id.prompt();
    } catch (e) { gateMsg(e.message, true); }
  }
  function onCredential(cred) { if (!cred) return; G.cred = cred; G.credAt = Date.now(); signin(G.tab === 'signup' ? 'signup' : 'login'); }
  async function signin(intent) {
    if (!G.cred || Date.now() - G.credAt > 50 * 60 * 1000) { G.cred = null; gateTab(intent === 'signup' ? 'signup' : 'login'); gateMsg('Click the Google button to continue.'); return; }
    gateMsg('Checking your access…');
    let body;
    try {
      const res = await fetch(A.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'signin', idToken: G.cred, intent, profile: intent === 'signup' ? { team: $g('gate-team').value, note: $g('gate-note').value } : undefined }) });
      body = parse(await res.text());
    } catch (e) { gateMsg('Could not reach the dashboard server. Check your connection and try again.', true); return; }
    const domains = A.domains.map((d) => '@' + d).join(' or ');
    if (!body.ok) {
      if (body.error === 'domain') { G.cred = null; gateMsg(body.email + ' cannot be used here. Sign in with your company Google account (' + domains + ').', true); try { google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ } return; }
      if (body.error === 'bad_token') { G.cred = null; gateMsg('Google sign-in did not complete. Try again.', true); return; }
      gateMsg('Sign-in failed: ' + body.error, true); return;
    }
    const who = body.user || {}, first = who.name ? ' ' + who.name.split(' ')[0] : '';
    if (body.status === 'approved') {
      A.session = body.session; LS.set('co.session', body.session);
      G.cred = null; signedIn(body.user); return;
    }
    if (body.status === 'unknown') { G.unknown = who; gateTab('signup'); gateMsg(who.email + ' does not have access yet. Tell us your team and request access.'); return; }
    if (body.status === 'pending') return gateState(body.isNew ? 'Request sent' : 'Waiting for approval', (body.isNew ? 'Thanks' + first + '. ' + who.email + ' does not have access yet, so a request has been sent to the Creative Head.' : 'Your request for ' + who.email + ' is still with the Creative Head.') + ' You will get an email once it is approved, then log in here. Until then the dashboard shows no data.', true);
    if (body.status === 'denied') return gateState('Request declined', 'The request for ' + who.email + ' was declined. Talk to the Creative Head if you need access.', false);
    return gateState('Access removed', 'Access for ' + who.email + ' has been removed. Talk to the Creative Head if you need it back.', false);
  }
  document.querySelectorAll('[data-gtab]').forEach((b) => b.addEventListener('click', () => { gateTab(b.dataset.gtab); gateMsg(''); }));
  $g('gate-signup').addEventListener('submit', (e) => { e.preventDefault(); if (G.cred) signin('signup'); });
  $g('gs-again').addEventListener('click', () => signin('login'));
  $g('gs-other').addEventListener('click', () => { G.cred = null; G.unknown = null; try { google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ } gateTab('login'); });

  function signedIn(user) {
    A.user = user; gate.hidden = true; delete document.body.dataset.gate;
    renderAll(); load(false);
    // Admins see how many access requests are waiting as soon as they open the dashboard.
    if (can('Admin')) callApi({ action: 'ver' }).then((b) => { if (b.ok && typeof b.pending === 'number') { AX.pending = b.pending; syncControls(); } }).catch(() => {});
  }
  /* The session ended or access was removed: forget it and clear the page, so no data stays on screen. */
  function lostAccess(body) {
    const msg = body.error === 'session_expired' ? 'Your sign-in has ended. Log in again to continue.'
      : body.error === 'no_access' ? (body.status === 'Pending' ? 'Your access request is still waiting for approval.' : 'Your access to this dashboard has been removed. Talk to the Creative Head if you need it back.')
      : '';
    A.session = ''; LS.set('co.session', null);
    if (A.user) { try { sessionStorage.setItem('co.gatemsg', msg); } catch (e) { /* ignore */ } A.user = null; location.reload(); return; }
    showGate(msg);
  }
  document.getElementById('btn-signout').addEventListener('click', async () => {
    try { await callApi({ action: 'signout' }); } catch (e) { /* signing out locally is what matters */ }
    A.session = ''; LS.set('co.session', null);
    try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
    try { sessionStorage.setItem('co.gatemsg', 'You are signed out.'); } catch (e) { /* ignore */ }
    location.reload();
  });

  async function start() {
    const url = conn().url;
    if (!url) { A.mode = 'key'; document.body.dataset.mode = 'key'; S.status = 'unconfigured'; renderAll(); return; }
    A.url = url; S.status = 'loading'; renderAll();
    let cfg = null, reached = false;
    try {
      const u = new URL(url); u.searchParams.set('mode', 'config');
      const text = await (await fetch(u.toString(), { redirect: 'follow' })).text(); reached = true;
      cfg = JSON.parse(text);
    } catch (e) { /* unreachable, or an older web app */ }
    if (cfg && cfg.ok && cfg.auth) {
      A.mode = 'auth'; A.clientId = cfg.clientId; A.domains = cfg.domains || []; document.body.dataset.mode = 'auth';
      if (A.session) {
        try { const me = await callApi({ action: 'me' }); if (me.ok) { signedIn(me.user); return; } }
        catch (e) { if (e instanceof AuthLost) return; S.status = 'error'; S.error = 'This browser could not reach the web app. Check your connection and click Refresh.'; A.mode = null; renderAll(); return; }
      }
      showGate(); return;
    }
    if (!reached) { S.status = 'error'; S.error = 'This browser could not reach the web app. Check your connection, turn off ad or privacy blockers for this page and click Refresh.'; renderAll(); return; }
    A.mode = 'key'; document.body.dataset.mode = 'key'; load(false);
  }

  renderAll();
  start();
})();
