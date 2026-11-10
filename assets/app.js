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
  let TASK_SAVE = null; // set by the task editor; also used by the assistant
  const TABS = ['today', 'standup', 'tasks', 'notes', 'team', 'reports', 'health', 'access'];
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
  /* The 30-second check also tells the web app which page you are on and which task you are editing (shown to admins). */
  const EDITING = { uid: '', label: '' };
  const probeVer = () => (A.mode === 'auth' ? callApi({ action: 'ver', at: { page: P.tab, task: EDITING.uid, taskLabel: EDITING.label } }) : keyGet({ mode: 'ver' }));
  const errText = (e) => (e === 'bad_key' ? 'The key was not accepted. Copy it again from the Apps Script execution log after running setup.' : e === 'forbidden' ? 'Your role does not allow this. Ask the admin for more access.' : 'The web app reported: ' + e);

  async function load(fresh) {
    if (A.mode === 'auth' && !A.user) return;
    if (A.mode !== 'auth') { const { url, key } = conn(); if (!url || !key) { S.status = 'unconfigured'; renderAll(); return; } }
    if (S.status !== 'ok') S.status = 'loading';
    S.refreshing = true; renderAll();
    try {
      const body = A.mode === 'auth' ? await callApi({ action: 'data', fresh: !!fresh }) : await keyGet(fresh ? { fresh: '1' } : {});
      if (!body.ok) throw new Error(errText(body.error));
      applyData(body);
      if (A.mode === 'auth' && A.user) DC.put(A.user.email, body);
      loadHealth();
      if (P.tab === 'access') axRefresh(true);
      LS.set('co.cacheAt', S.generatedAt);
      afterFirstData();
    } catch (err) {
      if (err instanceof AuthLost) { S.refreshing = false; return; }
      S.error = err && err.message ? err.message : String(err);
      if (err instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(S.error)) {
        let reachable = false;
        try { reachable = !!(await probeVer()).ok; } catch (e2) { /* unreachable */ }
        S.error = reachable
          ? 'The web app is connected but could not open the sheets. In Apps Script, signed in as the account the web app runs as (Deploy → Manage deployments shows it), run setup once and approve the permissions, then click Refresh.'
          : 'This browser could not reach the web app. Check your connection, turn off ad or privacy blockers for this page (or try a private window) and click Refresh.';
      }
      if (S.status !== 'ok') S.status = 'error';
      else S.staleError = S.error;
    }
    S.refreshing = false; S.cached = false;
    renderAll();
  }
  // Turn a data response (live, or the copy saved on this device) into the dashboard's tasks and team.
  function applyData(body) {
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
  }
  /* Data saved on this device (IndexedDB, per signed-in person) so the dashboard draws instantly on the next visit while
     the live data loads. Cleared on sign-out and when access ends. */
  const DC = (() => {
    const db = () => new Promise((res, rej) => { try { const r = indexedDB.open('co-data', 1); r.onupgradeneeded = () => r.result.createObjectStore('d'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
    const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('d', mode); const out = fn(t.objectStore('d')); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); }); };
    return {
      put: (email, body) => tx('readwrite', (st) => st.put({ body, at: Date.now() }, email)).catch(() => {}),
      get: async (email) => { try { const d = await db(); return await new Promise((res) => { const r = d.transaction('d').objectStore('d').get(email); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); } catch (e) { return null; } },
      clear: () => tx('readwrite', (st) => st.clear()).catch(() => {})
    };
  })();
  // The secondary calls (notes, history, feed, settings, meetings) wait until the data has arrived, so they never slow it down.
  let firstDone = false;
  function afterFirstData() {
    if (firstDone || A.mode !== 'auth' || !A.user) return; firstDone = true;
    setTimeout(() => { NB.load(); loadHistory(); loadFeed(true); loadSettings(); dash.draw('cal'); checkForChanges(); }, 50);
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
      if (A.mode === 'auth' && body.ok) {
        S.verBody = body; dash.draw('syscheck');
        PRS.on = body.presenceOn !== false;
        if (body.remind) { const hm = (t) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; }; const a = hm(body.remind.morning), b = hm(body.remind.evening); if (a != null) REMIND_AT.morning = a; if (b != null) REMIND_AT.evening = b; REMIND_AT.label = body.remind; }
        if (body.presence) { PRS.list = body.presence; dash.draw('presence-mini'); dash.draw('presence'); }
        if (body.assist) ASH.setStatus(body.assist);
      }
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
    // "Today" is the date in India (IST), wherever the dashboard is opened.
    const istParts = (d) => { const o = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d || new Date()).forEach((p) => { o[p.type] = p.value; }); return o; };
    const today = () => { const o = istParts(); return o.year + '-' + o.month + '-' + o.day; };
    const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return isoOf(d); };
    const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const fmtDate = (s, withYear) => { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return d + ' ' + MON[m - 1] + (withYear || y !== Number(today().slice(0, 4)) ? ' ' + y : ''); };
    const thisMonth = () => today().slice(0, 7);
    const prevMonth = (k) => { const [y, m] = k.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + pad(m - 1); };
    const fmtMonth = (k, long) => { if (!k) return '—'; const [y, m] = k.split('-').map(Number); return (long ? MONTHS[m - 1] : MON[m - 1]) + ' ' + y; };
    const monthStart = (k) => k + '-01';
    /* Working days: Monday to Friday. Saturdays and Sundays are never counted (no holiday calendar),
       so a month has 20 to 23 working days, usually 21 or 22. Used for every rate and every comparison of a period that is still running. */
    const isWorkday = (iso) => { const g = toDate(iso).getDay(); return g !== 0 && g !== 6; };
    const wdMemo = new Map();
    const workdays = (f, t) => {
      if (!f || !t || t < f) return 0; const k = f + t; if (wdMemo.has(k)) return wdMemo.get(k);
      const a = toDate(f), b = toDate(t); const days = Math.round((b - a) / 864e5) + 1, full = Math.floor(days / 7); let n = full * 5;
      for (let i = full * 7; i < days; i++) { const g = (a.getDay() + i) % 7; if (g !== 0 && g !== 6) n++; }
      wdMemo.set(k, n); return n;
    };
    const nthWorkday = (start, n, cap) => { let d = start, c = 0; while (d <= cap) { if (isWorkday(d)) { c++; if (c === n) return d; } d = addDays(d, 1); } return null; };
    // End of the window in an earlier period that has as many working days as have passed in the current one
    // (e.g. 1–10 Nov 2026 has 7 working days, so October is counted to its 7th working day, 9 Oct).
    const sameWorkdaysEnd = (curFrom, curTo, prevFrom, prevEnd) => {
      const n = workdays(curFrom, curTo); if (!n) return addDays(prevFrom, -1);
      if (isWorkday(curTo)) return nthWorkday(prevFrom, n, prevEnd) || prevEnd;
      const nx = nthWorkday(prevFrom, n + 1, prevEnd); return nx ? addDays(nx, -1) : prevEnd;
    };
    const monthEnd = (k) => { const [y, m] = k.split('-').map(Number); return isoOf(new Date(y, m, 0)); };
    const addMonths = (k, n) => { const [y, m] = k.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
    // Indian number format: 1,00,000 and 12,34,567. inr() for money: ₹1,25,000, or ₹2.4 L / ₹1.2 Cr when compact.
    const INNUM = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
    const num = (n) => INNUM.format(Math.round(n));
    const inr = (n, compact) => {
      if (n == null || isNaN(n)) return '—';
      if (compact && Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + ' Cr';
      if (compact && Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '') + ' L';
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
    };
    const istHour = () => Number(istParts().hour);
    const istTime = (d) => new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
    const istDateTime = (d, withYear) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: withYear ? 'numeric' : undefined, hour: 'numeric', minute: '2-digit' });
    const sumQty = (rs) => rs.reduce((a, r) => a + (r.qty || 1), 0);
    const CLOSED = new Set(['Delivered', 'Deprioritised']);
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
    // rows(): tasks with the page filters applied. rows(true): every task (briefings and reminders ignore filters).
    const rows = (unfiltered) => {
      const a = all(); if (!a) return null;
      const p = unfiltered ? { src: '', designer: '', brand: '', type: '' } : dash.params(), tm = team();
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
        case 'wip': return r.stage === 'WIP';
        case 'changes': return r.stage === 'Changes requested';
        case 'overdue': case 'today': case 'week': case 'noeta': return r.due === s;
        case 'review': return r.stage === 'Pending approval';
        case 'awaiting': return r.stage === 'Incomplete brief';
        case 'hold': return r.stage === 'Hold';
        case 'delivered': return r.stage === 'Delivered';
        case 'delivered-month': return r.stage === 'Delivered' && r.month === thisMonth();
        case 'delivered-range': return r.stage === 'Delivered' && r.ddate && r.ddate >= ctx.from && r.ddate <= ctx.to;
        case 'dropped': return r.stage === 'Deprioritised';
        default: return true;
      }
    };
    const stageColor = (s) => ({ 'WIP': 'var(--st-wip)', 'Pending approval': 'var(--st-review)', 'To be planned': 'var(--st-plan)', 'Incomplete brief': 'var(--st-await)', 'Hold': 'var(--st-hold)', 'Changes requested': 'var(--warn)', 'Delivered': 'var(--ok)' })[s];
    // plain: the row already shows how late it is (a "when" badge), so the chip shows only the status.
    const chip = (r, plain) => {
      const el = document.createElement('span');
      let cls = 's-mute', txt = r.stage;
      if (r.due === 'overdue') { cls = 's-bad'; if (!plain) txt = r.stage + ' · late'; }
      else if (r.due === 'today') { cls = 's-warn'; if (!plain) txt = r.stage + ' · today'; }
      else if (r.stage === 'Changes requested') cls = 's-warn';
      else if (r.stage === 'Delivered') cls = 's-ok';
      else if (stageColor(r.stage)) { cls = ''; el.style.color = stageColor(r.stage); }
      // Extra detail agreed with the Creative Head: why something counts as delivered, and how long a client has had it.
      if (!plain && r.sub && r.due !== 'overdue') { txt += ' · ' + (r.sub === 'Rejected by client' ? 'rejected' : r.sub === 'No client update' ? 'no client update' : 'content WIP'); if (r.sub === 'Rejected by client') cls = 's-warn'; }
      if (!plain && r.stage === 'Pending approval' && r.eta && r.eta < today()) { const d = diffDays(r.eta, today()); txt += ' · ' + d + 'd'; el.title = 'With the client since about ' + fmtDate(r.eta) + ' (design ETA)'; }
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
    /* Classification (display only; the sheets keep their own names): the Paid (client) sheet is External, the Marketing team sheet is Internal. */
    const cls = (r) => ((r && r.source) || r) === 'Paid' ? 'External' : 'Internal';
    const srcTag = (r) => { const s = document.createElement('span'); const c = cls(r); s.className = 'src ' + (c === 'External' ? 'ext' : 'int'); s.textContent = c; s.title = c === 'External' ? 'External: client work (Paid sheet)' : 'Internal: marketing team work'; return s; };
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
    /*
     * Direction-aware change colours, used everywhere a number is compared with an earlier one.
     * better: 'up' (more is better: deliveries), 'down' (less is better: overdue, unassigned), 'none' (neutral).
     * Green = improvement, red = worse; the shade deepens with the size of the change (full strength at ±50%).
     */
    const tone = (diff, base, better) => {
      if (!diff || better === 'none') return null;
      const good = better === 'down' ? diff < 0 : diff > 0;
      const pct = base ? Math.abs(diff) / Math.abs(base) : 1;
      return { good, k: Math.min(1, pct / 0.5), pct };
    };
    const toneInk = (t) => (t ? 'color-mix(in srgb, var(' + (t.good ? '--good' : '--worse') + ') ' + Math.round(55 + t.k * 45) + '%, var(--muted))' : '');
    const toneWash = (t) => (t ? 'color-mix(in srgb, var(' + (t.good ? '--good' : '--worse') + ') ' + Math.round(9 + t.k * 21) + '%, transparent)' : '');
    const toneFill = (t, rest) => (t ? 'color-mix(in srgb, var(' + (t.good ? '--good-fill' : '--worse-fill') + ') ' + Math.round(45 + t.k * 55) + '%, ' + (rest || 'var(--chart-muted)') + ')' : (rest || 'var(--chart-muted)'));
    const pctText = (d, prev) => (prev ? ' (' + (d >= 0 ? '+' : '−') + Math.round(Math.abs(d) / prev * 100) + '%)' : '');
    const delta = (cur, prev, better) => {
      const d = cur - prev, t = tone(d, prev, better || 'up'), s = document.createElement('span');
      s.className = 'dl' + (t ? (t.good ? ' good' : ' worse') : ' flat');
      s.textContent = (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + sign(d) + pctText(d, prev);
      if (t) { s.style.color = toneInk(t); s.style.background = toneWash(t); }
      s.title = !d ? 'No change' : (t ? (t.good ? 'Better' : 'Worse') : 'Change') + ': ' + num(prev) + ' → ' + num(cur);
      return s;
    };
    const period = () => {
      const p = dash.params(), t = today(), m = thisMonth();
      const preset = p.rpreset || 'this-month';
      const qStart = (k) => { const [y, mm] = k.split('-').map(Number); return y + '-' + pad(Math.floor((mm - 1) / 3) * 3 + 1); };
      let from, to, pfrom = null, pto = null;
      const prevSpan = (startK, months, partial) => {
        const ps = addMonths(startK, -months);
        pfrom = monthStart(ps);
        if (partial) pto = sameWorkdaysEnd(from, to, pfrom, monthEnd(addMonths(startK, -1)));
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
      else if (preset === 'ytd') { from = t.slice(0, 4) + '-01-01'; to = t; pfrom = (Number(t.slice(0, 4)) - 1) + '-01-01'; pto = sameWorkdaysEnd(from, to, pfrom, (Number(t.slice(0, 4)) - 1) + '-12-31'); }
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
    return { today, addDays, diffDays, fmtDate, fmtMonth, thisMonth, prevMonth, monthEnd, addMonths, num, sumQty, CLOSED, VIDEO, team, member, isActive, canon, all, rows, status, stageMatch, stageColor, chip, td, links, topic, topicText, srcTag, cls, emptyRow, isWorkday, workdays, nthWorkday, sameWorkdaysEnd, notReady, goTasks, typeColors, topTypes, typeOf, tip, placeTip, sign, delta, period, label, csv, av, who, task, initials, inr, istHour, istTime, istDateTime, istParts, tone, toneInk, toneWash, toneFill, pctText };
  })();

  /* ================= Controls ================= */
  let shownTab = null;
  // The loading screen stays until the FASTRR reveal has landed (or 2.5 s at most), then fades.
  const bootLanded = new Promise((res) => { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return res(); setTimeout(res, Math.max(0, 950 - performance.now())); });
  const hideBoot = () => { const b = document.getElementById('boot'); if (!b || b.dataset.leaving) return; b.dataset.leaving = '1'; bootLanded.then(() => { b.classList.add('done'); setTimeout(() => b.remove(), 500); }); };
  function syncControls() {
    const p = dash.params();
    const admin = A.mode === 'auth' && can('Admin');
    document.body.dataset.admin = admin ? '1' : '';
    const axTab = document.querySelector('.co-tab[data-tab="access"]');
    axTab.hidden = !admin;
    const badge = axTab.querySelector('.nav-badge'); badge.hidden = !AX.pending; badge.textContent = AX.pending ? AX.pending + ' waiting' : '';
    document.querySelector('.bt-dot').hidden = !(admin && AX.pending);
    const signed = A.mode === 'auth' && !!A.user;
    const bell = document.getElementById('btn-bell'); bell.hidden = !signed;
    const unread = NT.unread(); bell.querySelector('.bell-dot').hidden = !unread;
    bell.title = unread ? unread + ' new notification' + (unread === 1 ? '' : 's') : 'Notifications'; bell.setAttribute('aria-label', bell.title);
    document.querySelector('.co-tab[data-tab="notes"]').hidden = !signed;
    document.querySelector('.bt[data-tab="notes"]').hidden = !signed;
    document.querySelector('.btabs').classList.toggle('four', !signed);
    document.body.classList.toggle('syncing', !!S.refreshing || S.status === 'loading');
    document.getElementById('add-member').hidden = !can('Admin');
    const tab = TABS.includes(p.tab) && (p.tab !== 'access' || admin) && (p.tab !== 'notes' || signed) ? p.tab : 'today';
    document.querySelectorAll('[data-panel]').forEach((s) => {
      const show = s.dataset.panel === tab;
      // A short entrance when the page changes (not on every refresh).
      if (show && s.hidden && shownTab !== tab) { s.classList.remove('enter'); void s.offsetWidth; s.classList.add('enter'); s.addEventListener('animationend', () => s.classList.remove('enter'), { once: true }); }
      s.hidden = !show;
    });
    shownTab = tab;
    if (tab === 'notes') NB.open();
    document.querySelectorAll('.co-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.bt[data-tab]').forEach((b) => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    document.getElementById('bt-more').toggleAttribute('aria-current', !['today', 'standup', 'tasks', 'notes'].includes(tab));
    document.getElementById('filter-bar').hidden = tab === 'access' || tab === 'notes';
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
    if (S.status === 'ok' || S.status === 'error' || S.status === 'unconfigured') hideBoot();
    document.getElementById('btn-connect').hidden = A.mode === 'auth';
  }
  document.querySelectorAll('.co-tab, .bt[data-tab]').forEach((b) => b.addEventListener('click', () => dash.setParams({ tab: b.dataset.tab })));
  /* Navigation drawer (phones and narrow windows) */
  function closeNav() { document.body.classList.remove('nav-open'); document.getElementById('scrim').hidden = true; document.getElementById('btn-menu').setAttribute('aria-expanded', 'false'); }
  function openNav() { document.body.classList.add('nav-open'); document.getElementById('scrim').hidden = false; document.getElementById('btn-menu').setAttribute('aria-expanded', 'true'); }
  document.getElementById('btn-menu').addEventListener('click', openNav);
  document.getElementById('btn-bell').addEventListener('click', (e) => { e.stopPropagation(); NT.toggle(); });
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
  const themeLabel = () => { const root = document.documentElement; const dark = root.dataset.theme === 'dark'; const manual = !!LS.get('co.themeUntil', ''); const b = document.getElementById('btn-theme'); b.setAttribute('aria-label', (dark ? 'Switch to the Day theme' : 'Switch to the Night theme') + (manual ? ' (your choice, until the light changes)' : ' (automatic: Day after sunrise, Night after sunset)')); b.title = b.getAttribute('aria-label'); };
  /* Smooth theme change: a soft circular reveal from the clock (View Transitions), or a quick colour cross-fade. */
  function applyTheme(next, origin) {
    const root = document.documentElement; if (root.dataset.theme === next) return;
    const swap = () => { root.dataset.theme = next; themeLabel(); renderAll(); document.dispatchEvent(new Event('co-theme')); };
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && document.startViewTransition && origin) {
      const r = origin.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      root.style.setProperty('--vt-x', x + 'px'); root.style.setProperty('--vt-y', y + 'px'); root.style.setProperty('--vt-r', rad + 'px');
      document.startViewTransition(swap);
    } else { root.classList.add('theme-fade'); swap(); setTimeout(() => root.classList.remove('theme-fade'), 700); }
  }
  // Follow sunrise and sunset automatically (checked every minute) unless someone chose a theme for now.
  setInterval(() => { const until = +LS.get('co.themeUntil', '0'); if (until && Date.now() > until) { LS.set('co.themeUntil', null); LS.set('co.theme', null); } if (!LS.get('co.themeUntil', '')) applyTheme(window.COTHEME ? COTHEME.autoTheme() : document.documentElement.dataset.theme, document.getElementById('clock')); }, 60 * 1000);
  themeLabel();
  document.getElementById('btn-refresh').addEventListener('click', () => (A.mode ? load(true) : start()));
  document.getElementById('btn-theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    // A manual choice lasts until the next sunrise or sunset; choosing the automatic theme again clears it.
    if (window.COTHEME && next === COTHEME.autoTheme()) { LS.set('co.theme', null); LS.set('co.themeUntil', null); } else { LS.set('co.theme', next); LS.set('co.themeUntil', String(window.COTHEME ? COTHEME.nextChange() : Date.now() + 6 * 3600e3)); }
    applyTheme(next, document.getElementById('btn-theme'));
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
  function toast(text, bad, action) {
    let t = document.querySelector('.co-toast');
    if (!t) { t = document.createElement('div'); t.className = 'co-toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.replaceChildren(text); t.classList.toggle('bad', !!bad); t.hidden = false;
    if (action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'co-toast-act'; b.textContent = action.label; b.addEventListener('click', () => { t.hidden = true; action.fn(); }); t.append(b); }
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; if (action && action.onTimeout) action.onTimeout(); }, action ? 5000 : 4000);
  }

  /* ================= Header, sync state and filters ================= */
  const PAGES = {
    today: ['Overview', () => 'What needs attention today.'],
    notes: ['Notes', 'Meeting minutes, discussions, action items and personal notes.'],
    standup: ['Daily stand-up', 'One card per active designer: what is late, due today, in progress and up next.'],
    tasks: ['Tasks', 'Every task from both sheets. Click a row to open or edit it.'],
    team: ['Team', 'Workload, output and who is on the team.'],
    reports: ['Delivery reports', 'Creatives delivered by month, brand, designer and creative type.'],
    health: ['Data health', 'Rows that make tracking less reliable, and the connection to the sheets.'],
    access: ['Access & activity', 'Who can use the dashboard, and every change they made.']
  };
  const curTab = () => { const t = dash.params().tab; return PAGES[t] && (t !== 'access' || (A.mode === 'auth' && can('Admin'))) && (t !== 'notes' || (A.mode === 'auth' && A.user)) ? t : 'today'; };
  const greeting = () => { const h = CO.istHour(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  const firstName = () => (A.user && A.user.name ? A.user.name.split(' ')[0] : '');
  dash.draw('page-title', (el) => { const t = curTab(); el.textContent = t === 'today' && firstName() ? greeting() + ', ' + firstName() : PAGES[t][0]; });
  // Workspace label lives in the header (not beside the logo): "Creative Ops · Team tracker / <page>".
  dash.draw('page-eyebrow', (el) => {
    const t = curTab(); el.replaceChildren();
    const chip = document.createElement('span'); chip.className = 'ws-chip'; const dot = document.createElement('i'); const sm = document.createElement('small'); sm.textContent = 'Team tracker'; chip.append(dot, 'Creative Ops', sm);
    el.append(chip);
    if (t === 'today' && firstName()) { const sep = document.createElement('span'); sep.className = 'ws-sep'; sep.textContent = '/'; const pg = document.createElement('span'); pg.className = 'ws-page'; pg.textContent = 'Overview'; el.append(sep, pg); }
  });
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
  dash.draw('today-date', (el) => { el.textContent = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); });
  dash.draw('sync-dot', (el) => { el.className = 'co-sync-dot ' + (S.status === 'ok' ? (S.staleError ? 'warn' : 'ok') : S.status === 'error' ? 'bad' : S.status === 'loading' ? 'busy' : ''); });
  dash.draw('sync-text', (el) => {
    if (S.status === 'ok') {
      const at = new Date(S.generatedAt || S.loadedAt);
      const live = S.ver && S.ver !== '0';
      const ago = S.checkedAt || S.loadedAt ? Math.max(0, Math.round((Date.now() - (S.checkedAt > S.loadedAt ? S.checkedAt : S.loadedAt)) / 1000)) : null;
      el.textContent = (S.cached ? 'Saved copy · updating… ' : S.refreshing ? 'Syncing… ' : live ? 'Live · ' : '') + 'data from ' + CO.istTime(at) + (ago != null && !S.refreshing ? ' · checked ' + (ago < 5 ? 'just now' : ago + 's ago') : '') + (S.staleError ? ' · last refresh failed' : '');
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
      : key === 'wip' ? rs.filter((r) => r.stage === 'WIP').length
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
    wip: (rs) => rs.filter((r) => r.stage === 'WIP'),
    overdue: (rs) => rs.filter((r) => r.due === 'overdue'),
    today: (rs) => rs.filter((r) => r.due === 'today'),
    review: (rs) => rs.filter((r) => r.stage === 'Pending approval'),
    delivered: (rs) => rs.filter((r) => r.stage === 'Delivered' && r.month === CO.thisMonth())
  };
  /* Numbers count up to their new value when they change. */
  const countTo = (el, n) => {
    const from = el.__n == null ? 0 : el.__n; el.__n = n;
    if (REDUCED || from === n) { el.textContent = CO.num(n); return; }
    const t0 = performance.now(), dur = 700;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = CO.num(from + (n - from) * ease(k)); if (k < 1 && el.__n === n) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  dash.draw('kpi', (el) => {
    if (CO.notReady(el, 'text')) { el.__n = null; return; }
    const list = tiles[el.dataset.kpi](CO.rows());
    countTo(el, el.dataset.kpi === 'delivered' ? CO.sumQty(list) : list.length);
  });
  dash.draw('kpi-sub', (el) => {
    if (CO.notReady(el, 'text')) return;
    const rs = CO.rows(), k = el.dataset.kpi, list = tiles[k](rs);
    el.replaceChildren();
    // Point-in-time numbers compare with the daily snapshot (about a week back) the web app keeps: fewer is better.
    const hist = (key) => {
      const p = dash.params(); if (p.src || p.designer || p.brand || p.type) return null;
      const t = CO.today(), want = CO.addDays(t, -7);
      const past = (HS.days || []).filter((d) => d.date < t && d[key] != null).sort((a, b) => (Math.abs(CO.diffDays(a.date, want)) - Math.abs(CO.diffDays(b.date, want))));
      return past[0] || null;
    };
    const cmp = (now, key, better) => { const h = hist(key); if (!h) return; const line = document.createElement('span'); line.className = 'kpi-cmp'; line.append(CO.delta(now, h[key], better), ' vs ' + CO.fmtDate(h.date)); el.append(document.createElement('br'), line); };
    if (k === 'open') { const n = rs.filter((r) => r.due === 'noeta').length; el.textContent = CO.num(CO.sumQty(list)) + ' creatives' + (n ? ' · ' + n + ' without ETA' : ''); cmp(list.length, 'open', 'down'); }
    else if (k === 'wip') { el.textContent = rs.filter((r) => r.stage === 'To be planned').length + ' to be planned (TBP)'; }
    else if (k === 'overdue') { if (!list.length) el.textContent = 'Nothing late'; else { const worst = Math.max(...list.map((r) => CO.diffDays(r.eta, CO.today()))); el.textContent = 'Oldest ' + worst + (worst === 1 ? ' day' : ' days') + ' late'; } cmp(list.length, 'overdue', 'down'); }
    else if (k === 'today') { el.textContent = rs.filter((r) => r.due === 'week').length + ' more in the next 7 days'; }
    else if (k === 'review') { el.textContent = rs.filter((r) => r.stage === 'Incomplete brief').length + ' with an incomplete brief'; cmp(list.length, 'review', 'none'); }
    else if (k === 'delivered') {
      const m = CO.thisMonth(), pm = CO.prevMonth(m), pto = CO.sameWorkdaysEnd(m + '-01', CO.today(), pm + '-01', CO.monthEnd(pm));
      const prevSame = CO.sumQty(rs.filter((r) => r.stage === 'Delivered' && r.ddate && r.ddate >= pm + '-01' && r.ddate <= pto));
      const wd = CO.workdays(m + '-01', CO.today());
      el.append(CO.delta(CO.sumQty(list), prevSame, 'up'), ' vs the first ' + wd + ' working days of ' + CO.fmtMonth(pm).split(' ')[0]);
      el.title = 'Working days are Monday to Friday. ' + wd + ' have passed this month; ' + CO.fmtMonth(pm, true) + ' is counted from the 1st to ' + CO.fmtDate(pto) + ', its ' + wd + 'th working day.';
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
  /* Needs attention: a composition bar and filter chips (all, overdue, due today, tomorrow, changes requested),
     then one compact row per task with a severity rail, the designer and how late or soon it is. */
  const NA = { f: LS.get('co.naf', 'all'), all: false };
  dash.draw('attn', (el) => {
    if (CO.notReady(el, 'box')) return;
    const t = CO.today(), tm = CO.addDays(t, 1);
    const cat = (r) => r.due === 'overdue' ? 'late' : r.due === 'today' ? 'today' : (r.open && r.eta === tm) ? 'tomorrow' : 'changes';
    const rows = CO.rows().filter((r) => r.due === 'overdue' || r.due === 'today' || (r.open && r.eta === tm) || r.stage === 'Changes requested')
      .sort((a, b) => (a.eta || '9999').localeCompare(b.eta || '9999') || (a.priority || 'P9').localeCompare(b.priority || 'P9'));
    const F = [['all', 'All', () => true], ['late', 'Overdue', (r) => r.due === 'overdue'], ['today', 'Today', (r) => r.due === 'today'], ['tomorrow', 'Tomorrow', (r) => r.open && r.eta === tm], ['changes', 'Changes', (r) => r.stage === 'Changes requested']];
    if (!F.some((f) => f[0] === NA.f)) NA.f = 'all';
    const prevF = el._f; el._f = NA.f; const animate = prevF !== NA.f || !el._drawn; el._drawn = true;
    el.replaceChildren();
    const head = document.createElement('div'); head.className = 'na-head';
    const hl = document.createElement('div'); const h2 = document.createElement('h2'); h2.className = 'co-h2'; h2.textContent = 'Needs attention'; const cnt = document.createElement('span'); cnt.className = 'na-count' + (rows.length ? '' : ' ok'); cnt.textContent = rows.length; h2.append(cnt);
    const note = document.createElement('p'); note.className = 'co-note'; note.textContent = rows.length ? 'Oldest deadline first. Click a task to open it.' : 'Nothing overdue, due soon or waiting on changes.'; hl.append(h2, note);
    const go = document.createElement('button'); go.type = 'button'; go.className = 'co-link'; go.textContent = 'All overdue'; go.dataset.goTasks = 'overdue'; go.addEventListener('click', () => CO.goTasks('overdue'));
    head.append(hl, go); el.append(head);
    if (!rows.length) { const ok = document.createElement('div'); ok.className = 'na-clear'; ok.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>'; const p = document.createElement('p'); p.textContent = 'The team is on schedule.'; ok.append(p); el.append(ok); return; }
    // composition bar (each task counted once, by its most urgent reason)
    const comp = { late: 0, today: 0, tomorrow: 0, changes: 0 }; rows.forEach((r) => comp[cat(r)]++);
    const bar = document.createElement('div'); bar.className = 'na-bar'; bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', Object.entries(comp).filter((x) => x[1]).map(([k, v]) => v + ' ' + k).join(', '));
    Object.entries(comp).forEach(([k, v]) => { if (!v) return; const seg = document.createElement('i'); seg.className = 'k-' + k; seg.style.flexGrow = '0'; seg.title = v + ' ' + ({ late: 'overdue', today: 'due today', tomorrow: 'due tomorrow', changes: 'changes requested' })[k]; bar.append(seg); requestAnimationFrame(() => requestAnimationFrame(() => { seg.style.flexGrow = String(v); })); });
    if (!animate) bar.querySelectorAll('i').forEach((i) => { i.style.transition = 'none'; });
    el.append(bar);
    // filter chips
    const chips = document.createElement('div'); chips.className = 'na-chips'; chips.setAttribute('role', 'tablist'); chips.setAttribute('aria-label', 'Filter');
    F.forEach(([k, l, fn]) => {
      const c = rows.filter(fn).length; if (k !== 'all' && !c) return;
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.className = 'na-chip k-' + k; b.setAttribute('aria-selected', String(NA.f === k));
      const i = document.createElement('i'); const n = document.createElement('b'); n.textContent = c; b.append(i, l, n);
      b.addEventListener('click', () => { NA.f = k; NA.all = false; LS.set('co.naf', k); dash.draw('attn'); });
      chips.append(b);
    });
    el.append(chips);
    const fn = (F.find((f) => f[0] === NA.f) || F[0])[2];
    const list = rows.filter(fn), LIM = 12;
    const ul = document.createElement('ul'); ul.className = 'na-list';
    (NA.all ? list : list.slice(0, LIM)).forEach((r, i) => {
      const k = cat(r), li = document.createElement('li'); li.className = 'na-row k-' + k + (animate ? ' in' : ''); li.style.setProperty('--i', Math.min(i, 12)); li.dataset.uid = r.uid; li.tabIndex = 0;
      const rail = document.createElement('i'); rail.className = 'na-rail';
      const main = document.createElement('div'); main.className = 'na-main';
      const t1 = document.createElement('span'); t1.className = 'na-t'; const bb = document.createElement('b'); bb.textContent = r.brand; t1.append(bb, ' ' + CO.topicText(r)); t1.title = r.brand + ' · ' + CO.topicText(r);
      const m = document.createElement('span'); m.className = 'na-m';
      const id = document.createElement('span'); id.className = 'co-id'; id.textContent = r.id || 'no ID';
      const st = document.createElement('span'); st.className = 'na-st' + (r.stage === 'Changes requested' ? ' ch' : ''); st.textContent = r.stage;
      m.append(id, r.type + (r.qty > 1 ? ' ×' + r.qty : ''), CO.srcTag(r), st);
      if (/^P[01]$/.test(r.priority || '')) { const p = document.createElement('span'); p.className = 'pri'; p.textContent = r.priority; m.append(p); }
      main.append(t1, m);
      const who = document.createElement('span'); who.className = 'na-who'; const nm = r.list.length ? r.list : ['Unassigned'];
      nm.slice(0, 2).forEach((x) => who.append(CO.av(x))); who.title = r.list.join(', ') || 'Unassigned';
      const wn = document.createElement('span'); wn.className = 'na-wn'; wn.textContent = r.list.length ? r.list[0].split(' ')[0] + (r.list.length > 1 ? ' +' + (r.list.length - 1) : '') : 'Unassigned'; who.append(wn);
      const d = r.eta ? CO.diffDays(t, r.eta) : null;
      const when = document.createElement('span'); when.className = 'na-when k-' + k; when.textContent = d == null ? 'No ETA' : d < 0 ? (-d) + 'd late' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : CO.fmtDate(r.eta); when.title = r.eta ? 'Design ETA ' + CO.fmtDate(r.eta, true) : 'No Design ETA';
      const lk = CO.links(r); lk.classList.add('na-links'); if (lk.textContent === '—') lk.hidden = true;
      li.append(rail, main, lk, who, when); ul.append(li);
    });
    el.append(ul);
    if (list.length > LIM) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'na-more'; more.textContent = NA.all ? 'Show fewer' : 'Show all ' + list.length;
      more.addEventListener('click', () => { NA.all = !NA.all; dash.draw('attn'); }); const li = document.createElement('li'); li.className = 'na-more-li'; li.append(more); ul.append(li);
    }
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
    el.textContent = n ? n + ' open with no ETA' : '';
  });
  /* Overview: work nobody has picked up yet. */
  dash.draw('unassigned', (el) => {
    if (CO.notReady(el, 'box')) return;
    el.replaceChildren();
    const open = CO.rows().filter((r) => r.open && !r.list.length);
    el.classList.toggle('accent-bad', open.length > 0); el.classList.toggle('accent-ok', !open.length);
    const head = document.createElement('div'); head.className = 'co-card-head';
    const hd = document.createElement('div'); const h = document.createElement('h2'); h.className = 'co-h2'; h.textContent = 'Unassigned'; const n = document.createElement('p'); n.className = 'co-note'; n.textContent = 'Open tasks with no designer yet.'; hd.append(h, n); head.append(hd);
    if (open.length) { const go = document.createElement('button'); go.type = 'button'; go.className = 'co-link'; go.textContent = 'Open queue'; go.addEventListener('click', () => CO.goTasks('open', { designer: '__none' })); head.append(go); }
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
    openRows.forEach((r) => { r.list.forEach((d) => { if (EF.hidden(d)) return; const o = m.get(d) || { key: d, name: CO.isActive(d) ? d : d + ' (inactive, reassign)', overdue: 0, week: 0, later: 0 }; const q = r.qty || 1; if (r.due === 'overdue') o.overdue += q; else if (r.due === 'today' || r.due === 'week') o.week += q; else o.later += q; m.set(d, o); }); });
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
    g.classed('mk', true).on('mouseenter.dim', function () { el.classList.add('hovering'); d3.select(this).classed('on', true); }).on('mouseleave.dim', function () { el.classList.remove('hovering'); d3.select(this).classed('on', false); });
    if (freshSig(el, JSON.stringify(data.map((d) => [d.key, d.overdue, d.week, d.later])))) {
      g.selectAll('rect:not(.hit)').each(function () { const r = d3.select(this), w = +r.attr('width'), x0 = +r.attr('x'); r.attr('width', 0).attr('x', L).transition().duration(700).delay((d, i) => i * 40).ease(ease).attr('x', x0).attr('width', w); });
    }
  });
  dash.draw('pipeline', (el) => {
    if (CO.notReady(el, 'box')) return;
    const rs = CO.rows().filter((r) => !CO.CLOSED.has(r.stage));
    const base = [['To be planned', 'tbp'], ['WIP', 'wip'], ['Changes requested', 'changes'], ['Pending approval', 'review'], ['Incomplete brief', 'awaiting'], ['Hold', 'hold']];
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


  /* ================= Time buckets for every time-based graph =================
     Each graph has its own Day / Week / Month / Quarter / Year / Custom control (remembered per browser).
     A bucket is keyed by its first day (ISO). Weeks run Monday to Sunday, quarters are calendar quarters, all in IST. */
  const weekStart = (iso) => { const d = new Date(iso + 'T00:00:00'); const k = (d.getDay() + 6) % 7; return CO.addDays(iso, -k); };
  const TB = (() => {
    const G = { day: { label: 'Day', noun: 'working day', n: 22 }, week: { label: 'Week', noun: 'week', n: 12 }, month: { label: 'Month', noun: 'month', n: 12 }, quarter: { label: 'Quarter', noun: 'quarter', n: 8 }, year: { label: 'Year', noun: 'year', n: 5 } };
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const key = (iso, g) => {
      // Day buckets are working days; anything dated on a Saturday or Sunday counts on the Friday before.
      if (g === 'day') { const w = new Date(iso + 'T00:00:00').getDay(); return w === 6 ? CO.addDays(iso, -1) : w === 0 ? CO.addDays(iso, -2) : iso; } if (g === 'week') return weekStart(iso);
      const y = iso.slice(0, 4), m = Number(iso.slice(5, 7));
      if (g === 'month') return iso.slice(0, 7) + '-01';
      if (g === 'quarter') return y + '-' + String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0') + '-01';
      return y + '-01-01';
    };
    const next = (k, g) => g === 'day' ? CO.addDays(k, new Date(k + 'T00:00:00').getDay() === 5 ? 3 : 1) : g === 'week' ? CO.addDays(k, 7) : CO.addMonths(k.slice(0, 7), g === 'month' ? 1 : g === 'quarter' ? 3 : 12) + '-01';
    const prev = (k, g) => g === 'day' ? CO.addDays(k, new Date(k + 'T00:00:00').getDay() === 1 ? -3 : -1) : g === 'week' ? CO.addDays(k, -7) : CO.addMonths(k.slice(0, 7), g === 'month' ? -1 : g === 'quarter' ? -3 : -12) + '-01';
    const end = (k, g) => CO.addDays(next(k, g), -1);
    const label = (k, g, long) => {
      const [y, m, d] = k.split('-').map(Number), yy = "'" + String(y).slice(2);
      if (g === 'day' || g === 'week') return (g === 'week' && long ? 'Week of ' : '') + d + ' ' + MON[m - 1] + (long ? ' ' + y : '');
      if (g === 'month') return long ? CO.fmtMonth(k.slice(0, 7), true) : MON[m - 1] + ' ' + yy;
      if (g === 'quarter') return 'Q' + ((m - 1) / 3 + 1) + (long ? ' ' + y : ' ' + yy);
      return String(y);
    };
    const curName = { day: 'Today', week: 'This week', month: 'This month', quarter: 'This quarter', year: 'This year' };
    const lastName = { day: 'the last working day', week: 'last week', month: 'last month', quarter: 'last quarter', year: 'last year' };
    const LS = (name) => 'co.gr.' + name;
    const state = (name, def) => { let s = null; try { s = JSON.parse(localStorage.getItem(LS(name)) || 'null'); } catch (e) { /* private mode */ } s = s && (G[s.g] || s.g === 'custom') ? s : { g: def }; s.def = def; return s; };
    const ST = {};
    const get = (name, def) => (ST[name] = ST[name] || state(name, def));
    const save = (name) => { try { localStorage.setItem(LS(name), JSON.stringify({ g: ST[name].g, from: ST[name].from, to: ST[name].to })); } catch (e) { /* ignore */ } };
    // For custom ranges, the grain follows the span: up to 45 days by day, 26 weeks by week, 3 years by month, else by quarter.
    const grainOf = (s) => {
      if (s.g !== 'custom') return s.g;
      const days = CO.diffDays(s.from, s.to) + 1;
      return days <= 45 ? 'day' : days <= 26 * 7 ? 'week' : days <= 3 * 366 ? 'month' : 'quarter';
    };
    const valid = (s) => s.g !== 'custom' || (s.from && s.to && s.from <= s.to);
    // Buckets to draw: the last N ending with the current one, or every bucket of a custom range.
    const buckets = (s, n) => {
      const g = grainOf(s), out = [];
      if (s.g === 'custom' && valid(s)) { for (let k = key(s.from, g); k <= s.to && out.length < 400; k = next(k, g)) out.push(k); return { g, keys: out, from: s.from, to: s.to < CO.today() ? s.to : CO.today() }; }
      let k = key(CO.today(), g); for (let i = 0; i < (n || G[g].n); i++) { out.unshift(k); k = prev(k, g); }
      return { g, keys: out, from: out[0], to: CO.today() };
    };
    // Sum delivered creatives per bucket; the current bucket is "so far".
    const sum = (rows, keys, g, from, to) => { const m = new Map(keys.map((k) => [k, 0])); rows.forEach((r) => { if (r.stage === 'Delivered' && r.ddate && r.ddate >= from && r.ddate <= to) { const k = key(r.ddate, g); if (m.has(k)) m.set(k, m.get(k) + (r.qty || 1)); } }); return m; };
    // The window to compare a bucket with: the bucket before it, cut to the same number of elapsed days when the bucket is still running.
    // Running buckets are matched on working days elapsed (Mon–Fri), so a month 7 working days in is compared with the first 7 working days of the month before.
    const prevWindow = (k, g) => { const pk = prev(k, g), today = CO.today(); const running = end(k, g) >= today; return { from: pk, to: running ? (g === 'day' ? end(pk, g) : CO.sameWorkdaysEnd(k, today, pk, end(pk, g))) : end(pk, g), partial: running }; };
    const between = (rows, f, t) => CO.sumQty(rows.filter((r) => r.stage === 'Delivered' && r.ddate && r.ddate >= f && r.ddate <= t));
    // Control: segmented buttons + custom dates. onChange redraws the graph.
    const control = (host, name, def, onChange, opts) => {
      const s = get(name, def); host.replaceChildren(); host.className = 'gr-ctl';
      const seg = document.createElement('div'); seg.className = 'seg small gr-seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Group by');
      const opt = (opts && opts.only) || ['day', 'week', 'month', 'quarter', 'year'];
      const custom = document.createElement('span'); custom.className = 'gr-custom';
      const f = Object.assign(document.createElement('input'), { type: 'date', className: 'co-input', value: s.from || CO.addDays(CO.today(), -29), min: '2020-01-01', max: CO.today() }); f.setAttribute('aria-label', 'From');
      const t = Object.assign(document.createElement('input'), { type: 'date', className: 'co-input', value: s.to || CO.today(), min: '2020-01-01', max: CO.today() }); t.setAttribute('aria-label', 'To');
      const dash2 = document.createElement('span'); dash2.textContent = 'to'; custom.append(f, dash2, t);
      const paint = () => { seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.g === s.g))); custom.hidden = s.g !== 'custom'; };
      [...opt, 'custom'].forEach((g) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.g = g; b.textContent = g === 'custom' ? 'Custom' : G[g].label; b.title = g === 'custom' ? 'Pick your own dates' : 'Show by ' + G[g].noun; b.addEventListener('click', () => { s.g = g; if (g === 'custom') { s.from = f.value; s.to = t.value; } save(name); paint(); onChange(); }); seg.append(b); });
      const upd = () => { if (f.value && t.value && f.value <= t.value) { s.from = f.value; s.to = t.value; save(name); onChange(); } };
      f.addEventListener('change', upd); t.addEventListener('change', upd);
      host.append(seg, custom); paint();
    };
    return { G, key, next, prev, end, label, curName, lastName, get, grainOf, buckets, sum, prevWindow, between, control, valid };
  })();
  document.querySelectorAll('[data-gr]').forEach((h) => TB.control(h, h.dataset.gr, h.dataset.grDefault || 'month', () => { (h.dataset.grDraw || '').split(' ').filter(Boolean).forEach((d) => dash.draw(d)); }));

  /* Overview: creatives delivered per day / week / month / quarter / year, with the average of the complete buckets. */
  const trendSeries = () => {
    const rs = CO.rows(); if (!rs) return null;
    const s = TB.get('trend', 'week'), b = TB.buckets(s), m = TB.sum(rs, b.keys, b.g, b.from, b.to);
    return { g: b.g, custom: s.g === 'custom', ser: b.keys.map((k) => ({ w: k, n: m.get(k), running: TB.end(k, b.g) >= CO.today() })) };
  };
  dash.draw('trend-note', (el) => {
    const s = TB.get('trend', 'week'), g = TB.grainOf(s);
    el.textContent = s.g === 'custom' ? 'Creatives delivered per ' + TB.G[g].noun + ', ' + CO.fmtDate(s.from) + ' to ' + CO.fmtDate(s.to) + '. Hover for details.' : 'Creatives delivered per ' + TB.G[g].noun + ', last ' + TB.G[g].n + ' ' + TB.G[g].noun + 's. Hover for details.';
  });
  dash.draw('trend-stat', (el) => {
    el.replaceChildren(); const T = CO.status() === 'ok' && trendSeries(); if (!T) return;
    const done = T.ser.filter((d) => !d.running); if (done.length < 2) return;
    // Compare complete buckets: the current one is still filling up.
    const a = done[done.length - 1], b = done[done.length - 2];
    const v = document.createElement('b'); v.textContent = CO.num(a.n);
    const lbl = T.custom ? TB.label(a.w, T.g, true) : TB.lastName[T.g];
    el.append(v, lbl + ' ', CO.delta(a.n, b.n, 'up'), ' vs the ' + TB.G[T.g].noun + ' before');
  });
  dash.draw('trend', (el) => {
    if (CO.notReady(el, 'box')) return;
    const T = trendSeries(), ser = T.ser, g = T.g; el.replaceChildren();
    if (ser.length < 2) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'Pick a range that covers at least two ' + TB.G[g].noun + 's.'; el.append(p); return; }
    const W = Math.max(300, el.clientWidth), H = 230, mB = 26, mT = 16;
    const lastRunning = ser[ser.length - 1].running;
    const done = lastRunning ? ser.slice(0, -1) : ser, avg = d3.mean(done, (d) => d.n) || 0;
    const y = d3.scaleLinear([0, Math.max(4, d3.max(ser, (d) => d.n), avg) * 1.1], [H - mB, mT]).nice();
    const ticks = y.ticks(4);
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Creatives delivered per ' + TB.G[g].noun + ': ' + ser.map((d) => TB.label(d.w, g) + ' ' + d.n).join(', '));
    const meas = svg.append('text').attr('class', 'tick').text(CO.num(d3.max(ticks))); const mL = meas.node().getComputedTextLength() + 12; meas.remove();
    const x = d3.scalePoint(ser.map((d) => d.w), [mL + 8, W - 14]);
    const defs = svg.append('defs'); const gr = defs.append('linearGradient').attr('id', 'trend-fill').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
    gr.append('stop').attr('offset', '0%').style('stop-color', 'var(--bar)').style('stop-opacity', 0.32); gr.append('stop').attr('offset', '100%').style('stop-color', 'var(--bar)').style('stop-opacity', 0);
    svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'grid').attr('x1', mL).attr('x2', W - 4).attr('y1', y).attr('y2', y);
    svg.append('g').selectAll('text').data(ticks).join('text').attr('class', 'tick').attr('x', mL - 6).attr('y', y).attr('dy', '0.35em').attr('text-anchor', 'end').text((d) => CO.num(d));
    const every = Math.ceil(ser.length / Math.max(1, Math.floor((W - mL) / 64)));
    svg.append('g').selectAll('text').data(ser).join('text').attr('class', (d) => 'tick' + (d.running ? ' on' : '')).attr('x', (d) => x(d.w)).attr('y', H - 6).attr('text-anchor', 'middle').text((d, i) => d.running && !T.custom ? TB.curName[g] : (ser.length - 1 - i) % every === 0 ? TB.label(d.w, g) : '');
    svg.append('line').attr('class', 'ref').attr('x1', mL).attr('x2', W - 4).attr('y1', y(avg)).attr('y2', y(avg));
    svg.append('text').attr('class', 'ref-l').attr('x', mL + 6).attr('y', y(avg) - 6).text('avg ' + CO.num(Math.round(avg * 10) / 10) + ' / ' + TB.G[g].noun);
    const curve = d3.curveMonotoneX;
    const area = svg.append('path').datum(done).attr('class', 'area').attr('d', d3.area().curve(curve).x((d) => x(d.w)).y0(H - mB).y1((d) => y(d.n)));
    const line = svg.append('path').datum(done).attr('class', 'line').attr('d', d3.line().curve(curve).x((d) => x(d.w)).y((d) => y(d.n)));
    const prevW = done[done.length - 1];
    if (lastRunning) {
      // The running bucket is a faint continuation with a hollow dot, so an early-week dip never looks like a crash.
      const last = ser[ser.length - 1];
      svg.append('line').attr('x1', x(prevW.w)).attr('y1', y(prevW.n)).attr('x2', x(last.w)).attr('y2', y(last.n)).style('stroke', 'var(--bar)').attr('stroke-width', 2).style('opacity', 0.3).attr('stroke-linecap', 'round');
      svg.append('circle').attr('r', 4.5).attr('cx', x(last.w)).attr('cy', y(last.n)).style('fill', 'var(--panel)').style('stroke', 'var(--bar)').attr('stroke-width', 2).style('opacity', 0.7);
    }
    const endDot = svg.append('circle').attr('class', 'dot').attr('r', 5).attr('cx', x(prevW.w)).attr('cy', y(prevW.n));
    if (freshSig(el, g + JSON.stringify(ser))) {
      const L = line.node().getTotalLength(); line.attr('stroke-dasharray', L + ' ' + L).attr('stroke-dashoffset', L).transition().duration(900).ease(ease).attr('stroke-dashoffset', 0).on('end', () => line.attr('stroke-dasharray', null));
      area.style('opacity', 0).transition().delay(250).duration(700).style('opacity', 1);
      endDot.attr('r', 0).transition().delay(800).duration(300).attr('r', 5);
    }
    const cross = svg.append('line').attr('class', 'cross').attr('y1', mT).attr('y2', H - mB).style('opacity', 0);
    const hov = svg.append('circle').attr('class', 'dot').attr('r', 5.5).style('opacity', 0);
    const tipEl = CO.tip(el);
    const ov = svg.append('rect').attr('x', mL).attr('y', 0).attr('width', W - mL).attr('height', H).style('fill', 'transparent');
    const show = (px) => {
      const step = x.step(), i = Math.max(0, Math.min(ser.length - 1, Math.round((px - x(ser[0].w)) / step))), d = ser[i];
      cross.attr('x1', x(d.w)).attr('x2', x(d.w)).style('opacity', 1); hov.attr('cx', x(d.w)).attr('cy', y(d.n)).style('opacity', 1);
      tipEl.replaceChildren(); const k = document.createElement('div'); k.className = 'k'; k.textContent = TB.label(d.w, g, true) + ' · ' + CO.num(d.n) + ' creatives' + (d.running ? ' so far' : ''); tipEl.append(k);
      if (i) { const pw = TB.prevWindow(d.w, g), pn = d.running ? TB.between(CO.rows(), pw.from, pw.to) : ser[i - 1].n; const r = document.createElement('div'); r.append(CO.delta(d.n, pn, 'up'), d.running ? (g === 'day' ? ' vs the working day before' : ' vs the same working days of the ' + TB.G[g].noun + ' before') : ' vs the ' + TB.G[g].noun + ' before'); tipEl.append(r); }
      if (g !== 'day') { const r2 = document.createElement('div'); r2.textContent = CO.fmtDate(d.w) + ' – ' + CO.fmtDate(TB.end(d.w, g)) + (d.running ? ' (so far)' : ''); r2.style.color = 'var(--muted)'; tipEl.append(r2); }
      CO.placeTip(tipEl, el, x(d.w) / W * el.clientWidth, y(d.n) / H * el.clientHeight);
    };
    ov.on('mousemove', (e) => show(d3.pointer(e, svg.node())[0])).on('mouseleave', () => { cross.style('opacity', 0); hov.style('opacity', 0); tipEl.hidden = true; })
      .on('touchstart', (e) => show(d3.pointer(e.touches[0], svg.node())[0]), { passive: true });
  });
  /* Overview: the brands with the most creatives delivered in the chosen period (today, this week … or custom),
     against the same elapsed days of the period before. Click one to filter the dashboard by it. */
  const brandWindow = () => {
    const s = TB.get('brands', 'month');
    if (s.g === 'custom' && TB.valid(s)) { const to = s.to < CO.today() ? s.to : CO.today(), len = CO.diffDays(s.from, to); return { from: s.from, to, pfrom: CO.addDays(s.from, -len - 1), pto: CO.addDays(s.from, -1), title: 'Top brands, ' + CO.fmtDate(s.from) + ' – ' + CO.fmtDate(to), cmp: 'the ' + (len + 1) + ' days before' }; }
    const g = s.g === 'custom' ? 'month' : s.g, k = TB.key(CO.today(), g), pw = TB.prevWindow(k, g);
    return { from: k, to: CO.today(), pfrom: pw.from, pto: pw.to, title: 'Top brands ' + TB.curName[g].toLowerCase(), cmp: g === 'day' ? 'the working day before' : 'the same working days of ' + TB.lastName[g] };
  };
  dash.draw('tb-title', (el) => { el.textContent = brandWindow().title; });
  dash.draw('top-brands', (el) => {
    if (CO.notReady(el, 'box')) return;
    const w = brandWindow(), del = CO.rows().filter((r) => r.stage === 'Delivered' && r.ddate);
    const rs = del.filter((r) => r.ddate >= w.from && r.ddate <= w.to), prev = del.filter((r) => r.ddate >= w.pfrom && r.ddate <= w.pto);
    const top = d3.rollups(rs, (v) => CO.sumQty(v), (r) => r.brand).sort((a, b) => b[1] - a[1]).slice(0, 6);
    el.replaceChildren();
    if (!top.length) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'Nothing delivered in this period yet.'; el.append(p); return; }
    const max = top[0][1], box = document.createElement('div'); box.className = 'tb-list';
    const go = freshSig(el, w.from + JSON.stringify(top));
    top.forEach(([b, n], i) => {
      const bt = document.createElement('button'); bt.type = 'button'; bt.title = 'Filter the dashboard by ' + b;
      const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = String(i + 1).padStart(2, '0');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = b;
      const v = document.createElement('span'); v.className = 'v'; v.textContent = CO.num(n);
      const pv = CO.sumQty(prev.filter((r) => r.brand === b)); v.title = CO.num(pv) + ' in ' + w.cmp;
      const dl = CO.delta(n, pv, 'up'); dl.classList.add('tb-dl'); dl.title += ' (vs ' + w.cmp + ')';
      const tr = document.createElement('span'); tr.className = 'tr'; const fi = document.createElement('i'); fi.style.width = go ? '0%' : (n / max * 100) + '%'; tr.append(fi);
      if (go) requestAnimationFrame(() => requestAnimationFrame(() => { fi.style.width = (n / max * 100) + '%'; }));
      bt.append(rk, nm, dl, v, tr); bt.addEventListener('click', () => dash.setParams({ brand: b })); box.append(bt);
    });
    el.append(box);
  });

  /* ================= Today: to-do and deliveries (Overview) ================= */
  const DY = { moves: [], at: 0, view: LS.get('co.dailyview', 'person'), open: new Set() };
  async function loadDaily(force) {
    if (A.mode !== 'auth' || !A.user || (!force && Date.now() - DY.at < 60 * 1000)) return;
    DY.at = Date.now();
    try { const b = await callApi({ action: 'daily' }); if (b.ok) { DY.moves = b.moves || []; dash.draw('tw'); } } catch (e) { /* older web app: ETA-based only */ }
  }
  setInterval(() => { if (document.visibilityState === 'visible') loadDaily(); }, 60 * 1000);
  const dailyBuckets = () => {
    const all = CO.rows() || [], t = CO.today();
    let next = CO.addDays(t, 1); while (!CO.isWorkday(next)) next = CO.addDays(next, 1);
    const lastTo = new Map(); DY.moves.slice().reverse().forEach((m) => lastTo.set(m.id, m));
    const deliveredLog = new Set(DY.moves.filter((m) => m.to === 'Delivered').map((m) => m.id));
    const startedLog = new Set(DY.moves.filter((m) => m.to === 'WIP').map((m) => m.id));
    const pick = all.filter((r) => (r.stage === 'To be planned' || r.stage === 'Changes requested') && r.eta && r.eta >= t && r.eta <= next);
    const wip = all.filter((r) => r.stage === 'WIP');
    const done = all.filter((r) => r.stage === 'Delivered' && ((r.id && deliveredLog.has(r.id)) || r.ddate === t));
    const carried = all.filter((r) => r.due === 'overdue');
    return { pick, wip, done, carried, startedLog, deliveredLog };
  };
  /* Today widget (sidebar on desktop, top of the Overview on phones): a progress ring for the day, four tiles
     (pick up, in progress, delivered, carried forward) and the tasks behind the chosen tile. */
  const TW = { sel: LS.get('co.twsel', ''), open: LS.get('co.twopen', '1') !== '0', pop: false };
  const TW_KINDS = [['pick', 'Pick up', 'To be planned or changes requested, due today or the next working day'], ['wip', 'In progress', 'WIP'], ['done', 'Delivered', 'Delivered today (status changed to DONE today, or ETA today)'], ['carried', 'Carried over', 'Open and past its ETA']];
  const countUp = (node, to, from) => {
    if (from == null || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { node.textContent = CO.num(to); return; }
    const t0 = performance.now(), d = 450; const step = (t) => { const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3); node.textContent = CO.num(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step);
  };
  dash.draw('tw', (el) => {
    if (A.mode === 'auth' && !A.user) { el.replaceChildren(); return; }
    if (CO.status() !== 'ok') { if (!el.childElementCount) { el.classList.add('tw-loading'); el.innerHTML = '<span class="tw-sk"></span><span class="tw-sk"></span><span class="tw-sk"></span>'; } return; }
    el.classList.remove('tw-loading'); loadDaily();
    const b = dailyBuckets(), lists = { pick: b.pick, wip: b.wip, done: b.done, carried: b.carried };
    const n = (k) => lists[k].length;
    if (!TW.sel || !lists[TW.sel]) TW.sel = ['pick', 'wip', 'carried', 'done'].find((k) => n(k)) || 'pick';
    const planned = n('pick') + n('wip') + n('done'), pct = planned ? n('done') / planned : 0;
    const prev = el._prev || {}; const animList = el._sel !== TW.sel || !el.childElementCount; el._sel = TW.sel;
    el.replaceChildren();
    // head: ring + title + collapse
    const head = document.createElement('div'); head.className = 'tw-head';
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ring.setAttribute('viewBox', '0 0 36 36'); ring.classList.add('tw-ring'); ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = '<circle cx="18" cy="18" r="15" class="tw-ring-bg"/><circle cx="18" cy="18" r="15" class="tw-ring-fg" pathLength="100" stroke-dasharray="100" stroke-dashoffset="' + (100 - (prev.pct != null ? prev.pct : 0) * 100) + '"/>';
    const fg = ring.querySelector('.tw-ring-fg'); requestAnimationFrame(() => requestAnimationFrame(() => fg.setAttribute('stroke-dashoffset', String(100 - pct * 100))));
    const rWrap = document.createElement('span'); rWrap.className = 'tw-ring-w'; const rN = document.createElement('b'); rN.textContent = Math.round(pct * 100) + '%'; rWrap.append(ring, rN);
    rWrap.title = n('done') + ' of ' + planned + ' delivered today (pick up + in progress + delivered)';
    const tt = document.createElement('div'); tt.className = 'tw-tt'; const h = document.createElement('b'); h.textContent = 'Today'; const sm = document.createElement('small'); sm.textContent = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'short' }); tt.append(h, sm);
    // In the sidebar the task list is a flyout beside it (TW.pop, not remembered); on phones it opens inline (TW.open).
    const side = el.classList.contains('tw-s'), isOpen = side ? TW.pop : TW.open;
    const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'tw-tog'; tog.setAttribute('aria-expanded', String(isOpen)); tog.setAttribute('aria-label', isOpen ? 'Hide tasks' : 'Show tasks'); tog.innerHTML = side ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    const setOpen = (v) => { if (side) TW.pop = v; else { TW.open = v; LS.set('co.twopen', v ? '1' : '0'); } };
    tog.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!isOpen); dash.draw('tw'); });
    head.append(rWrap, tt, tog);
    // tiles
    const tiles = document.createElement('div'); tiles.className = 'tw-tiles'; tiles.setAttribute('role', 'tablist'); tiles.setAttribute('aria-label', 'Today');
    TW_KINDS.forEach(([k, l, tip]) => {
      const t = document.createElement('button'); t.type = 'button'; t.className = 'tw-tile k-' + k + (n(k) ? '' : ' zero'); t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', String(TW.sel === k)); t.title = tip;
      const num = document.createElement('b'); const lab = document.createElement('span'); lab.textContent = l; t.append(num, lab);
      countUp(num, n(k), prev[k]);
      t.addEventListener('click', (e) => { e.stopPropagation(); if (TW.sel === k && isOpen) setOpen(false); else { TW.sel = k; setOpen(true); } LS.set('co.twsel', TW.sel); dash.draw('tw'); });
      tiles.append(t);
    });
    // list for the chosen tile
    const body = document.createElement('div'); body.className = 'tw-body' + (isOpen ? ' open' : '') + (side ? ' pop' : '');
    if (side && isOpen) {
      const k = TW_KINDS.find((x) => x[0] === TW.sel); const ph = document.createElement('div'); ph.className = 'tw-pop-h';
      const pt = document.createElement('b'); pt.textContent = k[1] + ' · ' + n(TW.sel); const ps = document.createElement('small'); ps.textContent = k[2];
      const px = document.createElement('button'); px.type = 'button'; px.className = 'tw-tog'; px.setAttribute('aria-label', 'Close'); px.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'; px.addEventListener('click', (e) => { e.stopPropagation(); TW.pop = false; dash.draw('tw'); });
      const pw = document.createElement('div'); pw.append(pt, ps); ph.append(pw, px); body.append(ph);
      if (!el._popWas) body.classList.add('enter');
      requestAnimationFrame(() => { const r = el.getBoundingClientRect(); body.style.left = (r.right + 12) + 'px'; body.style.bottom = Math.max(12, innerHeight - r.bottom) + 'px'; });
    }
    el._popWas = side && isOpen;
    const inner = document.createElement('div'); inner.className = 'tw-inner';
    const list = lists[TW.sel].slice().sort((x, y) => (x.list[0] || '~').localeCompare(y.list[0] || '~') || (x.eta || '').localeCompare(y.eta || ''));
    const ul = document.createElement('ul'); ul.className = 'tw-list'; ul.setAttribute('role', 'tabpanel');
    list.slice(0, 40).forEach((r, i) => {
      const li = document.createElement('li'); li.className = 'tw-item k-' + TW.sel + (animList ? ' in' : ''); li.style.setProperty('--i', Math.min(i, 10)); li.tabIndex = 0; li.dataset.twUid = r.uid;
      const who = r.list[0] || 'Unassigned'; const av = CO.av(who); av.title = r.list.join(', ') || 'Unassigned';
      const tx = document.createElement('span'); tx.className = 'tw-it';
      const t1 = document.createElement('span'); t1.className = 'tw-it1'; const bb = document.createElement('b'); bb.textContent = r.brand; t1.append(bb, ' ' + CO.topicText(r));
      const t2 = document.createElement('small'); t2.textContent = [who === 'Unassigned' ? 'Unassigned' : who.split(' ')[0], r.type, TW.sel === 'carried' ? CO.diffDays(r.eta, CO.today()) + 'd late' : TW.sel === 'done' ? (b.deliveredLog.has(r.id) ? 'done today' : 'ETA today') : r.eta ? (r.eta === CO.today() ? 'due today' : 'ETA ' + CO.fmtDate(r.eta)) : 'no ETA'].join(' · ');
      tx.append(t1, t2); li.append(av, tx); li.title = r.brand + ' · ' + CO.topicText(r) + (r.id ? ' (' + r.id + ')' : ''); ul.append(li);
    });
    if (list.length > 40) { const m = document.createElement('li'); m.className = 'tw-more'; m.textContent = '+' + (list.length - 40) + ' more in Tasks'; ul.append(m); }
    if (!list.length) { const m = document.createElement('li'); m.className = 'tw-empty'; m.textContent = TW.sel === 'done' ? 'Nothing delivered yet today.' : TW.sel === 'carried' ? 'Nothing carried over. Nice.' : 'Nothing here right now.'; ul.append(m); }
    const foot = document.createElement('button'); foot.type = 'button'; foot.className = 'tw-foot'; foot.textContent = 'Open stand-up'; foot.addEventListener('click', () => dash.setParams({ tab: 'standup' }));
    inner.append(ul, foot); body.append(inner);
    el.append(head, tiles, body);
    el._prev = { pick: n('pick'), wip: n('wip'), done: n('done'), carried: n('carried'), pct };
  });
  // Close the sidebar flyout on Escape or a click outside it.
  document.addEventListener('pointerdown', (e) => { if (TW.pop && !e.target.closest('.tw-s') && !e.target.closest('dialog')) { TW.pop = false; dash.draw('tw'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && TW.pop) { TW.pop = false; dash.draw('tw'); } });
  document.addEventListener('click', (e) => { const li = e.target.closest('[data-tw-uid]'); if (li && TW.pop) { TW.pop = false; dash.draw('tw'); } if (li) document.dispatchEvent(new CustomEvent('co-open-editor', { detail: li.dataset.twUid })); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-tw-uid]')) document.dispatchEvent(new CustomEvent('co-open-editor', { detail: e.target.dataset.twUid })); });

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
      const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = [r.id, r.type, r.stage, r.priority, CO.cls(r)].filter(Boolean).join(' · ');
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
        r.list.forEach((d) => { if (EF.hidden(d) || (!CO.isActive(d) && !r.open)) return; if (!people.has(d)) people.set(d, []); people.get(d).push(r); });
      });
      const p = dash.params();
      if (p.designer && p.designer !== '__none') [...people.keys()].forEach((k) => { if (k !== p.designer) people.delete(k); });
      if (p.designer === '__none') [...people.keys()].forEach((k) => { if (k !== 'Unassigned') people.delete(k); });
      const notLateOrToday = (r) => r.due !== 'overdue' && r.due !== 'today';
      const cards = [...people].map(([name, list]) => {
        const open = list.filter((r) => r.open);
        return { name, open, overdue: open.filter((r) => r.due === 'overdue').sort(byEta), today: open.filter((r) => r.due === 'today'),
          wip: open.filter((r) => r.stage === 'WIP' && notLateOrToday(r)).sort(byEta),
          changes: open.filter((r) => r.stage === 'Changes requested' && notLateOrToday(r)).sort(byEta),
          next: open.filter((r) => r.stage !== 'WIP' && r.stage !== 'Changes requested' && notLateOrToday(r)).sort(byEta),
          review: list.filter((r) => r.stage === 'Pending approval'), done: list.filter((r) => r.stage === 'Delivered') };
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
        st(c.overdue.length, 'overdue', 's-bad'); st(c.today.length, 'due today', 's-warn'); st(c.open.filter((r) => r.stage === 'WIP').length, 'WIP', '', CO.stageColor('WIP'));
        st(c.open.filter((r) => r.stage === 'To be planned').length, 'TBP', 's-mute'); st(c.review.length, 'pending approval', '', CO.stageColor('Pending approval'));
        if (stats.childNodes.length) card.append(stats);
        const more = () => CO.goTasks('open', { designer: c.name === 'Unassigned' ? '__none' : c.name });
        [section('Overdue', c.overdue, 4, more), section('Due today', c.today, 4, more), section('WIP', c.wip, 4, more), section('Changes requested', c.changes, 3, more), section('Up next', c.next, 3, more)].forEach((s) => { if (s) card.append(s); });
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
      CO.csv('creative-tasks-' + CO.today() + '.csv', ['ID', 'Internal / External', 'Brand', 'Creative', 'Type', 'Qty', 'Designer', 'Priority', 'Requested', 'Design ETA', 'Status', 'Delivery date', 'Content owner', 'Channel', 'Live status', 'Brief', 'Creative link'],
        filtered().map((r) => [r.id, CO.cls(r), r.brand, r.topic, r.type, r.qty, r.designers, r.priority, r.req, r.eta, r.stage, r.ddate, r.owner, r.channel, r.live_status, r.brief, r.link]));
    });
    dash.draw('task-count', (el) => { if (CO.notReady(el, 'text')) return; el.textContent = CO.num(filtered().length); });
    // One-click status views with live counts; the full list stays in the status menu.
    const CHIPS = [['active', 'Not delivered'], ['open', 'Open'], ['overdue', 'Overdue'], ['week', 'Due this week'], ['noeta', 'No ETA'], ['review', 'Pending approval'], ['delivered-month', 'Delivered this month'], ['all', 'All']];
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

  /* ================= Roles and estimated workload (admin view) =================
     Roles come from the team list's Role column. "not shown" keeps someone out of team views and workload.
     Effort is a rough estimate per creative, by creative type (editing and video take longer than statics),
     adjusted for interns. Capacity is 7 productive hours a working day (Mon–Fri). For internal planning only. */
  const EF = (() => {
    const HOURS = { 'Static': 1.5, 'Banner': 1.5, 'Frame': 1.5, 'GIF': 2, 'Carousel': 2.5, 'A+ Content': 3, 'Infographic': 2.5, 'Video': 4, 'Video Edit': 4, 'Reel': 4, 'AI Video': 5, 'Animation': 5, 'In-House Video': 6, 'Unspecified': 2 };
    const CAP = 7;
    const role = (name) => (CO.member(name).role || '').trim();
    const hidden = (name) => /not shown/i.test(role(name));
    const intern = (name) => /intern/i.test(role(name));
    const writer = (name) => /content writer/i.test(role(name));
    const typeHours = (t) => HOURS[t] != null ? HOURS[t] : CO.VIDEO.test(t || '') ? 4 : 2;
    // Hours one task puts on one person: per creative, shared equally between the people on it; changes take about half.
    const hoursFor = (r, name) => {
      const share = Math.max(1, r.list.length), qty = r.qty || 1;
      let h = typeHours(r.type) * qty / share;
      if (r.stage === 'Changes requested') h *= 0.5;
      if (intern(name)) h *= 1.3;
      return h;
    };
    // Open work for a person: their open tasks; a content writer also carries "content in progress" rows they own.
    const load = (name, rows) => {
      const rs = rows || CO.rows(true) || [];
      const mine = rs.filter((r) => r.open && r.list.includes(name));
      let hours = mine.reduce((a, r) => a + hoursFor(r, name), 0);
      const first = name.toLowerCase().split(' ')[0];
      const content = rs.filter((r) => r.sub === 'Content in progress' && r.owner && r.owner.toLowerCase().split(/[ ,]/)[0] === first);
      hours += content.reduce((a, r) => a + 1 * (r.qty || 1) * (intern(name) ? 1.3 : 1), 0);
      return { hours, days: hours / CAP, tasks: mine.length + content.length, content: content.length };
    };
    return { HOURS, CAP, role, hidden, intern, writer, typeHours, hoursFor, load };
  })();

  /* ================= Team ================= */
  (() => {
    const shown = (n) => !EF.hidden(n) && ((dash.params().who || 'active') === 'all' || CO.isActive(n));
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
          name, open: CO.sumQty(open), wip: open.filter((r) => r.stage === 'WIP').length, overdue: list.filter((r) => r.due === 'overdue').length,
          week: list.filter((r) => r.due === 'today' || r.due === 'week').length, review: list.filter((r) => r.stage === 'Pending approval').length,
          thisM: CO.sumQty(del.filter((r) => r.month === m)), lastM: CO.sumQty(del.filter((r) => r.month === pm)),
          lastSame: CO.sumQty(del.filter((r) => r.ddate && r.ddate >= pm + '-01' && r.ddate <= CO.sameWorkdaysEnd(m + '-01', CO.today(), pm + '-01', CO.monthEnd(pm)))),
          perDay: CO.workdays(m + '-01', CO.today()) ? CO.sumQty(del.filter((r) => r.month === m)) / CO.workdays(m + '-01', CO.today()) : 0,
          avg: ms.size ? CO.sumQty(del) / ms.size : 0, del,
          brands: d3.rollups(list, (v) => v.length, (r) => r.brand).sort((a, b) => b[1] - a[1]).slice(0, 3).map((d) => d[0]).join(', ')
        };
      }).sort((a, b) => (CO.member(a.name).status === 'Inactive') - (CO.member(b.name).status === 'Inactive') || b.open - a.open || b.thisM - a.thisM);
      if (!data.length) return CO.emptyRow(tb, 14, 'No team members in this view.');
      const maxOpen = d3.max(data, (d) => d.open) || 1;
      data.forEach((d) => {
        const tr = tb.insertRow();
        const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'co-name'; const nt = document.createElement('span'); nt.textContent = d.name; nb.append(CO.av(d.name), nt); nb.title = 'Open ' + d.name + "'s tasks"; nb.addEventListener('click', () => CO.goTasks('active', { designer: d.name }));
        CO.td(tr, nb, 'co-nowrap'); CO.td(tr, statusCell(d.name), 'co-nowrap');
        CO.td(tr, EF.role(d.name) || '—', 'co-nowrap co-muted co-hide-md');
        { const L = EF.load(d.name); const b2 = document.createElement('span'); b2.className = 'ef-load ' + (L.days > 5 ? 'hi' : L.days > 2.5 ? 'mid' : 'lo'); b2.textContent = L.hours ? (L.days < 1 ? Math.round(L.hours) + ' h' : L.days.toFixed(1) + ' d') : 'free'; const c = CO.td(tr, b2, 'n adm-only co-nowrap'); c.title = L.tasks + ' open tasks ≈ ' + Math.round(L.hours) + ' hours of work = ' + L.days.toFixed(1) + ' working days at ' + EF.CAP + ' h a day' + (L.content ? ' (incl. ' + L.content + ' content in progress)' : '') + '. Estimate by creative type and role.'; }
        const ob = document.createElement('span'); ob.className = 'co-inbar'; const bi = document.createElement('i'); bi.style.width = (d.open / maxOpen * 3) + 'rem'; ob.append(bi, String(d.open)); CO.td(tr, ob, 'n');
        CO.td(tr, String(d.wip), 'n co-hide-lg');
        CO.td(tr, String(d.overdue), 'n' + (d.overdue ? ' bad' : ''));
        CO.td(tr, String(d.week), 'n co-hide-md'); CO.td(tr, String(d.review), 'n'); const tm = document.createElement('span'); tm.className = 'n-with-dl'; const tmb = document.createElement('b'); tmb.textContent = CO.num(d.thisM); tm.append(tmb, CO.delta(d.thisM, d.lastSame, 'up')); tm.lastChild.title += ' (vs the same number of working days last month)'; CO.td(tr, tm, 'n'); CO.td(tr, CO.num(d.lastM), 'n'); const pd = CO.td(tr, d.perDay ? d.perDay.toFixed(1) : '0', 'n'); pd.title = CO.num(d.thisM) + ' creatives ÷ ' + CO.workdays(m + '-01', CO.today()) + ' working days so far this month (Mon–Fri)';
        CO.td(tr, d.brands, 'co-hide-lg co-clip').title = d.brands;
        const mix = document.createElement('span'); mix.className = 'co-mix';
        const total = CO.sumQty(d.del);
        top.forEach((t) => { const c = CO.sumQty(d.del.filter((r) => CO.typeOf(r, top) === t)); if (!c) return; const i = document.createElement('i'); i.style.flex = c + ' 1 0'; i.style.background = cmap.get(t); i.title = t + ': ' + c; mix.append(i); });
        mix.title = top.map((t) => t + ': ' + CO.sumQty(d.del.filter((r) => CO.typeOf(r, top) === t))).filter((x) => !/: 0$/.test(x)).join(' · ');
        CO.td(tr, mix, 'co-hide-md');
      });
    });
    dash.draw('team-wd', (el) => {
      const m = CO.thisMonth(), t = CO.today(), pm = CO.prevMonth(m), so = CO.workdays(m + '-01', t), all = CO.workdays(m + '-01', CO.monthEnd(m));
      el.textContent = 'Working days are Monday to Friday. ' + CO.fmtMonth(m, true) + ' has ' + all + ' working days; ' + so + ' so far. "This month" is compared with the first ' + so + ' working days of ' + CO.fmtMonth(pm, true).split(' ')[0] + ', and "Per work day" is this month\'s creatives ÷ ' + so + '.';
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
    // Working days in the period up to today (Mon–Fri); for all time, from the first delivery.
    const wdIn = (f, t, rs) => { const a = f === '2000-01-01' ? (rs.map((r) => r.ddate).sort()[0] || CO.today()) : f; const b = t > CO.today() ? CO.today() : t; return CO.workdays(a, b); };
    const stats = (f, t) => {
      const rs = inRange(CO.rows(), f, t);
      const people = new Set(rs.flatMap((r) => r.list));
      const total = CO.sumQty(rs);
      return { rs, total, tasks: rs.length, paid: CO.sumQty(rs.filter((r) => r.source === 'Paid')), mkt: CO.sumQty(rs.filter((r) => r.source === 'Marketing')),
        brands: new Set(rs.map((r) => r.brand)).size, people: people.size, wd: wdIn(f, t, rs), per: people.size && wdIn(f, t, rs) ? total / people.size / wdIn(f, t, rs) : 0 };
    };
    dash.draw('r-period', (el) => { const pr = CO.period(); const to = pr.to > CO.today() ? CO.today() : pr.to; el.textContent = 'Reporting on ' + CO.label(pr.from, pr.to) + (pr.all ? '' : ' (' + CO.workdays(pr.from, to) + ' working days' + (pr.to > CO.today() ? ' so far' : '') + ')') + (pr.pfrom ? ', compared with ' + CO.label(pr.pfrom, pr.pto) + ' (' + CO.workdays(pr.pfrom, pr.pto) + ' working days)' : '') + '.'; });
    dash.draw('rkpi', (el) => {
      if (CO.notReady(el, 'text')) return;
      const pr = CO.period(), s = stats(pr.from, pr.to), k = el.dataset.kpi;
      if (k === 'per') el.textContent = s.per ? s.per.toFixed(2) : '—'; else countTo(el, s[k]);
    });
    dash.draw('rkpi-sub', (el) => {
      if (CO.notReady(el, 'text')) return;
      const pr = CO.period(), s = stats(pr.from, pr.to), k = el.dataset.kpi;
      el.replaceChildren();
      if (k === 'paid' || k === 'mkt') { el.textContent = (s.total ? Math.round(s[k] / s.total * 100) : 0) + '% of the period'; return; }
      if (k === 'per') { el.textContent = s.people + (s.people === 1 ? ' person' : ' people') + ' · ' + s.wd + ' working days'; el.title = CO.num(s.total) + ' creatives ÷ ' + s.people + ' people ÷ ' + s.wd + ' working days (Mon–Fri)'; return; }
      if (!pr.pfrom) { el.textContent = k === 'total' ? CO.num(CO.sumQty(s.rs.filter((r) => CO.VIDEO.test(r.type)))) + ' video, reel or GIF' : ''; return; }
      el.append(CO.delta(s[k], stats(pr.pfrom, pr.pto)[k], 'up'), ' vs previous');
    });
    dash.draw('r-legend', (el) => {
      if (CO.notReady(el, 'list')) return;
      if ((dash.params().rchart || 'total') === 'total') {
        const sw = (good, k, label) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = CO.toneFill({ good, k }, 'var(--panel)'); s.append(i, label); return s; };
        const n = document.createElement('span'); const ni = document.createElement('i'); ni.style.background = 'var(--bar)'; n.append(ni, 'no earlier month');
        el.replaceChildren(sw(true, 0.25, 'a little more'), sw(true, 1, 'much more than the month before'), sw(false, 0.25, 'a little fewer'), sw(false, 1, 'much fewer'), n);
        return;
      }
      const top = CO.topTypes(delivered(), 5), cmap = CO.typeColors(top);
      el.replaceChildren(...top.map((t) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = cmap.get(t); s.append(i, t); return s; }));
    });
    dash.draw('r-chart-note', (el) => { const s = TB.get('rchart', 'month'), g = TB.grainOf(s); el.textContent = 'Creatives delivered per ' + TB.G[g].noun + '. The report period is highlighted; click a bar to report on it.'; });
    dash.draw('r-chart', (el) => {
      if (CO.notReady(el, 'box')) return;
      const del = delivered();
      el.replaceChildren();
      if (!del.length) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'No deliveries in this view.'; el.append(p); return; }
      const pr = CO.period();
      const byType = (dash.params().rchart || 'total') === 'type';
      const top = byType ? CO.topTypes(del, 5) : ['Total'], cmap = byType ? CO.typeColors(top) : new Map([['Total', 'var(--brand)']]);
      const S = TB.get('rchart', 'month'), B = TB.buckets(S, S.g === 'month' ? 18 : S.g === 'day' ? 22 : S.g === 'week' ? 16 : undefined), g = B.g, ms = B.keys;
      const inSel = (k) => pr.all || (k <= pr.to && TB.end(k, g) >= pr.from);
      const series = ms.map((m) => { const o = { m }; top.forEach((t) => { o[t] = 0; }); const e = TB.end(m, g); del.filter((r) => r.ddate >= m && r.ddate <= e && r.ddate >= B.from && r.ddate <= B.to).forEach((r) => { o[byType ? CO.typeOf(r, top) : 'Total'] += r.qty || 1; }); o.total = top.reduce((a, t) => a + o[t], 0); return o; });
      // Each bucket against the one before; the running bucket against the same elapsed days of the one before.
      series.forEach((o) => {
        const pw = TB.prevWindow(o.m, g);
        o.running = pw.partial;
        o.prev = del.some((r) => r.ddate <= pw.to) ? TB.between(del, pw.from, pw.to) : null;
        o.prevLabel = pw.partial ? (g === 'day' ? 'the working day before' : 'the same working days of the ' + TB.G[g].noun + ' before') : TB.label(TB.prev(o.m, g), g, true);
        o.tone = o.prev == null ? null : CO.tone(o.total - o.prev, o.prev, 'up');
      });
      const W = Math.max(300, el.clientWidth), H = 260, mB = 24, mT = 18;
      const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Creatives delivered per ' + TB.G[g].noun);
      const yt = d3.scaleLinear([0, d3.max(series, (d) => d.total) || 1], [H - mB, mT]).nice();
      const ticks = yt.ticks(4);
      const meas = svg.append('text').attr('class', 'tick').text(CO.num(d3.max(ticks)));
      const mL = meas.node().getComputedTextLength() + 10; meas.remove();
      const x = d3.scaleBand(ms, [mL, W - 4]).padding(0.25);
      svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'grid').attr('x1', mL).attr('x2', W - 4).attr('y1', yt).attr('y2', yt);
      svg.append('g').selectAll('text').data(ticks).join('text').attr('class', 'tick').attr('x', mL - 6).attr('y', yt).attr('dy', '0.35em').attr('text-anchor', 'end').text((d) => CO.num(d));
      const every = Math.ceil(ms.length / Math.max(1, Math.floor((W - mL) / 52)));
      svg.append('g').selectAll('text').data(ms).join('text').attr('class', (m) => 'tick' + (inSel(m) && !pr.all ? ' on' : '')).attr('x', (m) => x(m) + x.bandwidth() / 2).attr('y', H - 6).attr('text-anchor', 'middle')
        .text((m, i) => ((ms.length - 1 - i) % every === 0) ? TB.label(m, g) : '');
      if (!byType) {
        // Total: pill bars coloured by the change from the bucket before (green up, red down, deeper = bigger change).
        // Buckets outside the report period are striped and lighter, so the selection reads first.
        const pid = 'stripe-' + Math.random().toString(36).slice(2, 8);
        const pat = svg.append('defs').append('pattern').attr('id', pid).attr('width', 7).attr('height', 7).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
        pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 7).style('stroke', 'var(--panel)').attr('stroke-width', 2.6).style('opacity', 0.55);
        const pw = Math.max(4, Math.min(46, x.bandwidth() * 0.78)), po = (x.bandwidth() - pw) / 2, base = yt(0);
        const on = (d) => pr.all || inSel(d.m);
        const g2 = svg.append('g').selectAll('g').data(series).join('g');
        const bar = (sel) => sel.attr('x', (d) => x(d.m) + po).attr('width', pw).attr('y', (d) => Math.min(yt(d.total), base - pw)).attr('height', (d) => d.total ? Math.max(pw, base - yt(d.total)) : 0).attr('rx', pw / 2).attr('data-m', (d) => d.m);
        bar(g2.append('rect').attr('class', 'mk tone-bar')).style('fill', (d) => CO.toneFill(d.tone, 'var(--panel)')).style('opacity', (d) => on(d) ? 1 : 0.42);
        bar(g2.filter((d) => !on(d)).append('rect').attr('class', 'mk')).style('fill', 'url(#' + pid + ')');
        if (pw >= 10) svg.append('g').selectAll('circle').data(series.filter((d) => d.total)).join('circle').attr('class', 'mk').attr('data-m', (d) => d.m).attr('cx', (d) => x(d.m) + x.bandwidth() / 2).attr('cy', (d) => Math.min(yt(d.total), base - pw) + pw / 2).attr('r', Math.min(5, pw / 4))
          .style('fill', 'var(--panel)').style('opacity', (d) => on(d) ? 0.95 : 0.6);
      } else {
      const stack = d3.stack().keys(top)(series);
      const bw = Math.min(24, x.bandwidth()), off = (x.bandwidth() - bw) / 2;
      svg.append('g').selectAll('g').data(stack).join('g').style('fill', (s) => cmap.get(s.key))
        .selectAll('rect').data((s) => s).join('rect').attr('class', 'mk').attr('data-m', (d) => d.data.m).attr('x', (d) => x(d.data.m) + off).attr('width', bw)
        .attr('y', (d) => yt(d[1])).attr('height', (d) => Math.max(0, yt(d[0]) - yt(d[1]) - (d[1] > d[0] && d[0] > 0 ? 2 : 0))).attr('rx', Math.min(3, bw / 3))
        .style('opacity', (d) => inSel(d.data.m) ? 1 : 0.45);
      }
      const lw = byType ? Math.min(24, x.bandwidth()) : Math.min(46, x.bandwidth() * 0.78);
      svg.append('g').selectAll('text').data(series).join('text').attr('class', (d) => 'tick' + (inSel(d.m) ? ' on' : '')).attr('x', (d) => x(d.m) + x.bandwidth() / 2).attr('y', (d) => (byType ? yt(d.total) : Math.min(yt(d.total), yt(0) - lw)) - 7).attr('text-anchor', 'middle').text((d) => lw >= 16 && (x.bandwidth() >= 30 || inSel(d.m)) ? d.total : '');
      // Average of the complete buckets shown.
      const full = series.filter((d) => !d.running), avgM = d3.mean(full, (d) => d.total);
      if (avgM) { svg.append('line').attr('class', 'ref').attr('x1', mL).attr('x2', W - 4).attr('y1', yt(avgM)).attr('y2', yt(avgM)); svg.append('text').attr('class', 'ref-l').attr('x', mL + 4).attr('y', yt(avgM) - 6).text('avg ' + CO.num(Math.round(avgM * 10) / 10) + ' / ' + TB.G[g].noun); }
      if (freshSig(el, g + (byType ? 't' : 's') + JSON.stringify(series.map((d) => d.total)) + pr.from + pr.to)) {
        svg.selectAll('rect.mk').each(function (d, i) { const r = d3.select(this), y0 = +r.attr('y'), h = +r.attr('height'); r.attr('y', yt(0)).attr('height', 0).transition().duration(750).delay(Math.min(i, 40) * 18).ease(ease).attr('y', y0).attr('height', h); });
        svg.selectAll('circle.mk').style('opacity', 0).transition().delay(650).duration(300).style('opacity', 1);
      }
      const tipEl = CO.tip(el);
      const mark = (m) => { el.classList.toggle('hovering', !!m); svg.selectAll('.mk').classed('on', function () { return this.getAttribute('data-m') === m; }); };
      svg.append('g').selectAll('rect').data(series).join('rect').attr('class', 'bar hit').attr('x', (d) => x(d.m)).attr('width', x.bandwidth()).attr('y', mT).attr('height', H - mB - mT)
        .on('click', (e, d) => { const to = TB.end(d.m, g); dash.setParams({ rpreset: 'custom', rfrom: d.m, rto: to > CO.today() ? CO.today() : to }); })
        .on('mouseenter', (e, d) => mark(d.m))
        .on('mousemove', (e, d) => { tipEl.replaceChildren(); const k = document.createElement('div'); k.className = 'k'; k.textContent = TB.label(d.m, g, true) + ' · ' + CO.num(d.total) + ' creatives' + (d.running ? ' so far' : ''); tipEl.append(k);
          if (d.prev != null) { const r = document.createElement('div'); r.append(CO.delta(d.total, d.prev, 'up'), ' vs ' + d.prevLabel); tipEl.append(r); } (byType ? top.slice().reverse() : []).forEach((t) => { if (!d[t]) return; const r = document.createElement('div'); const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = cmap.get(t); r.append(sw, t + ': ' + d[t]); tipEl.append(r); }); const [px] = d3.pointer(e, el); CO.placeTip(tipEl, el, px, el.clientHeight * 0.3); })
        .on('mouseleave', () => { tipEl.hidden = true; mark(null); });
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
        if (prev) { const p0 = CO.sumQty(prev.filter((r) => keyFn(r).includes(k))); CO.td(tr, CO.delta(n, p0, 'up'), 'n'); }
      });
      const tr = tb.insertRow(); tr.className = 'total'; CO.td(tr, 'All');
      top.forEach((t) => CO.td(tr, CO.num(CO.sumQty(rs.filter((r) => CO.typeOf(r, top) === t))), 'n'));
      CO.td(tr, CO.num(CO.sumQty(rs)), 'n');
      if (prev) CO.td(tr, CO.delta(CO.sumQty(rs), CO.sumQty(prev), 'up'), 'n');
    };
    dash.draw('r-brand', (t) => crossTable(t, (r) => [r.brand], 'Brand'));
    dash.draw('r-designer', (t) => crossTable(t, (r) => r.list.length ? r.list : ['Unassigned'], 'Designer', (k) => { const m = CO.member(k); if (k === 'Unassigned' || m.status === 'Active') return null; const s = document.createElement('span'); s.className = m.status === 'New' ? 'tag-new' : 'tag-off'; s.textContent = m.status; return s; }));
    dash.draw('r-type', (table) => {
      if (CO.notReady(table, 'table')) return;
      table.replaceChildren();
      const pr = CO.period(), cur = inRange(CO.rows(), pr.from, pr.to), prev = pr.pfrom ? inRange(CO.rows(), pr.pfrom, pr.pto) : [];
      const hr = table.createTHead().insertRow();
      ['Creative type', 'This period', 'Share', 'Previous period', 'Change', 'External', 'Internal', 'Brands', 'Designers'].forEach((h, i) => { const th = document.createElement('th'); th.textContent = h; if (i) th.className = 'n'; hr.append(th); });
      const tb = table.createTBody();
      const types = [...new Set(cur.concat(prev).map((r) => r.type))];
      if (!types.length) return CO.emptyRow(tb, 9, 'Nothing delivered in this period or the one before.');
      const curTotal = CO.sumQty(cur);
      types.map((t) => { const c = cur.filter((r) => r.type === t); return { t, c, n: CO.sumQty(c), p: CO.sumQty(prev.filter((r) => r.type === t)) }; }).sort((a, b) => b.n - a.n || b.p - a.p).forEach((d) => {
        const tr = tb.insertRow(); CO.td(tr, d.t, 'co-nowrap');
        CO.td(tr, CO.num(d.n), 'n num-b'); CO.td(tr, curTotal ? Math.round(d.n / curTotal * 100) + '%' : '—', 'n'); CO.td(tr, pr.pfrom ? CO.num(d.p) : '—', 'n');
        CO.td(tr, pr.pfrom ? CO.delta(d.n, d.p, 'up') : '—', 'n');
        CO.td(tr, CO.num(CO.sumQty(d.c.filter((r) => r.source === 'Paid'))), 'n'); CO.td(tr, CO.num(CO.sumQty(d.c.filter((r) => r.source === 'Marketing'))), 'n');
        CO.td(tr, String(new Set(d.c.map((r) => r.brand)).size), 'n'); CO.td(tr, String(new Set(d.c.flatMap((r) => r.list)).size), 'n');
      });
    });
    document.getElementById('r-csv').addEventListener('click', () => {
      if (CO.status() !== 'ok') return;
      const pr = CO.period(), rs = inRange(CO.rows(), pr.from, pr.to), out = [];
      const add = (dim, keyFn) => { const m = new Map(); rs.forEach((r) => keyFn(r).forEach((k) => { const key = k + '\u0000' + r.type; m.set(key, (m.get(key) || 0) + (r.qty || 1)); })); [...m].sort().forEach(([key, n]) => { const [k, t] = key.split('\u0000'); out.push([CO.label(pr.from, pr.to), dim, k, t, n]); }); };
      add('Brand', (r) => [r.brand]); add('Designer', (r) => r.list.length ? r.list : ['Unassigned']); add('Internal / External', (r) => [CO.cls(r)]);
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
      EDITING.uid = r.src + ':' + (r.id || r.row); EDITING.label = (r.id ? r.id + ' · ' : '') + r.brand + ' · ' + CO.topicText(r).slice(0, 50);
      if (can('Editor')) setTimeout(checkForChanges, 50);
      const list = r.designers ? [...new Set(r.designers.split(' + ').map(CO.canon))] : [];
      before = { status: r.stage, eta: r.eta || '', designer: list.join(', '), priority: r.priority || '', qty: String(r.qty || 1) };
      $('ed-where').textContent = CO.cls(r) + ' · ' + (SHEET[r.src] || r.source) + (r.row ? ' · row ' + r.row : '') + (r.id ? ' · ' + r.id : '');
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
      $('ed-info').textContent = r.stage === 'Incomplete brief' ? 'Waiting on the brief: design has not started because the content status is not done yet.' : (r.stage === 'Delivered' && !cols.delivered ? '' : '');
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
    document.addEventListener('co-open-editor', (e) => openEditor(e.detail));
    document.querySelector('.co').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-uid][tabindex]')) openEditor(e.target.dataset.uid); });
    $('ed-cancel').addEventListener('click', () => dlgE.close());
    dlgE.addEventListener('close', () => { EDITING.uid = ''; EDITING.label = ''; });
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
      try { await saveFields(r, fields); dlgE.close(); }
      catch (err) {
        $('ed-msg').textContent = 'Not saved: ' + err.message;
        $('ed-save').disabled = false; $('ed-save').textContent = 'Save to sheet';
      }
    });
    // One path for every task change (the editor and the assistant): write to the sheet, show it at once, then reload.
    async function saveFields(r, fields) {
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
        renderAll();
        toast('Saved to the ' + (SHEET[r.src] || 'sheet') + ', row ' + (res.row || r.row) + (res.written && res.written.status ? ' (status "' + res.written.status + '")' : ''));
        setTimeout(() => load(true), 1500);
        return res;
    }
    TASK_SAVE = saveFields;
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
  const when = (iso) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : CO.istDateTime(d, d.getFullYear() !== new Date().getFullYear()); };
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

  /* Reminder times (IST minutes since midnight); the web app sends the admin's settings with every check. */
  const REMIND_AT = { morning: 600, evening: 1080, label: { morning: '10:00', evening: '18:00' } };
  /* Presence: who is online (admins only see the list; everyone is told it is visible). */
  const PRS = { on: true, list: [] };
  const PAGE_NAME = { today: 'Overview', standup: 'Stand-up', tasks: 'Tasks', notes: 'Notes', team: 'Team', reports: 'Reports', health: 'Data health', access: 'Access' };
  const agoText = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : CO.istDateTime(iso); };
  dash.draw('presence-mini', (el) => {
    el.replaceChildren(); if (!can('Admin') || A.mode !== 'auth' || !PRS.on) return;
    const on = PRS.list.filter((p) => p.online && (!A.user || p.email !== A.user.email));
    if (!on.length) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pm-mini'; b.title = on.map((p) => p.name + ' · ' + (PAGE_NAME[p.page] || 'dashboard') + (p.taskLabel ? ' · editing ' + p.taskLabel : '')).join('\n');
    on.slice(0, 4).forEach((p) => { const a = CO.av(p.name); a.classList.add('live'); b.append(a); });
    const n = document.createElement('span'); n.textContent = on.length + ' online'; b.append(n);
    b.addEventListener('click', () => dash.setParams({ tab: 'access' })); el.append(b);
  });
  dash.draw('presence', (el) => {
    el.replaceChildren();
    if (!PRS.on) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'Presence is switched off in the reminder settings below.'; el.append(p); return; }
    const list = PRS.list.slice().sort((a, b) => (b.online - a.online) || String(b.at).localeCompare(String(a.at)));
    if (!list.length) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'Checking who is online…'; el.append(p); return; }
    list.forEach((p) => {
      const r = document.createElement('div'); r.className = 'pr-row' + (p.online ? ' online' : '');
      const a = CO.av(p.name); if (p.online) a.classList.add('live');
      const t = document.createElement('div'); const n = document.createElement('b'); n.textContent = p.name; const sm = document.createElement('small');
      sm.textContent = p.online ? 'On ' + (PAGE_NAME[p.page] || 'the dashboard') + (p.taskLabel ? ' · editing ' + p.taskLabel : '') : 'Last active ' + agoText(p.at);
      t.append(n, sm);
      const st = document.createElement('span'); st.className = 'pr-state'; st.textContent = p.online ? (p.taskLabel ? 'Editing' : 'Online') : 'Away';
      r.append(a, t, st); el.append(r);
    });
  });

  /* Daily snapshots kept by the web app (open, overdue… per day, IST), for exact before/after comparisons. */
  const HS = { days: [], at: 0 };
  async function loadHistory() {
    if (A.mode !== 'auth' || !A.user || Date.now() - HS.at < 30 * 60 * 1000) return;
    HS.at = Date.now();
    try { const b = await callApi({ action: 'history' }); if (b.ok) { HS.days = b.days || []; dash.draw('kpi-sub'); } } catch (e) { /* older web app: no comparisons */ }
  }

  /* ================= Motion helpers ================= */
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Animate a chart only when what it shows changed (not on every 30-second check).
  const freshSig = (el, sig) => { const go = !REDUCED && el.__sig !== sig; el.__sig = sig; return go; };
  const ease = (t) => 1 - Math.pow(1 - t, 3); // cubic ease-out; no dependency on d3 being loaded

  /* ================= Daily briefings and notifications (IST) ================= */
  const ICONS = {
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
    bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
    check: 'M20 6L9 17l-5-5', at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
    clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', cal: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4', plus: 'M12 5v14M5 12h14', edit: 'M4 20l4-1 11-11-3-3L5 16z', video: 'M3 7h12v10H3zM15 10l6-3v10l-6-3'
  };
  const svgIcon = (d) => { const ns = 'http://www.w3.org/2000/svg'; const s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.append(p); return s; };
  const myDesigner = () => { if (!A.user || !A.user.name) return null; const r = CO.team().resolve(A.user.name); return r ? r.name : null; };
  /* The briefing: the same numbers for everyone, plus "yours" when the signed-in person is on the team list. */
  function briefing(kind) {
    const all = CO.rows(true); if (!all) return null;
    const t = CO.today(), tm = CO.addDays(t, 1), me = myDesigner();
    const open = all.filter((r) => r.open);
    const b = {
      kind, me, overdue: open.filter((r) => r.due === 'overdue'), today: open.filter((r) => r.due === 'today'), tomorrow: open.filter((r) => r.eta === tm),
      unassigned: open.filter((r) => !r.list.length), review: all.filter((r) => r.stage === 'Pending approval'), delivered: all.filter((r) => r.stage === 'Delivered' && r.ddate === t)
    };
    b.mine = me ? open.filter((r) => r.list.includes(me)) : [];
    b.actions = NB.myActions().filter((a) => !a.done);
    return b;
  }
  const istMins = () => { const o = CO.istParts(); return +o.hour * 60 + +o.minute; };
  const briefKind = () => { const m = istMins(); return m >= REMIND_AT.evening ? 'evening' : m >= REMIND_AT.morning ? 'morning' : null; };
  const BR = { dlg: document.getElementById('brief'), kind: 'morning' };
  dash.draw('brief-body', (el) => {
    el.replaceChildren(); const b = briefing(BR.kind); if (!b) return;
    const first = A.user && A.user.name ? A.user.name.split(' ')[0] : '';
    const hero = document.createElement('div'); hero.className = 'brief-hero';
    const sm = document.createElement('small'); sm.textContent = b.kind === 'morning' ? 'Morning briefing · 10:00 IST' : 'Evening wrap-up · 18:00 IST';
    const h = document.createElement('h2'); h.id = 'brief-title'; h.textContent = (b.kind === 'morning' ? 'Good morning' : 'Good evening') + (first ? ', ' + first : '');
    const p = document.createElement('p'); p.textContent = b.kind === 'morning' ? 'Review today\'s tasks, assignments and priorities.' : 'Review completed work, what is pending, delivery status and tomorrow\'s priorities.';
    hero.append(sm, h, p); el.append(hero);
    const st = document.createElement('div'); st.className = 'brief-stats';
    const stat = (n, l) => { const d = document.createElement('div'); const v = document.createElement('b'); v.textContent = CO.num(n); d.append(v, l); st.append(d); };
    stat(b.overdue.length, 'overdue'); stat(b.today.length, 'due today');
    if (b.kind === 'evening') { stat(CO.sumQty(b.delivered), 'delivered today'); stat(b.tomorrow.length, 'due tomorrow'); } else { stat(b.unassigned.length, 'unassigned'); stat(b.review.length, 'pending approval'); }
    el.append(st);
    const list = (title, rs, max) => {
      if (!rs.length) return;
      const box = document.createElement('div'); box.className = 'brief-list';
      const hh = document.createElement('h3'); hh.textContent = title + ' · ' + rs.length; box.append(hh);
      const ul = document.createElement('ul');
      rs.slice(0, max || 5).forEach((r) => { const li = document.createElement('li'); const a = document.createElement('span'); a.textContent = r.brand + ' · ' + CO.topicText(r); const z = document.createElement('span'); z.textContent = (r.list.join(', ') || 'Unassigned') + ' · ' + (r.eta ? CO.fmtDate(r.eta) : 'No ETA'); li.append(a, z); li.addEventListener('click', () => { BR.dlg.close(); document.dispatchEvent(new CustomEvent('co-open-task', { detail: r.uid })); }); ul.append(li); });
      box.append(ul); el.append(box);
    };
    if (b.me) { list('Your overdue work', b.mine.filter((r) => r.due === 'overdue')); list('Yours, due today', b.mine.filter((r) => r.due === 'today')); if (b.kind === 'evening') list('Yours, due tomorrow', b.mine.filter((r) => r.eta === CO.addDays(CO.today(), 1))); }
    if (b.actions.length) { const box = document.createElement('div'); box.className = 'brief-list'; const hh = document.createElement('h3'); hh.textContent = 'Your action items from notes · ' + b.actions.length; const ul = document.createElement('ul'); b.actions.slice(0, 6).forEach((a) => { const li = document.createElement('li'); const x = document.createElement('span'); x.textContent = a.text; const y = document.createElement('span'); y.textContent = a.note + (a.due ? ' · ' + CO.fmtDate(a.due) : ''); li.append(x, y); li.addEventListener('click', () => { BR.dlg.close(); dash.setParams({ tab: 'notes' }); NB.select(a.noteId); }); ul.append(li); }); box.append(hh, ul); el.append(box); }
    list('Team: overdue', b.overdue);
    if (b.kind === 'morning') list('Team: due today', b.today); else { list('Delivered today', b.delivered); list('Team: due tomorrow', b.tomorrow); }
  });
  function openBriefing(kind) { BR.kind = kind || briefKind() || 'morning'; dash.draw('brief-body'); if (BR.dlg.showModal && !BR.dlg.open) BR.dlg.showModal(); NT.markRead('brief-' + BR.kind + '-' + CO.today()); }
  document.getElementById('brief-close').addEventListener('click', () => BR.dlg.close());
  document.getElementById('brief-go').addEventListener('click', () => { BR.dlg.close(); CO.goTasks(BR.kind === 'morning' ? 'overdue' : 'open', myDesigner() ? { designer: myDesigner() } : {}); });
  /* Overview card: today's briefing, until dismissed. */
  dash.draw('brief-card', (el) => {
    const k = briefKind(), key = k && k + '-' + CO.today();
    el.replaceChildren();
    if (!k || A.mode !== 'auth' || !A.user || CO.status() !== 'ok' || LS.get('co.briefDismissed', '') === key) return;
    const b = briefing(k); if (!b) return;
    const ico = document.createElement('span'); ico.className = 'bc-ico'; ico.append(svgIcon(k === 'morning' ? ICONS.sun : ICONS.moon));
    const tx = document.createElement('div'); const t = document.createElement('div'); t.className = 'bc-t'; t.textContent = k === 'morning' ? 'Your morning briefing is ready' : 'Your evening wrap-up is ready';
    const s2 = document.createElement('div'); s2.className = 'bc-s';
    const bits = k === 'morning' ? [[b.overdue.length, 'overdue'], [b.today.length, 'due today'], [b.unassigned.length, 'unassigned']] : [[CO.sumQty(b.delivered), 'delivered today'], [b.overdue.length, 'overdue'], [b.tomorrow.length, 'due tomorrow']];
    bits.forEach(([n, l], i) => { const x = document.createElement('b'); x.textContent = CO.num(n); s2.append(i ? ' · ' : '', x, ' ' + l); });
    if (b.me && b.mine.length) s2.append(' · ', Object.assign(document.createElement('b'), { textContent: CO.num(b.mine.length) }), ' with you');
    tx.append(t, s2);
    const act = document.createElement('div'); act.className = 'bc-act';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'co-btn primary'; open.textContent = 'Open briefing'; open.addEventListener('click', () => openBriefing(k));
    const no = document.createElement('button'); no.type = 'button'; no.className = 'co-btn'; no.textContent = 'Dismiss'; no.addEventListener('click', () => { LS.set('co.briefDismissed', key); el.replaceChildren(); });
    act.append(open, no); el.append(ico, tx, act);
  });

  /* Notification centre: briefings, access requests, note reminders, action items, mentions. */
  const NT = (() => {
    const panel = document.getElementById('np');
    let seen = []; try { seen = JSON.parse(LS.get('co.seen', '[]')) || []; } catch (e) { seen = []; }
    const save = () => LS.set('co.seen', JSON.stringify(seen.slice(-400)));
    const items = () => {
      if (A.mode !== 'auth' || !A.user) return [];
      const out = [], t = CO.today(), nowLocal = istNowKey();
      const k = briefKind();
      if (k === 'evening' || k === 'morning') out.push({ id: 'brief-morning-' + t, icon: 'sun', tone: 'lime', t: 'Morning briefing', s: REMIND_AT.label.morning + ' IST · today\'s tasks, assignments and priorities', go: () => openBriefing('morning') });
      if (k === 'evening') out.unshift({ id: 'brief-evening-' + t, icon: 'moon', tone: 'lime', t: 'Evening wrap-up', s: REMIND_AT.label.evening + ' IST · completed, pending and tomorrow', go: () => openBriefing('evening') });
      // Tasks: your own deadlines (or, for admins, the team totals), and new requirements nobody has picked up.
      const all = CO.status() === 'ok' ? CO.rows(true) : null;
      if (all) {
        const me = myDesigner(), tm = CO.addDays(t, 1);
        const openTask = (r) => () => document.dispatchEvent(new CustomEvent('co-open-task', { detail: r.uid }));
        if (me) {
          all.filter((r) => r.open && r.list.includes(me) && r.due === 'overdue').slice(0, 6).forEach((r) => out.push({ id: 'od-' + r.uid + '-' + t, icon: 'clock', tone: 'bad', t: 'Overdue: ' + r.brand + ' · ' + CO.topicText(r), s: (r.id || '') + ' · ' + CO.diffDays(r.eta, t) + 'd late · ' + r.stage, go: openTask(r) }));
          all.filter((r) => r.open && r.list.includes(me) && (r.eta === t || r.eta === tm)).slice(0, 6).forEach((r) => out.push({ id: 'due-' + r.uid + '-' + r.eta, icon: 'cal', tone: 'warn', t: (r.eta === t ? 'Due today: ' : 'Due tomorrow: ') + r.brand + ' · ' + CO.topicText(r), s: (r.id || '') + ' · ' + r.type + ' · ' + r.stage, go: openTask(r) }));
        }
        if (can('Admin') || !me) {
          const od = all.filter((r) => r.due === 'overdue').length, dt = all.filter((r) => r.due === 'today').length;
          if (od) out.push({ id: 'team-od-' + t + '-' + od, icon: 'clock', tone: 'bad', t: od + ' tasks overdue across the team', s: 'Oldest ' + Math.max(...all.filter((r) => r.due === 'overdue').map((r) => CO.diffDays(r.eta, t))) + ' days late', go: () => CO.goTasks('overdue', { designer: '' }) });
          if (dt) out.push({ id: 'team-dt-' + t + '-' + dt, icon: 'cal', tone: 'warn', t: dt + ' tasks due today', s: 'Across the team', go: () => CO.goTasks('today', { designer: '' }) });
        }
        const fresh = all.filter((r) => r.open && r.req && r.req >= CO.addDays(t, -1));
        if (fresh.length) { const un = fresh.filter((r) => !r.list.length).length; out.push({ id: 'new-' + t + '-' + fresh.length, icon: 'plus', tone: 'violet', t: fresh.length + ' new requirement' + (fresh.length === 1 ? '' : 's') + ' since yesterday', s: un ? un + ' not assigned yet' : 'All assigned', go: () => CO.goTasks('open', un ? { designer: '__none' } : {}) }); }
      }
      // Team updates from the activity log: task status and detail changes made by others, team list changes.
      FD.entries.forEach((e) => {
        const task = all && e.record ? all.find((r) => r.id === e.record) : null;
        const who = e.who.includes('@') ? e.who.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Someone';
        const what = /^Task|^Sheet/.test(e.action) ? (e.field ? e.field + ': ' + (e.before || '(blank)') + ' → ' + (e.after || '(blank)') : e.action) : e.action + (e.field ? ' · ' + e.field : '');
        out.push({ id: 'fd-' + e.when + '-' + e.record + '-' + e.field, icon: /^Team/.test(e.action) ? 'user' : 'edit', tone: '', t: who + ' updated ' + (e.record || e.sheet || 'a record'), s: what.slice(0, 90) + ' · ' + agoText(e.when), go: task ? () => document.dispatchEvent(new CustomEvent('co-open-task', { detail: task.uid })) : () => dash.setParams({ tab: can('Admin') ? 'access' : 'tasks' }) });
      });
      // Meetings starting within 15 minutes (connected Google Calendar).
      (CAL.events || []).forEach((ev) => { const m = (new Date(ev.start) - Date.now()) / 60000; if (m <= 15 && m > -5) out.unshift({ id: 'mtg-' + ev.id + '-' + ev.start, icon: 'video', tone: 'lime', t: (m > 0 ? 'Starts ' + untilText(ev.start) + ': ' : 'Now: ') + ev.title, s: fmtRange(ev.start, ev.end) + (ev.people.length ? ' · ' + ev.people.length + ' people' : ''), go: () => { if (ev.meet) window.open(ev.meet, '_blank', 'noopener'); else dash.setParams({ tab: 'today' }); } }); });
      if (can('Admin') && AX.pending) out.unshift({ id: 'access-' + AX.pending + '-' + t, icon: 'user', tone: 'violet', t: AX.pending + (AX.pending === 1 ? ' access request' : ' access requests') + ' waiting', s: 'Approve or reject on the Access page', go: () => dash.setParams({ tab: 'access' }) });
      NB.notes.forEach((n) => {
        if (n.reminder && n.reminder <= nowLocal && n.reminder.slice(0, 10) >= CO.addDays(t, -2) && (n.createdBy === A.user.email || (n.actions || []).some((a) => !a.done && a.email === A.user.email))) out.unshift({ id: 'rem-' + n.id + '-' + n.reminder, icon: 'bell', tone: 'bad', t: 'Reminder: ' + n.title, s: CO.istDateTime(n.reminder + ':00+05:30') + (n.followUps ? ' · ' + n.followUps.slice(0, 60) : ''), go: () => { dash.setParams({ tab: 'notes' }); NB.select(n.id); } });
        (n.actions || []).forEach((a) => { if (!a.done && a.email === A.user.email && (!a.due || a.due <= CO.addDays(t, 1))) out.push({ id: 'act-' + n.id + '-' + a.id + '-' + (a.due || ''), icon: 'check', tone: a.due && a.due < t ? 'bad' : '', t: a.text, s: 'Action item · ' + n.title + (a.due ? ' · due ' + CO.fmtDate(a.due) : ''), go: () => { dash.setParams({ tab: 'notes' }); NB.select(n.id); } }); });
        if (n.createdBy !== A.user.email && (n.mentions || []).some((m) => m.email === A.user.email) && n.updatedAt && Date.now() - new Date(n.updatedAt) < 3 * 864e5) out.push({ id: 'men-' + n.id + '-' + n.updatedAt, icon: 'at', tone: 'violet', t: (n.createdByName || n.createdBy) + ' mentioned you', s: n.title, go: () => { dash.setParams({ tab: 'notes' }); NB.select(n.id); } });
      });
      return out;
    };
    const unread = () => items().filter((i) => !seen.includes(i.id)).length;
    const markRead = (id) => { if (!seen.includes(id)) { seen.push(id); save(); syncControls(); dash.draw('np-list'); } };
    dash.draw('np-list', (el) => {
      el.replaceChildren(); const list = items();
      if (!list.length) { const e = document.createElement('p'); e.className = 'np-empty'; e.textContent = 'You are all caught up.'; el.append(e); return; }
      list.forEach((i) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'np-item' + (seen.includes(i.id) ? '' : ' unread');
        const ic = document.createElement('span'); ic.className = 'np-ico ' + (i.tone || ''); ic.append(svgIcon(ICONS[i.icon]));
        const tx = document.createElement('span'); const a = document.createElement('div'); a.className = 'np-t'; a.textContent = i.t; const z = document.createElement('div'); z.className = 'np-s'; z.textContent = i.s; tx.append(a, z);
        b.append(ic, tx); b.addEventListener('click', () => { markRead(i.id); close(); i.go(); }); el.append(b);
      });
    });
    const desk = document.getElementById('np-desktop'), mail = document.getElementById('np-email');
    const privacy = document.getElementById('np-privacy');
    const close = () => { panel.hidden = true; document.getElementById('btn-bell').setAttribute('aria-expanded', 'false'); };
    const toggle = () => {
      if (!panel.hidden) return close();
      panel.hidden = false; document.getElementById('btn-bell').setAttribute('aria-expanded', 'true');
      desk.checked = LS.get('co.desktop', '') === '1' && 'Notification' in window && Notification.permission === 'granted';
      desk.disabled = !('Notification' in window);
      mail.checked = !A.user || A.user.reminders !== false;
      privacy.hidden = !PRS.on;
      dash.draw('np-list');
    };
    document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target) && !e.target.closest('#btn-bell')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });
    document.getElementById('np-read').addEventListener('click', () => { items().forEach((i) => { if (!seen.includes(i.id)) seen.push(i.id); }); save(); dash.draw('np-list'); syncControls(); });
    desk.addEventListener('change', async () => {
      if (!desk.checked) { LS.set('co.desktop', null); return; }
      const perm = await Notification.requestPermission();
      if (perm === 'granted') { LS.set('co.desktop', '1'); toast('Desktop alerts on: 10:00 and 18:00 IST, and note reminders, while the dashboard is open in a tab.'); }
      else { desk.checked = false; toast('Your browser blocked notifications for this site. Allow them in the site settings to turn this on.', true); }
    });
    mail.addEventListener('change', async () => {
      try { const r = await post({ action: 'prefs', reminders: mail.checked }); A.user.reminders = r.reminders; toast(mail.checked ? 'You will get the 10:00 and 18:00 IST briefings by email.' : 'Daily briefing emails turned off.'); }
      catch (err) { mail.checked = !mail.checked; toast('Not saved: ' + err.message + '. The web app may need the latest Code.gs.', true); }
    });
    /* Every 30 s: at 10:00 and 18:00 IST show the briefing (and a desktop alert); note reminders when due. */
    const alerted = new Set((LS.get('co.alerted', '') || '').split('|').filter(Boolean));
    const alertOnce = (id, title, body, onClick) => {
      if (alerted.has(id)) return false; alerted.add(id); LS.set('co.alerted', [...alerted].slice(-200).join('|'));
      if (LS.get('co.desktop', '') === '1' && 'Notification' in window && Notification.permission === 'granted') {
        try { const n = new Notification(title, { body, icon: 'assets/logo.svg', tag: id }); n.onclick = () => { window.focus(); onClick(); n.close(); }; } catch (e) { /* some browsers only allow this from a service worker */ }
      }
      return true;
    };
    const tick = () => {
      if (A.mode !== 'auth' || !A.user || CO.status() !== 'ok') return;
      const k = briefKind(), key = k && 'brief-' + k + '-' + CO.today();
      if (k && istMins() < REMIND_AT[k] + 180 && alertOnce(key, k === 'morning' ? 'Morning briefing' : 'Evening wrap-up', k === 'morning' ? 'Review today\'s tasks, assignments and priorities.' : 'Review completed work, pending tasks and tomorrow\'s priorities.', () => openBriefing(k))) {
        toast(k === 'morning' ? 'Good morning. Your 10:00 briefing is ready.' : 'Your 18:00 wrap-up is ready.');
        if (document.visibilityState === 'visible') openBriefing(k);
      }
      items().filter((i) => /^(rem|mtg)-/.test(i.id)).forEach((i) => { if (alertOnce(i.id, i.t, i.s, i.go)) toast(i.t); });
      syncControls(); dash.draw('brief-card');
    };
    setInterval(tick, 30 * 1000);
    return { unread, markRead, toggle, close, tick };
  })();
  function istNowKey() { const o = CO.istParts(); return o.year + '-' + o.month + '-' + o.day + 'T' + o.hour + ':' + o.minute; }

  /* ================= Notes: a shared notebook ================= */
  const NB = (() => {
    const $n = (id) => document.getElementById(id);
    const form = $n('nb-form'), empty = $n('nb-empty'), wrap = document.querySelector('.nb'), paper = $n('nb-paper');
    const st = { notes: [], people: [], loaded: false, loading: false, cur: null, dirty: false, q: '', chip: 'all', brand: '', cat: '' };
    const me = () => (A.user ? A.user.email : '');
    const nameOf2 = (email) => { const p = st.people.find((x) => x.email === email); return p && p.name ? p.name : (A.user && email === A.user.email ? A.user.name || email : email); };
    /* People you can mention or assign: everyone with access, plus the team list (designers without an account). */
    const norm = (x) => String(x || '').toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const people = () => {
      // One entry per person: a team-list name joined to the dashboard account it belongs to (same name,
      // email like firstname.lastname@, or the only account with that first name).
      const users = st.people.map((p) => ({ name: p.name || '', email: p.email, local: norm(p.email.split('@')[0]) }));
      const used = new Set(), out = [];
      (S.team || []).filter((m) => m.status !== 'Inactive').forEach((m) => {
        const n = norm(m.name), f = n.split(' ')[0];
        const firsts = users.filter((u) => norm(u.name || u.local).split(' ')[0] === f);
        const u = users.find((x) => norm(x.name) === n || x.local === n) || (firsts.length === 1 ? firsts[0] : null);
        if (u && !used.has(u.email)) { used.add(u.email); out.push({ name: m.name, email: u.email }); } else out.push({ name: m.name, email: '' });
      });
      users.forEach((u) => { if (!used.has(u.email)) out.push({ name: u.name || u.email, email: u.email }); });
      return out.sort((a, b) => a.name.localeCompare(b.name));
    };
    async function load(force) {
      if (A.mode !== 'auth' || !A.user || st.loading || (st.loaded && !force)) return;
      st.loading = true;
      try {
        const [n, d] = await Promise.all([callApi({ action: 'notes' }), st.people.length && !force ? Promise.resolve({ ok: true, people: st.people }) : callApi({ action: 'directory' })]);
        if (n.ok) { st.notes = n.notes; st.loaded = true; }
        if (d.ok) st.people = d.people;
      } catch (e) { if (!(e instanceof AuthLost)) toast('Notes could not load: ' + e.message + '. The web app may need the latest Code.gs.', true); }
      st.loading = false;
      fillFilters(); dash.draw('nb-list'); dash.draw('nb-chips'); syncControls(); dash.draw('np-list');
    }
    const open = () => { if (!st.loaded) load(); };
    setInterval(() => { if (A.mode === 'auth' && A.user && !st.dirty && !pendingOps && !pendingDel.size) load(true); }, 2 * 60 * 1000);

    /* ---- list ---- */
    const CHIPS = [['all', 'All'], ['mine', 'Mine'], ['shared', 'Shared with me'], ['Meeting', 'Meetings'], ['Personal', 'Personal'], ['actions', 'Open actions']];
    dash.draw('nb-chips', (el) => {
      el.replaceChildren(...CHIPS.map(([k, l]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.setAttribute('aria-pressed', String(st.chip === k)); b.addEventListener('click', () => { st.chip = k; dash.draw('nb-chips'); dash.draw('nb-list'); }); return b; }));
    });
    const filtered = () => st.notes.filter((n) => {
      if (st.chip === 'mine' && n.createdBy !== me()) return false;
      if (st.chip === 'shared' && n.createdBy === me()) return false;
      if ((st.chip === 'Meeting' || st.chip === 'Personal') && (st.chip === 'Meeting' ? n.type === 'Personal' : n.type !== 'Personal')) return false;
      if (st.chip === 'actions' && !(n.actions || []).some((a) => !a.done)) return false;
      if (st.brand && n.brand !== st.brand) return false;
      if (st.cat && n.category !== st.cat) return false;
      if (st.q) { const hay = [n.title, n.body, n.brand, n.category, n.followUps, n.createdByName, (n.mentions || []).map((m) => m.name).join(' '), (n.actions || []).map((a) => a.text + ' ' + a.assignee).join(' ')].join(' ').toLowerCase(); if (!st.q.split(/\s+/).every((w) => hay.includes(w))) return false; }
      return true;
    });
    const groupOf = (n) => {
      const t = CO.today(), d = n.date || (n.createdAt || '').slice(0, 10);
      if (n.pinned) return 'Pinned';
      if (d === t) return 'Today'; if (d === CO.addDays(t, -1)) return 'Yesterday';
      if (d > CO.addDays(t, -7)) return 'This week';
      return CO.fmtMonth(d.slice(0, 7), true);
    };
    /* The board: every note is a sticky, coloured by type (meeting violet, discussion sun glare, personal orange),
       grouped by when it is from. Open one and the board becomes a narrow stack beside the notebook. */
    /* The board: stickies coloured by kind (meeting violet, idea lime, personal orange; stand-ups cream with lime tape),
       pinned ones first, in a masonry layout. To-dos tick right on the sticky; pin and delete sit on hover. */
    const tilt = (id) => { let h = 0; String(id).split('').forEach((c) => { h = (h * 31 + c.charCodeAt(0)) | 0; }); return ((Math.abs(h) % 7) - 3) * 0.5; };
    const ICO = { pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/></svg>', del: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>' };
    /* Instant changes: the board updates at once and the save runs in the background. If the web app refuses,
       the change is undone and a message says why. Background refreshes wait while anything is still saving. */
    let pendingOps = 0;
    const named = (note, old) => Object.assign({}, note, { createdByName: (old && old.createdByName) || (A.user && note.createdBy === A.user.email ? A.user.name || A.user.email : note.createdBy), canEdit: true });
    const redraw = () => { fillFilters(); dash.draw('nb-list'); dash.draw('nb-chips'); syncControls(); dash.draw('np-list'); };
    const putLocal = (note) => { const i = st.notes.findIndex((x) => x.id === note.id); if (i >= 0) st.notes[i] = note; else st.notes.unshift(note); };
    const payload = (x) => ({ title: x.title, date: x.date, type: x.type, brand: x.brand, category: x.category, visibility: x.visibility, sharedWith: x.sharedWith || [], mentions: x.mentions || [], body: x.body, actions: (x.actions || []).filter((a) => String(a.text || '').trim()), reminder: x.reminder || '', followUps: x.followUps || '', pinned: !!x.pinned });
    async function bg(fn, undo, what) {
      pendingOps++;
      try { await fn(); } catch (err) { if (!(err instanceof AuthLost)) { undo(); redraw(); toast(what + ' not saved: ' + (/stale/.test(err.message) ? 'someone else changed this note; reopen it to see their version.' : err.message), true); } }
      pendingOps--;
    }
    async function quickSave(n, patch) {
      const before = Object.assign({}, n); Object.assign(n, patch); redraw();
      bg(async () => { const r = await post({ action: 'noteSave', id: n.id, updatedAt: n.updatedAt, note: payload(n) }); if (r.note) putLocal(named(r.note, n)); redraw(); }, () => putLocal(before), 'Change');
    }
    // Delete: gone at once, with Undo for 5 seconds; the web app is told after that (or straight away if the page closes).
    const pendingDel = new Map();
    function softDelete(n) {
      const i = st.notes.findIndex((x) => x.id === n.id); if (i < 0) return;
      st.notes.splice(i, 1); redraw();
      const send = () => { if (!pendingDel.has(n.id)) return; pendingDel.delete(n.id); bg(() => post({ action: 'noteDelete', id: n.id }), () => { st.notes.splice(Math.min(i, st.notes.length), 0, n); }, 'Delete'); };
      pendingDel.set(n.id, send);
      toast('Note deleted', false, { label: 'Undo', fn: () => { pendingDel.delete(n.id); st.notes.splice(Math.min(i, st.notes.length), 0, n); redraw(); }, onTimeout: send });
      setTimeout(send, 5200);
    }
    window.addEventListener('pagehide', () => { pendingDel.forEach((send, id) => { try { fetch(A.url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ session: A.session, action: 'noteDelete', id }) }); } catch (e) { /* best effort */ } }); });
    const card = (n) => {
      const type = String(n.type || 'Meeting'), standup = /stand-?up/i.test(n.category || '') || /stand-?up/i.test(n.title || '');
      const b = document.createElement('div'); b.className = 'nb-item sticky t-' + type.toLowerCase() + (standup ? ' t-standup' : '') + (n.pinned ? ' pinned' : '');
      b.dataset.id = n.id; b.tabIndex = 0; b.setAttribute('role', 'button'); b.setAttribute('aria-label', 'Open note: ' + (n.title || 'Untitled'));
      b.style.setProperty('--tilt', tilt(n.id) + 'deg'); b.setAttribute('aria-current', String(!!st.cur && st.cur.id === n.id));
      const deco = document.createElement('span'); deco.className = n.pinned ? 'st-pin' : 'st-tape'; deco.setAttribute('aria-hidden', 'true');
      const top = document.createElement('div'); top.className = 'st-top';
      const kind = document.createElement('span'); kind.className = 'st-kind'; kind.textContent = (standup ? 'Stand-up' : type === 'Discussion' ? 'Idea' : type) + ' · ' + CO.fmtDate(n.date);
      top.append(kind);
      if (n.canEdit) {
        const tools = document.createElement('span'); tools.className = 'st-tools';
        const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'st-tool' + (n.pinned ? ' on' : ''); pin.innerHTML = ICO.pin; pin.title = n.pinned ? 'Unpin' : 'Pin to the top'; pin.setAttribute('aria-label', pin.title);
        pin.addEventListener('click', (e) => { e.stopPropagation(); quickSave(n, { pinned: !n.pinned }); });
        const del = document.createElement('button'); del.type = 'button'; del.className = 'st-tool'; del.innerHTML = ICO.del; del.title = 'Delete'; del.setAttribute('aria-label', 'Delete note');
        del.addEventListener('click', (e) => { e.stopPropagation(); softDelete(n); });
        tools.append(pin, del); top.append(tools);
      }
      const t = document.createElement('span'); t.className = 'st-title t'; t.textContent = n.title || 'Untitled';
      const body = (n.body || '').replace(/\n{2,}/g, '\n').trim();
      b.append(deco, top, t);
      if (body) { const s2 = document.createElement('span'); s2.className = 'st-body s'; s2.textContent = body; b.append(s2); }
      const acts = n.actions || [];
      if (acts.length) {
        const ul = document.createElement('ul'); ul.className = 'st-todo';
        acts.slice(0, 5).forEach((x) => {
          const li = document.createElement('li'); li.className = x.done ? 'done' : '';
          const box = document.createElement('button'); box.type = 'button'; box.className = 'st-box'; box.setAttribute('role', 'checkbox'); box.setAttribute('aria-checked', String(!!x.done)); box.setAttribute('aria-label', (x.done ? 'Mark not done: ' : 'Mark done: ') + x.text);
          const canTick = n.canEdit || (A.user && x.email === A.user.email);
          box.disabled = !canTick;
          box.addEventListener('click', (e) => { e.stopPropagation(); if (n.pending) return; x.done = !x.done; redraw(); if (x.done && n.actions.every((y) => y.done)) toast('All to-dos done on "' + (n.title || 'note') + '"'); bg(async () => { const r = await post({ action: 'noteAction', id: n.id, actionId: x.id, done: x.done }); n.actions = r.actions; }, () => { x.done = !x.done; }, 'Tick'); });
          const tx = document.createElement('span'); tx.textContent = x.text; if (x.assignee) tx.title = 'For ' + x.assignee + (x.due ? ' · due ' + CO.fmtDate(x.due) : '');
          li.append(box, tx); ul.append(li);
        });
        if (acts.length > 5) { const li = document.createElement('li'); li.className = 'more'; li.textContent = '+' + (acts.length - 5) + ' more'; ul.append(li); }
        b.append(ul);
      }
      const foot = document.createElement('span'); foot.className = 'st-foot m';
      const done = acts.filter((x) => x.done).length;
      if (acts.length && done === acts.length) { const x = document.createElement('span'); x.className = 'st-done'; x.textContent = 'All done'; foot.append(x); }
      else if (acts.length) { const x = document.createElement('span'); x.className = 'st-acts'; x.style.setProperty('--p', (done / acts.length * 100) + '%'); x.textContent = done + '/' + acts.length; x.title = done + ' of ' + acts.length + ' to-dos done'; foot.append(x); }
      if (n.brand) { const x = document.createElement('span'); x.className = 'nb-tag'; x.textContent = n.brand; foot.append(x); }
      if (n.visibility === 'private') { const x = document.createElement('span'); x.className = 'st-lock'; x.textContent = 'Only me'; foot.append(x); }
      const faces = document.createElement('span'); faces.className = 'st-faces';
      [n.createdByName || n.createdBy].concat((n.mentions || []).map((m) => m.name)).filter(Boolean).slice(0, 3).forEach((nm) => { const av = CO.av(nm); av.title = nm; faces.append(av); });
      foot.append(faces); b.append(foot);
      if (n.pending) { b.classList.add('pending'); const sv = document.createElement('span'); sv.className = 'st-saving'; sv.textContent = 'Saving…'; foot.prepend(sv); }
      const go = () => { if (!n.pending) select(n.id); };
      b.addEventListener('click', go); b.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === b) go(); });
      return b;
    };
    dash.draw('nb-list', (el) => {
      el.replaceChildren();
      $n('nb-empty').hidden = !st.loaded || st.notes.length > 0;
      if (!st.loaded) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = st.loading ? 'Loading notes…' : ''; el.append(p); return; }
      const list = filtered().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
      if (!list.length) { if (st.notes.length) { const p = document.createElement('p'); p.className = 'co-note nb-none'; p.textContent = 'No notes match. Clear the search or filters to see them all.'; el.append(p); } return; }
      const block = (title, notes) => { if (!notes.length) return; const h = document.createElement('h3'); h.className = 'nb-group'; h.textContent = title + ' · ' + notes.length; const m = document.createElement('div'); m.className = 'nb-mason'; notes.forEach((n) => m.append(card(n))); el.append(h, m); };
      // One continuous board, pinned first (they carry an orange pin), then newest first: no half-empty rows.
      const m = document.createElement('div'); m.className = 'nb-mason';
      list.filter((n) => n.pinned).concat(list.filter((n) => !n.pinned)).forEach((n) => m.append(card(n)));
      el.append(m);
    });
    /* Quick capture: type, press Enter, done. First line = title; lines starting with [] or - [ ] become to-dos for you. */
    let qType = 'Meeting';
    const qWho = () => { $n('nb-quick-who').textContent = qType === 'Personal' ? 'Only you can see it' : 'Visible to everyone'; };
    document.querySelectorAll('[data-qt]').forEach((b2) => b2.addEventListener('click', () => { qType = b2.dataset.qt; document.querySelectorAll('[data-qt]').forEach((x) => x.setAttribute('aria-checked', String(x === b2))); $n('nb-quick').dataset.type = qType.toLowerCase(); qWho(); $n('nb-quick-text').focus(); }));
    $n('nb-quick').dataset.type = 'meeting';
    async function quickAdd() {
      const box = $n('nb-quick-text'), raw = box.value.trim(); if (!raw) { box.focus(); return; }
      const lines = raw.split('\n'), todo = /^\s*(?:-\s*)?\[\s?\]\s*/, me2 = A.user ? A.user.name || A.user.email : '';
      const mk = (text) => ({ id: 'a' + Math.random().toString(36).slice(2, 8), text, assignee: me2, email: A.user ? A.user.email : '', due: '', done: false });
      const title = lines[0].replace(todo, '').slice(0, 160), actions = [], body = [];
      if (todo.test(lines[0])) actions.push(mk(title));
      lines.slice(1).forEach((l) => { if (todo.test(l)) { const t2 = l.replace(todo, '').trim(); if (t2) actions.push(mk(t2)); } else body.push(l); });
      const temp = { id: 'tmp-' + Date.now(), pending: true, title, date: CO.today(), type: qType, brand: '', category: '', visibility: qType === 'Personal' ? 'private' : 'team', sharedWith: [], mentions: [], body: body.join('\n').trim(), actions, reminder: '', followUps: '', pinned: false, canEdit: true, createdBy: A.user ? A.user.email : '', createdByName: me2, updatedAt: '' };
      st.notes.unshift(temp); box.value = ''; box.style.height = ''; box.focus(); redraw();
      bg(async () => { const r = await post({ action: 'noteSave', note: payload(temp) }); const i = st.notes.indexOf(temp); const real = r.note ? named(r.note, temp) : Object.assign({}, temp, { id: r.id, pending: false }); if (i >= 0) st.notes[i] = real; else putLocal(real); redraw(); },
        () => { const i = st.notes.indexOf(temp); if (i >= 0) st.notes.splice(i, 1); if (!box.value) box.value = raw; }, 'Sticky');
    }
    $n('nb-quick').addEventListener('submit', (e) => { e.preventDefault(); quickAdd(); });
    // Full editor: carries over what was typed and the chosen kind.
    $n('nb-quick-full').addEventListener('click', () => {
      const raw = $n('nb-quick-text').value; startNew(qType === 'Personal' ? 'personal' : 'blank');
      if (st.cur) { const [first, ...rest] = raw.split('\n'); st.cur.type = qType; st.cur.title = (first || '').trim(); st.cur.body = rest.join('\n'); if (qType !== 'Personal') st.cur.visibility = 'team'; show(); st.dirty = !!raw.trim(); $n('nb-quick-text').value = ''; $n(raw.trim() ? 'nb-body' : 'nb-title').focus(); }
    });
    $n('nb-quick-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); quickAdd(); } });
    $n('nb-quick-text').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(220, e.target.scrollHeight) + 'px'; });
    // Kind chips in the open note
    const paintChips = () => { const ty = st.cur ? st.cur.type : ''; document.querySelectorAll('[data-tt]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.tt === ty))); paper.dataset.type = String(ty || 'Meeting').toLowerCase(); };
    document.querySelectorAll('[data-tt]').forEach((b2) => b2.addEventListener('click', () => { if (!st.cur || !st.cur.canEdit) return; $n('nb-type').value = b2.dataset.tt; $n('nb-type').dispatchEvent(new Event('change')); paintChips(); }));
    $n('nb-scrim').addEventListener('click', () => $n('nb-back').click());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.cur && !document.querySelector('dialog[open]') && $n('nb-pop').hidden) $n('nb-back').click(); });
    function fillFilters() {
      const fill = (sel, label, vals) => { const cur = sel.value; sel.replaceChildren(new Option(label, ''), ...vals.map((v) => new Option(v, v))); sel.value = vals.includes(cur) ? cur : ''; };
      fill($n('nb-f-brand'), 'All brands', [...new Set(st.notes.map((n) => n.brand).filter(Boolean))].sort());
      fill($n('nb-f-cat'), 'All categories', [...new Set(st.notes.map((n) => n.category).filter(Boolean))].sort());
      const brands = new Set((S.tasks || []).map((t) => t.brand).filter(Boolean)); st.notes.forEach((n) => { if (n.brand) brands.add(n.brand); });
      $n('nb-brands').replaceChildren(...[...brands].sort().map((b) => new Option(b)));
    }
    let qt = 0;
    $n('nb-q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { st.q = e.target.value.trim().toLowerCase(); dash.draw('nb-list'); }, 150); });
    $n('nb-f-brand').addEventListener('change', (e) => { st.brand = e.target.value; dash.draw('nb-list'); });
    $n('nb-f-cat').addEventListener('change', (e) => { st.cat = e.target.value; dash.draw('nb-list'); });

    /* ---- editor ---- */
    const confirmDiscard = () => !st.dirty || confirm('Discard your unsaved changes to this note?');
    function select(id) {
      if (st.cur && st.cur.id === id) { wrap.classList.add('editing'); return; }
      if (!st.loaded) { load().then(() => select(id)); return; }
      const n = st.notes.find((x) => x.id === id); if (!n || !confirmDiscard()) return;
      st.cur = JSON.parse(JSON.stringify(n)); st.dirty = false; show();
      const draft = LS.get('co.nbdraft.' + id, ''); if (draft && st.cur.canEdit) { try { const d = JSON.parse(draft); if (d.updatedAt === n.updatedAt && confirm('You have unsaved changes to this note from earlier. Restore them?')) { Object.assign(st.cur, d.note); st.dirty = true; show(); } else LS.set('co.nbdraft.' + id, null); } catch (e) { LS.set('co.nbdraft.' + id, null); } }
    }
    function startNew(tpl) {
      if (!confirmDiscard()) return;
      if (dash.params().tab !== 'notes') dash.setParams({ tab: 'notes' });
      const t = CO.today(), n = { id: null, title: '', date: t, type: 'Meeting', brand: '', category: '', visibility: 'people', sharedWith: [], mentions: [], body: '', actions: [], reminder: '', followUps: '', pinned: false, canEdit: true, createdBy: me() };
      if (tpl === 'standup') {
        Object.assign(n, { title: 'Daily stand-up · ' + CO.fmtDate(t, true), category: 'Stand-up', visibility: 'team' });
        const all = CO.rows(true) || [];
        const late = all.filter((r) => r.due === 'overdue').sort((a, b) => a.eta.localeCompare(b.eta)).slice(0, 6);
        const un = all.filter((r) => r.open && !r.list.length).length;
        n.body = 'Attendees: \n\nUpdates\n• \n\nBlockers\n• \n\nDecisions\n• \n' + (late.length ? '\nOverdue right now (' + all.filter((r) => r.due === 'overdue').length + ')\n' + late.map((r) => '• ' + r.brand + ' · ' + CO.topicText(r) + ' (' + (r.list.join(', ') || 'unassigned') + ', ' + CO.diffDays(r.eta, t) + 'd late)').join('\n') + '\n' : '') + (un ? '\nUnassigned: ' + un + ' open tasks\n' : '');
      } else if (tpl === 'personal') Object.assign(n, { type: 'Personal', visibility: 'private', title: '' });
      st.cur = n; st.dirty = false; show(); $n('nb-title').focus();
      const d = LS.get('co.nbdraft.new', ''); if (d && tpl === 'blank') { try { const x = JSON.parse(d); if (x.note && (x.note.title || x.note.body) && confirm('Restore the new note you were writing earlier?')) { Object.assign(st.cur, x.note); st.dirty = true; show(); } else LS.set('co.nbdraft.new', null); } catch (e) { LS.set('co.nbdraft.new', null); } }
    }
    function show() {
      const n = st.cur;
      empty.hidden = !st.loaded || st.notes.length > 0; form.hidden = !n; wrap.classList.toggle('editing', !!n); $n('nb-scrim').hidden = !n; document.body.classList.toggle('nb-open', !!n); dash.draw('nb-list');
      if (!n) return;
      paintChips(); $n('nb-details').open = !n.id ? false : $n('nb-details').open;
      const ro = !n.canEdit; paper.classList.toggle('readonly', ro);
      $n('nb-title').value = n.title; $n('nb-date').value = n.date || ''; $n('nb-type').value = n.type; $n('nb-brand').value = n.brand || ''; $n('nb-cat').value = n.category || ''; $n('nb-vis').value = n.visibility;
      $n('nb-body').value = n.body || ''; $n('nb-follow').value = n.followUps || ''; $n('nb-remind').value = n.reminder || '';
      ['nb-title', 'nb-date', 'nb-type', 'nb-brand', 'nb-cat', 'nb-vis', 'nb-body', 'nb-follow', 'nb-remind', 'nb-share-add'].forEach((id) => { $n(id).disabled = ro; });
      $n('nb-save').hidden = ro; $n('nb-delete').hidden = ro || !n.id; $n('nb-add-action').hidden = ro; $n('nb-pin').disabled = ro;
      $n('nb-pin').setAttribute('aria-pressed', String(!!n.pinned));
      renderShare(); renderMentions(); renderActions(); renderFoot(); status();
      dash.draw('nb-list');
    }
    const status = (text) => { const s = $n('nb-status'); s.classList.toggle('dirty', st.dirty); s.textContent = text || (!st.cur ? '' : !st.cur.canEdit ? 'View only · by ' + (st.cur.createdByName || st.cur.createdBy) : st.dirty ? 'Unsaved changes' : st.cur.id ? 'Saved' : 'New note'); };
    function renderFoot() {
      const n = st.cur, f = $n('nb-foot'); f.replaceChildren();
      const add = (lab, who, at) => { const s = document.createElement('span'); s.append(lab + ' '); const b = document.createElement('b'); b.textContent = who; s.append(b, at ? ' · ' + CO.istDateTime(at, true) : ''); f.append(s); };
      if (!n.id) { f.append('Saved to ' + (A.user ? A.user.email : 'your account') + ' when you press Save (Ctrl+S).'); return; }
      add('Written by', n.createdByName || n.createdBy, n.createdAt);
      if (n.updatedAt && n.updatedAt !== n.createdAt) add('Last edited by', n.updatedByName || n.updatedBy, n.updatedAt);
      const v = document.createElement('span'); v.textContent = n.visibility === 'private' ? 'Only the author and admins can see this' : n.visibility === 'team' ? 'Everyone with dashboard access can see this' : 'Visible to the author, people mentioned, added or assigned, and admins'; f.append(v);
    }
    function renderShare() {
      const n = st.cur, row = $n('nb-share'); row.hidden = n.visibility !== 'people';
      const chips = $n('nb-share-chips'); chips.replaceChildren();
      (n.sharedWith || []).forEach((e) => { const c = document.createElement('span'); c.className = 'chip-x'; c.append(nameOf2(e)); if (n.canEdit) { const x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Remove ' + nameOf2(e)); x.textContent = '×'; x.addEventListener('click', () => { n.sharedWith = n.sharedWith.filter((y) => y !== e); touch(); renderShare(); }); c.append(x); } chips.append(c); });
      const sel = $n('nb-share-add'); sel.replaceChildren(new Option('+ Add person', ''), ...st.people.filter((p) => p.email !== n.createdBy && !(n.sharedWith || []).includes(p.email)).map((p) => new Option(p.name || p.email, p.email)));
    }
    $n('nb-share-add').addEventListener('change', (e) => { if (!e.target.value) return; st.cur.sharedWith = (st.cur.sharedWith || []).concat(e.target.value); touch(); renderShare(); });
    function syncMentions() { const body = st.cur.body || ''; st.cur.mentions = people().filter((p) => body.includes('@' + p.name)).map((p) => ({ name: p.name, email: p.email })); renderMentions(); }
    function renderMentions() { const el = $n('nb-mentions'); el.replaceChildren(...(st.cur.mentions || []).map((m) => { const c = document.createElement('span'); c.className = 'mention'; c.append(CO.av(m.name), '@' + m.name); c.title = m.email ? m.email + (st.cur.visibility === 'people' ? ' · can see this note' : '') : 'On the team list (no dashboard account)'; return c; })); }
    function renderActions() {
      const n = st.cur, box = $n('nb-actions'); box.replaceChildren();
      const ppl = people();
      (n.actions || []).forEach((a) => {
        const row = document.createElement('div'); row.className = 'ai' + (a.done ? ' done' : '');
        const chk = document.createElement('button'); chk.type = 'button'; chk.className = 'ai-check'; chk.setAttribute('aria-label', a.done ? 'Mark not done' : 'Mark done'); chk.append(svgIcon(ICONS.check));
        const mine = a.email && a.email === me();
        chk.disabled = !(n.canEdit || mine);
        chk.addEventListener('click', async () => {
          if (n.canEdit && (!n.id || st.dirty)) { a.done = !a.done; a.doneBy = a.done ? me() : ''; touch(); renderActions(); return; }
          try { const r = await post({ action: 'noteAction', id: n.id, actionId: a.id, done: !a.done }); n.actions = r.actions; const saved = st.notes.find((x) => x.id === n.id); if (saved) saved.actions = r.actions; renderActions(); dash.draw('nb-list'); syncControls(); toast(a.done ? 'Reopened' : 'Done ✓'); }
          catch (err) { toast('Not saved: ' + err.message, true); }
        });
        const txt = document.createElement('input'); txt.className = 'ai-text'; txt.value = a.text; txt.placeholder = 'What needs doing'; txt.maxLength = 300; txt.disabled = !n.canEdit;
        txt.addEventListener('input', () => { a.text = txt.value; touch(); });
        const who = document.createElement('select'); who.className = 'co-select'; who.disabled = !n.canEdit; who.setAttribute('aria-label', 'Assigned to');
        who.append(new Option('Unassigned', ''), ...ppl.map((p) => new Option(p.name, p.name)));
        if (a.assignee && !ppl.some((p) => p.name === a.assignee)) who.append(new Option(a.assignee, a.assignee));
        who.value = a.assignee || '';
        who.addEventListener('change', () => { a.assignee = who.value; const p = ppl.find((x) => x.name === who.value); a.email = p ? p.email : ''; touch(); });
        const due = document.createElement('input'); due.type = 'date'; due.className = 'co-input'; due.value = a.due || ''; due.disabled = !n.canEdit; due.setAttribute('aria-label', 'Due');
        due.addEventListener('change', () => { a.due = due.value; touch(); });
        const del = document.createElement('button'); del.type = 'button'; del.className = 'ai-del'; del.textContent = '×'; del.setAttribute('aria-label', 'Remove action item'); del.hidden = !n.canEdit;
        del.addEventListener('click', () => { n.actions = n.actions.filter((x) => x !== a); touch(); renderActions(); });
        row.append(chk, txt, who, due, del); box.append(row);
      });
      if (!(n.actions || []).length) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = n.canEdit ? 'Nothing yet. Add who does what, by when.' : 'No action items.'; box.append(p); }
    }
    $n('nb-add-action').addEventListener('click', () => { st.cur.actions = (st.cur.actions || []).concat({ id: Math.random().toString(36).slice(2, 10), text: '', assignee: '', email: '', due: '', done: false }); touch(); renderActions(); const ins = $n('nb-actions').querySelectorAll('.ai-text'); if (ins.length) ins[ins.length - 1].focus(); });
    let dt = 0;
    function touch() {
      if (!st.cur || !st.cur.canEdit) return;
      st.dirty = true; status();
      clearTimeout(dt); dt = setTimeout(() => { if (st.cur && st.dirty) LS.set('co.nbdraft.' + (st.cur.id || 'new'), JSON.stringify({ updatedAt: st.cur.updatedAt || '', note: st.cur })); }, 400);
    }
    const bind = (id, key, ev) => $n(id).addEventListener(ev || 'input', (e) => { if (!st.cur) return; st.cur[key] = e.target.value; touch(); if (key === 'visibility') { renderShare(); renderFoot(); } });
    bind('nb-title', 'title'); bind('nb-date', 'date', 'change'); bind('nb-type', 'type', 'change'); bind('nb-brand', 'brand'); bind('nb-cat', 'category'); bind('nb-vis', 'visibility', 'change'); bind('nb-follow', 'followUps'); bind('nb-remind', 'reminder', 'change');
    $n('nb-pin').addEventListener('click', () => { if (!st.cur || !st.cur.canEdit) return; st.cur.pinned = !st.cur.pinned; $n('nb-pin').setAttribute('aria-pressed', String(st.cur.pinned)); touch(); });

    /* ---- @mentions ---- */
    const body = $n('nb-body'), pop = $n('nb-pop');
    let mq = null, msel = 0, mlist = [];
    const caretXY = () => {
      const m = document.createElement('div'), cs = getComputedStyle(body);
      ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'border', 'boxSizing', 'whiteSpace', 'wordWrap', 'width'].forEach((k) => { m.style[k] = cs[k]; });
      m.style.position = 'absolute'; m.style.visibility = 'hidden'; m.style.whiteSpace = 'pre-wrap'; m.style.wordWrap = 'break-word'; m.style.width = body.clientWidth + 'px';
      m.textContent = body.value.slice(0, body.selectionStart); const sp = document.createElement('span'); sp.textContent = '​'; m.append(sp);
      body.parentElement.append(m); const x = sp.offsetLeft, y = sp.offsetTop - body.scrollTop + parseFloat(cs.lineHeight); m.remove(); return { x, y };
    };
    const closePop = () => { pop.hidden = true; mq = null; };
    function onBody() {
      st.cur.body = body.value; touch(); syncMentions();
      const before = body.value.slice(0, body.selectionStart), m = before.match(/(^|[\s(])@([^\s@]{0,24}(?: [^\s@]{0,24})?)$/);
      if (!m) return closePop();
      const q = m[2].toLowerCase(); mq = { start: body.selectionStart - m[2].length - 1 };
      mlist = people().filter((p) => p.name.toLowerCase().includes(q) || (p.email || '').startsWith(q)).slice(0, 7);
      if (!mlist.length) return closePop();
      msel = 0; drawPop(); const xy = caretXY(); pop.style.left = Math.min(xy.x, body.clientWidth - 240) + 'px'; pop.style.top = xy.y + 6 + 'px'; pop.hidden = false;
    }
    function drawPop() { pop.replaceChildren(...mlist.map((p, i) => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === msel)); b.append(CO.av(p.name), p.name); const sm = document.createElement('small'); sm.textContent = p.email ? 'has access' : 'team list'; b.append(sm); b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); }); return b; })); }
    function pick(i) {
      const p = mlist[i]; if (!p || !mq) return;
      const v = body.value, end = body.selectionStart, ins = '@' + p.name + ' ';
      body.value = v.slice(0, mq.start) + ins + v.slice(end); const c = mq.start + ins.length; body.setSelectionRange(c, c); closePop();
      st.cur.body = body.value; touch(); syncMentions();
      if (st.cur.visibility === 'private' && p.email) toast('Mentioned ' + p.name + '. Set "Who can see it" to share the note with them.');
    }
    body.addEventListener('input', onBody);
    body.addEventListener('keydown', (e) => {
      if (pop.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); msel = (msel + (e.key === 'ArrowDown' ? 1 : -1) + mlist.length) % mlist.length; drawPop(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(msel); }
      else if (e.key === 'Escape') { e.preventDefault(); closePop(); }
    });
    body.addEventListener('blur', () => setTimeout(closePop, 150));

    /* ---- save / delete ---- */
    async function save() {
      const n = st.cur; if (!n || !n.canEdit) return;
      if (!(n.title || '').trim() && !(n.body || '').trim()) { toast('Give the note a title or some text first.', true); return; }
      const draftKey = 'co.nbdraft.' + (n.id || 'new'), copy = JSON.parse(JSON.stringify(n)), old = n.id ? st.notes.find((x) => x.id === n.id) : null;
      const shown = Object.assign({}, copy, { id: n.id || 'tmp-' + Date.now(), pending: true, createdBy: copy.createdBy || (A.user ? A.user.email : ''), createdByName: (old && old.createdByName) || (A.user ? A.user.name || A.user.email : '') });
      putLocal(shown); st.dirty = false; st.cur = null; show(); redraw();
      bg(async () => {
        const res = await post({ action: 'noteSave', id: copy.id || undefined, updatedAt: copy.updatedAt || undefined, note: payload(copy) });
        LS.set(draftKey, null);
        const i = st.notes.indexOf(shown), real = res.note ? named(res.note, old || shown) : Object.assign({}, shown, { id: res.id, pending: false });
        if (i >= 0) st.notes[i] = real; else putLocal(real); redraw();
      }, () => { const i = st.notes.indexOf(shown); if (i >= 0) { if (old) st.notes[i] = old; else st.notes.splice(i, 1); } LS.set(draftKey, JSON.stringify({ updatedAt: copy.updatedAt, note: copy })); }, 'Note');
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && dash.params().tab === 'notes' && st.cur) { e.preventDefault(); save(); } });
    $n('nb-delete').addEventListener('click', async () => {
      const n = st.cur; if (!n || !n.id) return;
      const saved = st.notes.find((x) => x.id === n.id); st.cur = null; st.dirty = false; LS.set('co.nbdraft.' + n.id, null); show(); if (saved) softDelete(saved);
    });
    $n('nb-back').addEventListener('click', () => { if (!confirmDiscard()) return; st.cur = null; st.dirty = false; show(); });
    document.querySelectorAll('[data-new-note]').forEach((b) => b.addEventListener('click', () => startNew(b.dataset.newNote)));
    window.addEventListener('beforeunload', (e) => { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } });

    const myActions = () => {
      const out = []; if (!A.user) return out;
      st.notes.forEach((n) => (n.actions || []).forEach((a) => { if (a.email === A.user.email) out.push(Object.assign({ note: n.title, noteId: n.id }, a)); }));
      return out;
    };
    return { open, load, select, startNew, myActions, get notes() { return st.notes; } };
  })();
  document.addEventListener('co-open-task', (e) => { const el = document.querySelector('[data-uid="' + CSS.escape(e.detail) + '"]'); if (el) el.click(); else { dash.setParams({ tab: 'tasks', stage: 'all' }); setTimeout(() => { const x = document.querySelector('[data-uid="' + CSS.escape(e.detail) + '"]'); if (x) x.click(); }, 300); } });

  /* ================= Live IST clock (header) ================= */
  (() => {
    const el = document.getElementById('clock'); if (!el) return;
    const digits = el.querySelector('.clk-t'), date = el.querySelector('.clk-d'), ring = el.querySelector('.clk-ring');
    let h24 = LS.get('co.clock24', '') === '1', last = '';
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const parts = () => { const o = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).forEach((p) => { o[p.type] = p.value; }); return o; };
    const paint = () => {
      const o = parts(), H = +o.hour, M = o.minute, S2 = +o.second;
      const hh = h24 ? String(H).padStart(2, '0') : String(H % 12 || 12).padStart(2, '0');
      const txt = hh + ':' + M;
      if (txt !== last) {
        // Each changed digit flips in.
        const prev = last; last = txt;
        digits.replaceChildren(...txt.split('').map((c, i) => { const sp = document.createElement('span'); sp.className = c === ':' ? 'clk-colon' : 'clk-dg'; sp.textContent = c; if (prev && prev[i] !== c && !REDUCED) sp.classList.add('flip'); return sp; }));
        if (!h24) { const ap = document.createElement('span'); ap.className = 'clk-ap'; ap.textContent = H < 12 ? 'AM' : 'PM'; digits.append(ap); }
        date.replaceChildren(Object.assign(document.createElement('b'), { textContent: o.weekday }), ' ' + o.day + ' ' + MON[+o.month - 1]);
        el.setAttribute('aria-label', 'India Standard Time ' + txt + (h24 ? '' : (H < 12 ? ' AM' : ' PM')) + ', ' + o.weekday + ' ' + o.day + ' ' + MON[+o.month - 1]);
      }
      ring.style.setProperty('--s', S2 / 60);
    };
    el.addEventListener('click', () => { h24 = !h24; LS.set('co.clock24', h24 ? '1' : null); last = ''; paint(); toast(h24 ? '24-hour clock' : '12-hour clock'); });
    paint(); setInterval(paint, 1000);
  })();

  /* ================= Admin: reminder and presence settings ================= */
  const ST = { s: null };
  async function loadSettings() {
    if (A.mode !== 'auth' || !can('Admin')) return;
    try { const b = await callApi({ action: 'settings' }); if (b.ok) { ST.s = b.settings; fillSettings(); } } catch (e) { /* older web app */ }
  }
  function fillSettings() {
    const s2 = ST.s; if (!s2) return;
    const $s = (id) => document.getElementById(id);
    $s('st-morning').value = s2.morning; $s('st-evening').value = s2.evening; $s('st-email').checked = !!s2.email; $s('st-presence').checked = s2.presence !== false; $s('st-model').value = s2.model || 'auto';
    $s('st-chat').value = ''; $s('st-chat').placeholder = s2.chat ? 'Connected. Paste a new link to replace it, or clear below.' : 'https://chat.googleapis.com/v1/spaces/…';
    $s('st-chat-clear').hidden = !s2.chat;
  }
  document.getElementById('st-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const $s = (id) => document.getElementById(id), body = { action: 'saveSettings', morning: $s('st-morning').value, evening: $s('st-evening').value, email: $s('st-email').checked, presence: $s('st-presence').checked, model: $s('st-model').value };
    if ($s('st-chat').value.trim()) body.chat = $s('st-chat').value.trim();
    try { const r = await post(body); ST.s = r.settings; fillSettings(); toast('Reminder settings saved. They apply from the next check (within 10 minutes).'); }
    catch (err) { toast('Not saved: ' + err.message, true); }
  });
  document.getElementById('st-chat-clear').addEventListener('click', async () => {
    try { const r = await post({ action: 'saveSettings', chat: '' }); ST.s = r.settings; fillSettings(); toast('Google Chat reminders turned off.'); } catch (err) { toast('Not saved: ' + err.message, true); }
  });

  /* ================= Team activity feed (for the bell) ================= */
  const FD = { entries: [], at: 0 };
  async function loadFeed(force) {
    if (A.mode !== 'auth' || !A.user || (!force && Date.now() - FD.at < 110 * 1000)) return;
    FD.at = Date.now();
    try { const b = await callApi({ action: 'feed' }); if (b.ok) { FD.entries = b.entries || []; syncControls(); dash.draw('np-list'); } } catch (e) { /* older web app */ }
  }
  setInterval(() => { if (document.visibilityState === 'visible') loadFeed(); }, 60 * 1000);

  /* ================= Google Calendar and Meet ================= */
  /*
   * Each person connects their own calendar, read-only, in their own browser (Google's consent screen).
   * The access token stays in this browser tab (session storage, about an hour) and is never sent to the web app.
   */
  const CAL = { token: '', exp: 0, events: null, err: '', busy: false };
  try { const t = JSON.parse(sessionStorage.getItem('co.calToken') || 'null'); if (t && t.exp > Date.now() + 60000) { CAL.token = t.token; CAL.exp = t.exp; } } catch (e) { /* none */ }
  const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
  function calConnect() {
    gis().then(() => {
      if (!google.accounts.oauth2) throw new Error('Google sign-in did not load');
      const client = google.accounts.oauth2.initTokenClient({
        client_id: A.clientId, scope: CAL_SCOPE, hint: A.user ? A.user.email : undefined, prompt: LS.get('co.cal', '') === '1' ? '' : 'consent',
        callback: (r) => {
          if (!r || r.error || !r.access_token) { CAL.err = r && r.error === 'access_denied' ? 'Calendar access was not allowed.' : 'Google Calendar did not connect' + (r && r.error ? ' (' + r.error + ')' : '') + '.'; dash.draw('cal'); return; }
          CAL.token = r.access_token; CAL.exp = Date.now() + (Number(r.expires_in) || 3600) * 1000; CAL.err = '';
          try { sessionStorage.setItem('co.calToken', JSON.stringify({ token: CAL.token, exp: CAL.exp })); } catch (e) { /* ignore */ }
          LS.set('co.cal', '1'); calLoad(true);
        },
        error_callback: (e) => { CAL.err = e && e.type === 'popup_closed' ? '' : 'Google Calendar did not connect. Allow pop-ups for this page and try again.'; dash.draw('cal'); }
      });
      client.requestAccessToken();
    }).catch((e) => { CAL.err = e.message; dash.draw('cal'); });
  }
  // First choice: the web app reads the signed-in person's own calendar, so nobody has to connect anything.
  async function calServer(force) {
    if (A.mode !== 'auth' || CAL.busy || (!force && CAL.via === 'server' && Date.now() - CAL.at < 2 * 60 * 1000)) return;
    CAL.busy = true;
    try {
      const b = await callApi({ action: 'meetings' });
      if (b.ok) { const now = new Date(); CAL.events = (b.events || []).filter((e) => new Date(e.end) > now).map((e) => Object.assign({ allDay: false }, e)); CAL.limited = CAL.events.some((e) => e.limited || /^(Private event|Busy \(details hidden\))$/.test(e.title)); if (CAL.token) { CAL.busy = false; return calLoad(true); } CAL.via = 'server'; CAL.server = true; CAL.err = ''; CAL.at = Date.now(); }
      else { CAL.server = false; CAL.serverErr = b.error || 'error'; }
    } catch (e) { if (e instanceof AuthLost) return; CAL.server = false; CAL.serverErr = 'error'; }
    CAL.busy = false; dash.draw('cal'); syncControls(); dash.draw('np-list');
  }
  async function calLoad(force) {
    if (CAL.via === 'server' && !CAL.token) return calServer(force);
    // When the personal connection expires (about an hour), go back to the automatic copy instead of an empty card.
    if (!CAL.token || CAL.exp < Date.now() + 30000) { CAL.token = ''; if (CAL.via === 'token') { CAL.via = ''; CAL.server = undefined; CAL.events = null; } dash.draw('cal'); return; }
    if (CAL.busy || (!force && CAL.events && Date.now() - CAL.at < 4 * 60 * 1000)) return;
    CAL.busy = true;
    try {
      const now = new Date(), u = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
      u.searchParams.set('timeMin', new Date(now - 60 * 60 * 1000).toISOString()); u.searchParams.set('timeMax', new Date(+now + 3 * 864e5).toISOString());
      u.searchParams.set('singleEvents', 'true'); u.searchParams.set('orderBy', 'startTime'); u.searchParams.set('maxResults', '25');
      const res = await fetch(u.toString(), { headers: { Authorization: 'Bearer ' + CAL.token } });
      if (res.status === 401) { CAL.token = ''; sessionStorage.removeItem('co.calToken'); throw new Error('expired'); }
      if (res.status === 403) {
        // Google says which project and gives the link to switch the API on; keep only a Google Cloud link.
        let msg = ''; try { msg = ((await res.json()).error || {}).message || ''; } catch (e2) { /* no body */ }
        const m = msg.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/apis\/api\/calendar-json\.googleapis\.com\/overview\?project=\d+/);
        CAL.off = true; CAL.enableUrl = m ? m[0] : 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com';
        throw new Error(can('Admin') ? 'The Google Calendar API is switched off in the Google Cloud project, so meetings cannot load. Switch it on, wait a minute, then press Try again.' : 'Meetings will show here once the admin switches on the Google Calendar API.');
      }
      CAL.off = false;
      const body = await res.json();
      CAL.events = (body.items || []).filter((e) => e.status !== 'cancelled' && !(e.attendees || []).some((a) => a.self && a.responseStatus === 'declined')).map((e) => {
        const meet = e.hangoutLink || ((e.conferenceData && e.conferenceData.entryPoints) || []).filter((p) => p.entryPointType === 'video').map((p) => p.uri)[0] || '';
        return { id: e.id, title: e.summary || '(No title)', start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date, allDay: !e.start.dateTime, meet: /^https:\/\/meet\.google\.com\//.test(meet) ? meet : '', link: /^https:\/\/www\.google\.com\/calendar\//.test(e.htmlLink || '') ? e.htmlLink : '',
          people: (e.attendees || []).filter((a) => !a.resource).map((a) => ({ name: a.displayName || a.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), email: a.email, self: !!a.self, rsvp: a.responseStatus })) };
      }).filter((e) => !e.allDay && new Date(e.end) > now);
      CAL.err = ''; CAL.at = Date.now(); CAL.via = 'token'; CAL.limited = false;
    } catch (e) { if (e.message !== 'expired') CAL.err = e.message; if (CAL.via === 'token' && !CAL.token) { CAL.via = ''; CAL.server = undefined; } }
    CAL.busy = false; dash.draw('cal'); syncControls(); dash.draw('np-list');
  }
  setInterval(() => { if ((CAL.token || CAL.via === 'server') && document.visibilityState === 'visible') calLoad(); }, 60 * 1000);
  const fmtRange = (a, b) => CO.istTime(a) + ' – ' + CO.istTime(b);
  const untilText = (iso) => { const m = Math.round((new Date(iso) - Date.now()) / 60000); if (m <= 0) return 'Now'; if (m < 60) return 'in ' + m + ' min'; const h = Math.floor(m / 60); return m < 24 * 60 ? 'in ' + h + ' h ' + (m % 60 ? (m % 60) + ' min' : '') : CO.istDateTime(iso); };
  function meetingNote(ev) {
    NB.startNew('blank');
    setTimeout(() => {
      const t = document.getElementById('nb-title'); t.value = ev.title; t.dispatchEvent(new Event('input'));
      const b = document.getElementById('nb-body');
      b.value = 'Attendees: ' + ev.people.map((p) => '@' + p.name).join(' ') + '\n\nAgenda\n• \n\nNotes\n• \n\nDecisions\n• \n'; b.dispatchEvent(new Event('input'));
    }, 80);
  }
  dash.draw('cal', (el) => {
    el.replaceChildren();
    const head = document.createElement('div'); head.className = 'co-card-head';
    const hd = document.createElement('div'); const h = document.createElement('h2'); h.className = 'co-h2'; h.textContent = 'Meetings'; const n = document.createElement('p'); n.className = 'co-note'; n.textContent = 'Your Google Calendar, today and the next two days.'; hd.append(h, n); head.append(hd);
    el.append(head);
    if (A.mode !== 'auth') return;
    if (CAL.server === undefined && !CAL.token) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'Loading your meetings…'; el.append(p); calServer(); return; }
    if (!CAL.token && CAL.via !== 'server') {
      const box = document.createElement('div'); box.className = 'cal-empty';
      const p = document.createElement('p'); p.textContent = (CAL.serverErr === 'not_shared' ? 'Your calendar is not shared inside the company, so connect it here (or ask the admin to turn on company-wide calendar sharing). ' : '') + (LS.get('co.cal', '') === '1' ? 'Reconnect to show your next meetings (Google asks again every hour or so).' : 'See your next meeting, who is in it and a Join button for Google Meet. Read-only; only you see your calendar.');
      const b = document.createElement('button'); b.type = 'button'; b.className = 'co-btn primary'; b.textContent = LS.get('co.cal', '') === '1' ? 'Show my meetings' : 'Connect Google Calendar'; b.addEventListener('click', calConnect);
      box.append(p, b); if (CAL.err) { const e = document.createElement('p'); e.className = 'co-note bad'; e.textContent = CAL.err; box.append(e); }
      el.append(box); return;
    }
    if (CAL.off) {
      const box = document.createElement('div'); box.className = 'cal-empty'; const p = document.createElement('p'); p.className = 'bad'; p.textContent = CAL.err; box.append(p);
      const row = document.createElement('div'); row.className = 'cal-acts';
      if (can('Admin')) { const a = document.createElement('a'); a.className = 'co-btn primary'; a.href = CAL.enableUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Switch on in Google Cloud'; row.append(a); }
      const r = document.createElement('button'); r.type = 'button'; r.className = 'co-btn'; r.textContent = 'Try again'; r.addEventListener('click', () => calLoad(true)); row.append(r); box.append(row);
      el.append(box); return;
    }
    if (!CAL.events) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = CAL.err || 'Loading your calendar…'; el.append(p); calLoad(); return; }
    if (CAL.err) { const p = document.createElement('p'); p.className = 'co-note bad'; p.textContent = CAL.err; el.append(p); }
    const evs = CAL.events; if (!evs.length) { const p = document.createElement('p'); p.className = 'cal-free'; p.textContent = 'No meetings in the next three days.'; el.append(p); return; }
    // When the calendar only shares busy times with the dashboard, offer the person's own read-only connection (names + Meet links).
    if (CAL.limited && CAL.via !== 'token') {
      const tip = document.createElement('div'); tip.className = 'cal-limited';
      const tx = document.createElement('p'); tx.textContent = 'Meeting names and Meet links are hidden by your calendar sharing.';
      const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'co-btn primary'; bt.textContent = 'Show names & Meet links'; bt.addEventListener('click', calConnect);
      tip.append(tx, bt); el.append(tip);
    }
    const dur = (e) => { const m = Math.round((new Date(e.end) - new Date(e.start)) / 60000); return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min'; };
    const day = (iso) => { const d = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), t = CO.today(); return d === t ? 'Today' : d === CO.addDays(t, 1) ? 'Tomorrow' : new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' }); };
    const next = evs[0], live = new Date(next.start) <= new Date();
    const card = document.createElement('div'); card.className = 'cal-next' + (live ? ' live' : '');
    const when = document.createElement('span'); when.className = 'cal-when'; when.textContent = live ? 'Happening now' : 'Next · ' + untilText(next.start);
    const t = document.createElement('b'); t.className = 'cal-title'; t.textContent = next.title;
    const tm = document.createElement('span'); tm.className = 'cal-time'; tm.textContent = day(next.start) + ' · ' + fmtRange(next.start, next.end) + ' IST · ' + dur(next);
    const ppl = document.createElement('span'); ppl.className = 'cal-ppl';
    next.people.slice(0, 5).forEach((p) => { const a = CO.av(p.name); a.title = p.name + (p.rsvp === 'accepted' ? ' · going' : p.rsvp === 'tentative' ? ' · maybe' : ''); ppl.append(a); });
    if (next.people.length > 5) ppl.append(Object.assign(document.createElement('span'), { className: 'cal-more', textContent: '+' + (next.people.length - 5) }));
    const acts = document.createElement('div'); acts.className = 'cal-acts';
    if (next.meet) { const j = document.createElement('a'); j.className = 'co-btn primary'; j.href = next.meet; j.target = '_blank'; j.rel = 'noopener'; j.textContent = 'Join Google Meet'; acts.append(j); }
    const nt = document.createElement('button'); nt.type = 'button'; nt.className = 'co-btn'; nt.textContent = 'Take notes'; nt.addEventListener('click', () => meetingNote(next)); acts.append(nt);
    card.append(when, t, tm); if (next.people.length) card.append(ppl); card.append(acts); el.append(card);
    const rest = evs.slice(1, 8);
    if (rest.length) {
      const ul = document.createElement('ul'); ul.className = 'cal-list';
      let lastDay = day(next.start);
      rest.forEach((e) => {
        const d = day(e.start);
        if (d !== lastDay) { const h = document.createElement('li'); h.className = 'cal-day'; h.textContent = d; ul.append(h); lastDay = d; }
        const li = document.createElement('li');
        const a = document.createElement('span'); a.className = 'cal-li-t'; a.textContent = CO.istTime(e.start);
        const b2 = document.createElement('span'); b2.className = 'cal-li-n'; const nm = document.createElement('b'); nm.textContent = e.title; const sm = document.createElement('small'); sm.textContent = dur(e) + (e.people.length ? ' · ' + e.people.length + ' people' : ''); b2.append(nm, sm); b2.title = e.people.map((p) => p.name).join(', ');
        li.append(a, b2);
        if (e.meet) { const j = document.createElement('a'); j.href = e.meet; j.target = '_blank'; j.rel = 'noopener'; j.className = 'cal-join'; j.textContent = 'Join'; li.append(j); }
        ul.append(li);
      });
      el.append(ul);
    }
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
  let gateNote = '';
  async function showGate(msg) {
    document.body.dataset.gate = '1'; gate.hidden = false; hideBoot();
    // The one-off message (e.g. 'You are signed out.') is read once per page and kept, so a second draw of the gate cannot blank it.
    try { const g0 = sessionStorage.getItem('co.gatemsg'); if (g0) { gateNote = g0; sessionStorage.removeItem('co.gatemsg'); } } catch (e) { /* ignore */ }
    const m = msg || gateNote;
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
    LS.set('co.me', JSON.stringify(user));
    renderAll();
    DC.get(user.email).then((c) => { if (c && c.body && c.body.ok && S.status !== 'ok') { try { applyData(c.body); S.cached = true; S.refreshing = true; renderAll(); } catch (e) { /* ignore a bad copy */ } } });
    load(false);
    ASH.show(true);
    // Admins see how many access requests are waiting as soon as they open the dashboard.
    if (can('Admin')) callApi({ action: 'ver' }).then((b) => { if (b.ok && typeof b.pending === 'number') { AX.pending = b.pending; syncControls(); } }).catch(() => {});
  }
  /* The session ended or access was removed: forget it and clear the page, so no data stays on screen. */
  let signingOut = false; // a background check that ends during sign-out must not replace the 'signed out' message
  function lostAccess(body) {
    if (signingOut) return;
    const msg = body.error === 'session_expired' ? 'Your sign-in has ended. Log in again to continue.'
      : body.error === 'no_access' ? (body.status === 'Pending' ? 'Your access request is still waiting for approval.' : 'Your access to this dashboard has been removed. Talk to the Creative Head if you need it back.')
      : '';
    A.session = ''; LS.set('co.session', null); LS.set('co.me', null); DC.clear();
    if (A.user) { try { sessionStorage.setItem('co.gatemsg', msg); } catch (e) { /* ignore */ } A.user = null; location.reload(); return; }
    showGate(msg);
  }
  document.getElementById('btn-signout').addEventListener('click', async () => {
    signingOut = true;
    try { await callApi({ action: 'signout' }); } catch (e) { /* signing out locally is what matters */ }
    A.session = ''; LS.set('co.session', null); LS.set('co.me', null); DC.clear();
    try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
    try { sessionStorage.setItem('co.gatemsg', 'You are signed out.'); } catch (e) { /* ignore */ }
    location.reload();
  });

  async function start() {
    const url = conn().url;
    if (!url) { A.mode = 'key'; document.body.dataset.mode = 'key'; S.status = 'unconfigured'; renderAll(); return; }
    A.url = url; S.status = 'loading'; renderAll();
    // Fast path: this device has signed in before. Use the saved settings and person at once; the data request itself checks the session.
    let saved = null, me = null; try { saved = JSON.parse(LS.get('co.cfg', 'null')); me = JSON.parse(LS.get('co.me', 'null')); } catch (e) { saved = null; }
    if (saved && saved.auth && A.session && me && me.email) {
      A.mode = 'auth'; A.clientId = saved.clientId; A.domains = saved.domains || []; document.body.dataset.mode = 'auth';
      signedIn(me);
      callApi({ action: 'me' }).then((r) => { if (r.ok && JSON.stringify(r.user) !== JSON.stringify(me)) { A.user = r.user; LS.set('co.me', JSON.stringify(r.user)); renderAll(); } }).catch(() => {});
      return;
    }
    let cfg = null, reached = false;
    try {
      const u = new URL(url); u.searchParams.set('mode', 'config');
      const text = await (await fetch(u.toString(), { redirect: 'follow' })).text(); reached = true;
      cfg = JSON.parse(text);
    } catch (e) { /* unreachable, or an older web app */ }
    if (cfg && cfg.ok && cfg.auth) {
      A.mode = 'auth'; A.clientId = cfg.clientId; A.domains = cfg.domains || []; document.body.dataset.mode = 'auth';
      LS.set('co.cfg', JSON.stringify({ auth: true, clientId: cfg.clientId, domains: cfg.domains || [] }));
      if (A.session) {
        try { const me = await callApi({ action: 'me' }); if (me.ok) { signedIn(me.user); return; } }
        catch (e) { if (e instanceof AuthLost) return; S.status = 'error'; S.error = 'This browser could not reach the web app. Check your connection and click Refresh.'; A.mode = null; renderAll(); return; }
      }
      showGate(); return;
    }
    if (!reached) { S.status = 'error'; S.error = 'This browser could not reach the web app. Check your connection, turn off ad or privacy blockers for this page and click Refresh.'; renderAll(); return; }
    A.mode = 'key'; document.body.dataset.mode = 'key'; load(false);
  }

  /* ================= Fasty: voice assistant =================
     Listens in the browser (Web Speech API: English-India or Hindi), understands with Claude through the web app
     (Script property ANTHROPIC_API_KEY), answers from tools that run here on the live data this person can already see,
     and speaks back (Google natural voice when GOOGLE_TTS_KEY is set, else the best female voice the device has).
     Changes to tasks need Editor access and an on-screen confirmation, and go through the same save as the editor. */
  const ASH = (() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const st = { msgs: [], busy: false, listening: false, speaking: false, viaVoice: false, ai: null, tts: false, rec: null, audio: null,
      lang: LS.get('co.ashlang', 'en-IN'), voiceOn: LS.get('co.ashvoice', '1') !== '0', confirm: null };
    const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
    const ICON = {
      mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
      send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>',
      x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
      vol: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
      mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/></svg>'
    };
    const orb = (size) => { const o = el('span', 'orb ' + (size || '')); o.setAttribute('aria-hidden', 'true'); o.innerHTML = '<span class="orb-core"></span><span class="orb-shine"></span><span class="orb-face"><i class="orb-eye"></i><i class="orb-eye"></i><span class="orb-mouth"><i></i><i></i><i></i><i></i></span></span>'; return o; };

    /* ---- UI ---- */
    const fab = el('button', 'ash-fab'); fab.type = 'button'; fab.setAttribute('aria-label', 'Ask Fasty, your dashboard assistant (Alt+A)'); fab.title = 'Ask Fasty (Alt+A)';
    fab.append(el('span', 'fy-glow'), orb(), el('span', 'ash-halo'), el('i', 'fy-spark s1'), el('i', 'fy-spark s2'), el('i', 'fy-spark s3'));
    // Small speech-bubble tips next to Fasty: one pops up every ~2.5 s and stays ~2.5 s. Paused while the assistant is
    // open, while the pointer is on a tip or the tab is in the background. The × hides tips for the rest of the day.
    const hint = el('div', 'fy-hint'); hint.setAttribute('role', 'status'); const hintT = el('button', 'fy-hint-t'); hintT.type = 'button';
    const hintX = el('button', 'fy-hint-x'); hintX.type = 'button'; hintX.setAttribute('aria-label', 'Hide tips for today'); hintX.title = 'Hide tips for today'; hintX.innerHTML = ICON.x;
    hint.append(hintT, hintX); hint.hidden = true;
    const TIPS = [
      'Need help? Ask me anything', 'Try: “What’s overdue today?”', 'Hindi mein bhi pooch sakte ho', 'Press Alt+A to talk to me',
      'Try: “What is Sagun working on?”', 'Tap the mic and just speak', 'Try: “Delivered this month?”', 'I can open any section for you',
      'Try: “Kaun free hai?”', 'Ask me for today’s summary'
    ];
    const liveTip = () => {
      try {
        const all = CO.status() === 'ok' ? CO.rows(true) || [] : [];
        const late = all.filter((r) => r.due === 'overdue').length, today = all.filter((r) => r.due === 'today').length;
        const pool = []; if (late) pool.push(late + (late === 1 ? ' task is' : ' tasks are') + ' overdue. Ask me which');
        if (today) pool.push(today + (today === 1 ? ' task is' : ' tasks are') + ' due today'); return pool;
      } catch (e) { return []; }
    };
    const tip = { i: 0, timer: 0, hover: false };
    const tipsOff = () => LS.get('co.fyhint', '') === CO.today();
    const tipCycle = () => {
      clearTimeout(tip.timer);
      if (fab.hidden || tipsOff()) { hint.hidden = true; return; }
      const idle = !panel.hidden || tip.hover || document.visibilityState !== 'visible';
      if (hint.hidden && !idle) {
        const pool = TIPS.concat(liveTip()); const text = pool[tip.i++ % pool.length];
        hintT.textContent = text; hint.hidden = false; hint.classList.remove('out');
        tip.timer = setTimeout(() => { if (tip.hover) return tipCycle(); hint.classList.add('out'); tip.timer = setTimeout(() => { hint.hidden = true; hint.classList.remove('out'); tip.timer = setTimeout(tipCycle, 2300); }, 260); }, 2500);
        return;
      }
      tip.timer = setTimeout(tipCycle, hint.hidden ? 2500 : 600);
    };
    hint.addEventListener('pointerenter', () => { tip.hover = true; });
    hint.addEventListener('pointerleave', () => { tip.hover = false; tipCycle(); });
    hintT.addEventListener('click', () => { hint.hidden = true; open(); });
    hintX.addEventListener('click', () => { hint.hidden = true; clearTimeout(tip.timer); LS.set('co.fyhint', CO.today()); });
    const panel = el('section', 'ash'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Fasty, dashboard assistant'); panel.hidden = true;
    const head = el('header', 'ash-head'); const hOrb = orb('sm');
    const hT = el('div', 'ash-title'); hT.append(el('b', '', 'Fasty'), el('small', '', 'Your dashboard helper'));
    const langB = el('button', 'ash-chip'); langB.type = 'button';
    const voiceB = el('button', 'ash-ib'); voiceB.type = 'button';
    const closeB = el('button', 'ash-ib'); closeB.type = 'button'; closeB.innerHTML = ICON.x; closeB.setAttribute('aria-label', 'Close assistant');
    head.append(hOrb, hT, langB, voiceB, closeB);
    const log = el('div', 'ash-log'); log.setAttribute('aria-live', 'polite');
    const sugg = el('div', 'ash-sugg');
    const caption = el('div', 'ash-caption'); caption.hidden = true;
    const foot = el('form', 'ash-foot'); foot.autocomplete = 'off';
    const micB = el('button', 'ash-mic'); micB.type = 'button'; micB.innerHTML = ICON.mic + '<span class="ash-wave"><i></i><i></i><i></i><i></i><i></i></span>';
    const input = el('input', 'ash-in'); input.placeholder = 'Ask anything, in Hindi or English…'; input.setAttribute('aria-label', 'Type a question'); input.maxLength = 500;
    const sendB = el('button', 'ash-send'); sendB.type = 'submit'; sendB.innerHTML = ICON.send; sendB.setAttribute('aria-label', 'Send');
    foot.append(micB, input, sendB);
    const note = el('p', 'ash-note');
    panel.append(head, log, caption, sugg, foot, note);
    document.body.append(fab, hint, panel);

    const paintHead = () => {
      langB.textContent = st.lang === 'hi-IN' ? 'हिन्दी' : 'English'; langB.title = 'Listening for ' + (st.lang === 'hi-IN' ? 'Hindi' : 'English and Hinglish') + '. Click to switch.';
      voiceB.innerHTML = st.voiceOn ? ICON.vol : ICON.mute; voiceB.setAttribute('aria-label', st.voiceOn ? 'Turn voice replies off' : 'Turn voice replies on'); voiceB.setAttribute('aria-pressed', String(st.voiceOn));
      micB.setAttribute('aria-label', st.listening ? 'Stop listening' : 'Speak'); micB.disabled = !SR;
      if (!SR) micB.title = 'Voice input needs Chrome, Edge or Safari. You can type instead.';
      note.textContent = st.ai === false ? 'Basic mode: the admin can connect an AI service for full conversations (README, Fasty).' : 'Answers use ' + (st.provider === 'gemini' ? 'Google Gemini' : st.provider ? 'Claude (Anthropic)' : 'AI') + ' on the data you can see. Speech is turned into text by your browser.';
    };
    const setMood = (m) => { [fab, panel].forEach((x) => { x.dataset.mood = m; }); };
    const mood = () => setMood(st.listening ? 'listening' : st.busy ? 'thinking' : st.speaking ? 'speaking' : 'idle');
    const scroll = () => { log.scrollTop = log.scrollHeight; };
    const bubble = (who, text) => { const b = el('div', 'ash-b ' + who); if (text) b.append(el('p', '', text)); log.append(b); scroll(); return b; };
    const firstName = () => { const t = (S.team || []).find((m) => m.status !== 'Inactive'); return t ? t.name.split(' ')[0] : 'Yashika'; };
    const drawSugg = () => {
      sugg.replaceChildren();
      if (st.msgs.length) return;
      const list = ["What's overdue right now?", firstName() + ' ke kitne tasks pending hain?', 'Is mahine kitne creatives deliver hue?', 'Who has the most work this week?', 'How do I add an action item to a note?'];
      list.forEach((q) => { const b = el('button', 'ash-chip', q); b.type = 'button'; b.addEventListener('click', () => ask(q, false)); sugg.append(b); });
    };
    const greet = () => {
      if (log.childElementCount) return;
      const h = Number(CO.istParts ? CO.istParts().hour : new Date().getHours());
      const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
      bubble('bot', part + (A.user && A.user.name ? ', ' + A.user.name.split(' ')[0] : '') + '! I am Fasty. Ask me about tasks, deadlines, the team or reports, or tell me where to go. Hindi, English, Hinglish, sab chalega.');
    };
    function open() { hint.hidden = true; panel.hidden = false; fab.classList.add('on'); paintHead(); greet(); drawSugg(); mood(); setTimeout(() => input.focus(), 60); }
    function close() { panel.hidden = true; fab.classList.remove('on'); stopListening(); stopSpeaking(); }
    fab.addEventListener('click', () => (panel.hidden ? open() : close()));
    closeB.addEventListener('click', close);
    langB.addEventListener('click', () => { st.lang = st.lang === 'hi-IN' ? 'en-IN' : 'hi-IN'; LS.set('co.ashlang', st.lang); paintHead(); });
    voiceB.addEventListener('click', () => { st.voiceOn = !st.voiceOn; LS.set('co.ashvoice', st.voiceOn ? '1' : '0'); if (!st.voiceOn) stopSpeaking(); paintHead(); });
    document.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); if (panel.hidden) open(); else close(); }
      else if (e.key === 'Escape' && !panel.hidden && !document.querySelector('dialog[open]')) close();
    });
    foot.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q) { input.value = ''; ask(q, false); } });
    micB.addEventListener('click', () => (st.listening ? stopListening() : listen()));

    /* ---- listening ---- */
    function listen() {
      if (!SR || st.busy) return;
      stopSpeaking();
      const rec = new SR(); st.rec = rec; rec.lang = st.lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      let finalText = '';
      rec.onresult = (e) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += t; else interim += t; } caption.textContent = (finalText + ' ' + interim).trim() || 'Listening…'; };
      rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') bubble('bot err', 'I need microphone access. Allow the microphone for this site in the browser bar, or type your question.'); else if (e.error === 'no-speech') caption.textContent = 'I did not hear anything.'; };
      rec.onend = () => { st.listening = false; st.rec = null; micB.classList.remove('on'); mood(); setTimeout(() => { caption.hidden = true; }, finalText ? 0 : 900); if (finalText.trim()) ask(finalText.trim(), true); };
      try { rec.start(); st.listening = true; micB.classList.add('on'); caption.hidden = false; caption.textContent = 'Listening…'; mood(); } catch (e) { st.listening = false; }
    }
    function stopListening() { if (st.rec) { try { st.rec.stop(); } catch (e) { /* already stopped */ } } }

    /* ---- speaking ---- */
    const plain = (t) => String(t).replace(/[*_#`>|]/g, '').replace(/\s+/g, ' ').trim();
    const langOf = (t) => (/[ऀ-ॿ]/.test(t) ? 'hi-IN' : 'en-IN');
    let voices = []; const loadVoices = () => { try { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch (e) { voices = []; } };
    if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
    const FEMALE = /neerja|swara|heera|kalpana|veena|lekha|aditi|raveena|female|zira|samantha|ava|allison|susan|serena|karen|moira|tessa|fiona|google uk english female|google हिन्दी|google hindi/i;
    const pickVoice = (lang) => {
      const base = lang.slice(0, 2), score = (v) => (v.lang === lang ? 40 : v.lang.startsWith(base) ? 25 : v.lang.startsWith('en') ? 5 : -100) + (FEMALE.test(v.name) ? 30 : 0) + (/natural|online|neural|premium|enhanced/i.test(v.name) ? 20 : 0) + (/google/i.test(v.name) ? 6 : 0) - (/male\b|ravi|hemant|prabhat|david|mark|daniel|alex\b/i.test(v.name) && !FEMALE.test(v.name) ? 40 : 0);
      return voices.slice().sort((a, b) => score(b) - score(a))[0] || null;
    };
    function done() { st.speaking = false; mood(); if (st.viaVoice && st.lastAskedQuestion && !panel.hidden) setTimeout(listen, 250); }
    // Gemini returns raw 16-bit PCM; wrap it in a WAV header so the browser can play it. Chirp returns MP3.
    const audioUrl = (b64, mime) => {
      if (!/L16|pcm/i.test(mime || '')) return 'data:' + (mime || 'audio/mp3') + ';base64,' + b64;
      const rate = Number(((mime || '').match(/rate=(\d+)/) || [])[1]) || 24000, pcm = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const h = new DataView(new ArrayBuffer(44)), w = (o, str) => [...str].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); w(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
      h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, pcm.length, true);
      return URL.createObjectURL(new Blob([h.buffer, pcm], { type: 'audio/wav' }));
    };
    async function speak(text) {
      if (!st.voiceOn || !text) return;
      const t = plain(text).slice(0, 700), lang = langOf(t); st.speaking = true; mood();
      if (st.tts) {
        try { const r = await callApi({ action: 'speak', text: t, lang }); if (r.ok && r.audio) { stopSpeaking(true); const a = new Audio(audioUrl(r.audio, r.mime)); st.audio = a; st.speaking = true; mood(); a.onended = done; a.onerror = done; await a.play(); return; } } catch (e) { /* fall back to the device voice */ }
      }
      if (!window.speechSynthesis) { st.speaking = false; mood(); return; }
      speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); const v = pickVoice(lang); if (v) u.voice = v; u.lang = v ? v.lang : lang; u.rate = 1.03; u.pitch = 1.05;
      u.onend = done; u.onerror = () => { st.speaking = false; mood(); }; speechSynthesis.speak(u);
    }
    function stopSpeaking(keep) { if (st.audio) { st.audio.pause(); st.audio = null; } try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* ignore */ } if (!keep) { st.speaking = false; mood(); } }

    /* ---- data helpers (all on the live data this person can see) ---- */
    const norm = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
    const allRows = () => CO.rows(true) || [];
    const people = () => { const s = new Set(); (S.team || []).forEach((m) => s.add(m.name)); allRows().forEach((r) => r.list.forEach((n) => s.add(n))); return [...s].filter(Boolean); };
    // Fuzzy person match: full name, first name, or a spoken spelling close to it. Returns {name} or {ambiguous:[...]} or {none}.
    const lev = (a, b) => { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; };
    const findPerson = (q) => {
      const k = norm(q); if (!k) return null; const ps = people();
      const exact = ps.filter((p) => norm(p) === k); if (exact.length) return { name: exact[0] };
      const part = ps.filter((p) => norm(p).split(' ').some((w) => w === k) || norm(p).startsWith(k) || norm(p).includes(k));
      if (part.length === 1) return { name: part[0] }; if (part.length > 1) return { ambiguous: part.slice(0, 6) };
      const close = ps.map((p) => [p, Math.min(...norm(p).split(' ').map((w) => lev(w, k.split(' ')[0])))]).filter(([, d]) => d <= Math.max(1, Math.floor(k.length / 4))).sort((a, b) => a[1] - b[1]);
      if (close.length === 1 || (close.length > 1 && close[0][1] < close[1][1])) return { name: close[0][0] };
      return close.length ? { ambiguous: close.slice(0, 6).map((c) => c[0]) } : { none: q };
    };
    const brands = () => [...new Set(allRows().map((r) => r.brand).filter(Boolean))];
    const findBrand = (q) => { const k = norm(q); if (!k) return null; const bs = brands(); const ex = bs.find((b) => norm(b) === k); if (ex) return { name: ex }; const p = bs.filter((b) => norm(b).includes(k) || k.includes(norm(b))); if (p.length === 1) return { name: p[0] }; if (p.length > 1) return { ambiguous: p.slice(0, 6) }; const c = bs.filter((b) => lev(norm(b), k) <= 2); return c.length === 1 ? { name: c[0] } : c.length ? { ambiguous: c } : { none: q }; };
    const clsOk = (r, c) => !c || c === 'any' || CO.cls(r).toLowerCase() === c;
    const weekStartOf = (iso) => TB.key(iso, 'week');
    const period = (p, from, to) => {
      const t = CO.today(); let f, e, label = p || 'this month';
      const span = (g, back) => { let k = TB.key(t, g); for (let i = 0; i < back; i++) k = TB.prev(k, g); return [k, back ? TB.end(k, g) : t]; };
      switch (label) {
        case 'today': [f, e] = [t, t]; break;
        case 'yesterday': [f, e] = [CO.addDays(t, -1), CO.addDays(t, -1)]; break;
        case 'this week': [f, e] = span('week', 0); break; case 'last week': [f, e] = span('week', 1); break;
        case 'last month': [f, e] = span('month', 1); break;
        case 'this quarter': [f, e] = span('quarter', 0); break; case 'last quarter': [f, e] = span('quarter', 1); break;
        case 'this year': [f, e] = span('year', 0); break;
        case 'custom': f = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : t; e = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : t; break;
        default: label = 'this month'; [f, e] = span('month', 0);
      }
      const len = CO.diffDays(f, e); return { from: f, to: e, label, pfrom: CO.addDays(f, -len - 1), pto: CO.addDays(f, -1) };
    };
    const brief = (r) => ({ id: r.id || '(no ID, row ' + r.row + ')', brand: r.brand, creative: CO.topicText(r).slice(0, 80), type: r.type, qty: r.qty || 1, designer: r.list.join(', ') || 'Unassigned', status: r.stage, eta: r.eta || 'none', late_days: r.due === 'overdue' ? CO.diffDays(r.eta, CO.today()) : undefined, delivered: r.ddate || undefined, classification: CO.cls(r) });
    const countBy = (rs, f) => { const m = {}; rs.forEach((r) => { const k = f(r); m[k] = (m[k] || 0) + (r.qty || 1); }); return m; };

    /* ---- tools ---- */
    let shown = null; // tasks to show on screen with the next answer
    const TOOLS = {
      search_tasks(a) {
        let rs = allRows(); const t = CO.today(), tm = CO.addDays(t, 1), notes = [];
        if (a.designer) { if (/^unassigned|none|nobody|koi nahi$/i.test(a.designer)) rs = rs.filter((r) => !r.list.length); else { const p = findPerson(a.designer); if (!p || p.none) return { error: 'No designer called "' + a.designer + '".', designers: people().slice(0, 30) }; if (p.ambiguous) return { ambiguous: p.ambiguous, ask: 'Which person did they mean?' }; rs = rs.filter((r) => r.list.includes(p.name)); notes.push('designer = ' + p.name); } }
        if (a.brand) { const b = findBrand(a.brand); if (!b || b.none) return { error: 'No brand called "' + a.brand + '".' }; if (b.ambiguous) return { ambiguous: b.ambiguous }; rs = rs.filter((r) => r.brand === b.name); notes.push('brand = ' + b.name); }
        if (a.type) rs = rs.filter((r) => norm(r.type).includes(norm(a.type)));
        rs = rs.filter((r) => clsOk(r, a.classification));
        const s = (a.status || (a.due && a.due !== 'any' ? 'open' : a.delivered_from ? 'delivered' : 'active')).toLowerCase();
        if (s === 'open') rs = rs.filter((r) => r.open); else if (s === 'active') rs = rs.filter((r) => r.stage !== 'Delivered' && r.stage !== 'Deprioritised'); else if (s !== 'any') rs = rs.filter((r) => r.stage.toLowerCase() === s);
        const we = CO.addDays(weekStartOf(t), 6);
        const D = { overdue: (r) => r.due === 'overdue', today: (r) => r.open && r.eta === t, tomorrow: (r) => r.open && r.eta === tm, 'this week': (r) => r.open && r.eta && r.eta >= t && r.eta <= we, 'next 7 days': (r) => r.open && r.eta && r.eta >= t && r.eta <= CO.addDays(t, 7), 'no eta': (r) => r.open && !r.eta };
        if (a.due && D[a.due]) rs = rs.filter(D[a.due]);
        if (a.delivered_from) rs = rs.filter((r) => r.ddate && r.ddate >= a.delivered_from && r.ddate <= (a.delivered_to || t));
        if (a.text) { const words = norm(a.text).split(' ').filter(Boolean); rs = rs.filter((r) => { const h = norm([r.id, r.brand, CO.topicText(r), r.type, r.list.join(' ')].join(' ')); return words.every((w) => h.includes(w)); }); }
        rs = rs.slice().sort((x, y) => String(x.eta || '9999').localeCompare(String(y.eta || '9999')));
        const lim = Math.max(1, Math.min(20, a.limit || 8)); shown = rs.slice(0, lim);
        return { matched_tasks: rs.length, creatives: CO.sumQty(rs), by_status: countBy(rs, (r) => r.stage), overdue_among_them: rs.filter((r) => r.due === 'overdue').length, applied: notes, tasks: rs.slice(0, lim).map(brief), more_not_listed: Math.max(0, rs.length - lim), note: 'Status filter used: ' + s };
      },
      get_summary(a) {
        let rs = allRows(); const lab = [];
        if (a.designer) { const p = findPerson(a.designer); if (!p || p.none) return { error: 'No designer called "' + a.designer + '".' }; if (p.ambiguous) return { ambiguous: p.ambiguous }; rs = rs.filter((r) => r.list.includes(p.name)); lab.push(p.name); }
        if (a.brand) { const b = findBrand(a.brand); if (!b || b.none) return { error: 'No brand called "' + a.brand + '".' }; if (b.ambiguous) return { ambiguous: b.ambiguous }; rs = rs.filter((r) => r.brand === b.name); lab.push(b.name); }
        rs = rs.filter((r) => clsOk(r, a.classification));
        const t = CO.today(), open = rs.filter((r) => r.open), m = CO.thisMonth(), pm = CO.prevMonth(m), pto = CO.sameWorkdaysEnd(m + '-01', t, pm + '-01', CO.monthEnd(pm));
        const del = rs.filter((r) => r.stage === 'Delivered' && r.ddate);
        return { for: lab.join(', ') || 'everyone', open_tasks: open.length, open_creatives: CO.sumQty(open), overdue: open.filter((r) => r.due === 'overdue').length, due_today: open.filter((r) => r.eta === t).length, due_tomorrow: open.filter((r) => r.eta === CO.addDays(t, 1)).length, no_eta: open.filter((r) => !r.eta).length,
          in_progress: rs.filter((r) => r.stage === 'WIP').length, to_be_planned: rs.filter((r) => r.stage === 'To be planned').length, changes_requested: rs.filter((r) => r.stage === 'Changes requested').length, under_review: rs.filter((r) => r.stage === 'Pending approval').length, awaiting_brief: rs.filter((r) => r.stage === 'Incomplete brief').length, on_hold: rs.filter((r) => r.stage === 'Hold').length,
          unassigned_open: open.filter((r) => !r.list.length).length, delivered_this_month_creatives: CO.sumQty(del.filter((r) => r.month === m)), delivered_same_working_days_last_month: CO.sumQty(del.filter((r) => r.ddate >= pm + '-01' && r.ddate <= pto)), working_days_so_far_this_month: CO.workdays(m + '-01', t), working_days_in_month: CO.workdays(m + '-01', CO.monthEnd(m)), oldest_overdue_days: open.filter((r) => r.due === 'overdue').reduce((x, r) => Math.max(x, CO.diffDays(r.eta, t)), 0) };
      },
      team_progress(a) {
        const P = period(a.period, a.from, a.to), rs = allRows(), t = CO.today();
        const names = new Set((S.team || []).filter((m) => m.status !== 'Inactive').map((m) => m.name)); rs.forEach((r) => { if (r.open) r.list.forEach((n) => names.add(n)); });
        const rows = [...names].map((n) => { const mine = rs.filter((r) => r.list.includes(n)), op = mine.filter((r) => r.open), dl = mine.filter((r) => r.stage === 'Delivered' && r.ddate);
          return { designer: n, open: op.length, overdue: op.filter((r) => r.due === 'overdue').length, due_today: op.filter((r) => r.eta === t).length, under_review: mine.filter((r) => r.stage === 'Pending approval').length, delivered: CO.sumQty(dl.filter((r) => r.ddate >= P.from && r.ddate <= P.to)), delivered_previous_period: CO.sumQty(dl.filter((r) => r.ddate >= P.pfrom && r.ddate <= P.pto)) }; })
          .sort((x, y) => y.open - x.open);
        const un = rs.filter((r) => r.open && !r.list.length).length;
        return { period: P.label + ' (' + P.from + ' to ' + P.to + ')', previous_period: P.pfrom + ' to ' + P.pto, designers: rows, unassigned_open_tasks: un };
      },
      delivery_report(a) {
        const P = period(a.period, a.from, a.to); let rs = allRows().filter((r) => r.stage === 'Delivered' && r.ddate);
        if (a.designer) { const p = findPerson(a.designer); if (!p || p.none) return { error: 'No designer called "' + a.designer + '".' }; if (p.ambiguous) return { ambiguous: p.ambiguous }; rs = rs.filter((r) => r.list.includes(p.name)); }
        if (a.brand) { const b = findBrand(a.brand); if (!b || b.none) return { error: 'No brand called "' + a.brand + '".' }; if (b.ambiguous) return { ambiguous: b.ambiguous }; rs = rs.filter((r) => r.brand === b.name); }
        rs = rs.filter((r) => clsOk(r, a.classification));
        const cur = rs.filter((r) => r.ddate >= P.from && r.ddate <= P.to), prev = rs.filter((r) => r.ddate >= P.pfrom && r.ddate <= P.pto);
        const key = { designer: (r) => r.list.join(', ') || 'Unassigned', brand: (r) => r.brand, type: (r) => r.type, classification: (r) => CO.cls(r), day: (r) => r.ddate, week: (r) => 'week of ' + TB.key(r.ddate, 'week'), month: (r) => r.ddate.slice(0, 7) }[a.group_by] || ((r) => r.brand);
        const groups = Object.entries(countBy(cur, key)).sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => ({ name: k, creatives: v }));
        return { period: P.label + ' (' + P.from + ' to ' + P.to + ')', total_creatives: CO.sumQty(cur), tasks: cur.length, previous_period_total: CO.sumQty(prev), previous_period: P.pfrom + ' to ' + P.pto, groups };
      },
      my_notes(a) {
        const ns = NB.notes || []; const k = norm(a.text || '');
        const list = ns.filter((n) => !k || norm([n.title, n.body, n.brand, n.category].join(' ')).includes(k)).slice(0, 8).map((n) => ({ title: n.title, date: n.date, type: n.type, open_actions: (n.actions || []).filter((x) => !x.done).length }));
        const acts = NB.myActions().filter((x) => !x.done).slice(0, 10).map((x) => ({ action: x.text, note: x.note, due: x.due || 'no date' }));
        return a.open_actions_only ? { my_open_action_items: acts } : { notes: list, my_open_action_items: acts, total_notes_visible: ns.length };
      },
      navigate(a) {
        const tab = { overview: 'today', standup: 'standup', tasks: 'tasks', notes: 'notes', team: 'team', reports: 'reports', health: 'health', access: 'access' }[a.section] || 'today';
        if ((tab === 'health' || tab === 'access') && !can('Admin')) return { error: 'not_allowed', detail: 'Only admins can open ' + PAGE_NAME[tab] + '.' };
        const p = { tab }; const said = [];
        if (a.clear_filters) Object.assign(p, { src: '', designer: '', brand: '', type: '' });
        if (a.designer) { const x = findPerson(a.designer); if (x && x.ambiguous) return { ambiguous: x.ambiguous }; if (x && x.name) { p.designer = x.name; said.push(x.name); } }
        if (a.brand) { const x = findBrand(a.brand); if (x && x.ambiguous) return { ambiguous: x.ambiguous }; if (x && x.name) { p.brand = x.name; said.push(x.name); } }
        if (a.type) { const ty = [...new Set(allRows().map((r) => r.type))].find((x) => norm(x) === norm(a.type)); if (ty) { p.type = ty; said.push(ty); } }
        if (a.classification) { p.src = a.classification === 'external' ? 'Paid' : a.classification === 'internal' ? 'Marketing' : ''; if (p.src) said.push(a.classification); }
        if (a.report_period) p.rpreset = a.report_period;
        dash.setParams(p); return { opened: PAGE_NAME[tab], filters_set: said };
      },
      open_task(a) {
        const r = allRows().find((x) => String(x.id).toLowerCase() === String(a.id).toLowerCase().replace(/\s+/g, ''));
        if (!r) return { error: 'No task with ID ' + a.id + '.' };
        document.dispatchEvent(new CustomEvent('co-open-task', { detail: r.uid })); return { opened: brief(r) };
      },
      async update_task(a) {
        if (A.mode === 'auth' && !can('Editor')) return { error: 'not_allowed', detail: 'This person has view-only access. An Editor or the Admin can change tasks.' };
        if (!TASK_SAVE) return { error: 'Editing is not available right now.' };
        const r = allRows().find((x) => String(x.id).toLowerCase() === String(a.id).toLowerCase().replace(/\s+/g, ''));
        if (!r) return { error: 'No task with ID ' + a.id + '.' };
        const fields = {}, lines = [];
        if (a.status && a.status !== r.stage) { fields.status = a.status; lines.push(['Status', r.stage, a.status]); }
        if (a.eta && /^\d{4}-\d{2}-\d{2}$/.test(a.eta) && a.eta !== r.eta) { fields.eta = a.eta; lines.push(['Design ETA', r.eta ? CO.fmtDate(r.eta, true) : 'none', CO.fmtDate(a.eta, true)]); }
        if (a.designer) { const names = String(a.designer).split(/\s*(?:,|\+| and | aur )\s*/i).filter(Boolean).map((n) => findPerson(n)); const bad = names.find((x) => !x || !x.name); if (bad) return bad && bad.ambiguous ? { ambiguous: bad.ambiguous } : { error: 'Unknown designer "' + a.designer + '".' }; const v = names.map((x) => x.name).join(', '); if (v !== r.list.join(', ')) { fields.designer = v; lines.push(['Designer', r.list.join(', ') || 'Unassigned', v]); } }
        if (a.priority && a.priority !== r.priority) { fields.priority = a.priority; lines.push(['Priority', r.priority || 'none', a.priority]); }
        if (!lines.length) return { result: 'Nothing to change: the task already has those values.', task: brief(r) };
        const ok = await confirmCard(r, lines);
        if (!ok) return { result: 'cancelled', detail: 'The person cancelled the change on screen. Nothing was saved.' };
        try { const res = await TASK_SAVE(r, fields); return { result: 'saved', row: res.row || r.row, changes: lines.map((l) => l[0] + ': ' + l[1] + ' to ' + l[2]) }; }
        catch (e) { return { error: 'Not saved: ' + e.message }; }
      }
    };
    function confirmCard(r, lines) {
      return new Promise((resolve) => {
        const b = bubble('bot card'); b.append(el('b', '', 'Change ' + (r.id || 'this task') + '?'), el('span', 'ash-sub', r.brand + ' · ' + CO.topicText(r).slice(0, 60)));
        const ul = el('ul', 'ash-diff'); lines.forEach(([k, x, y]) => { const li = el('li'); li.append(el('span', '', k), el('s', '', x), el('b', '', y)); ul.append(li); }); b.append(ul);
        const row = el('div', 'ash-acts'); const yes = el('button', 'co-btn primary', 'Save change'), no = el('button', 'co-btn', 'Cancel'); yes.type = no.type = 'button'; row.append(yes, no); b.append(row); scroll();
        const fin = (v) => { yes.disabled = no.disabled = true; row.replaceChildren(el('span', 'ash-sub', v ? 'Saving…' : 'Cancelled')); resolve(v); };
        yes.addEventListener('click', () => fin(true)); no.addEventListener('click', () => fin(false)); yes.focus();
      });
    }
    const showTasks = (b, rs) => {
      if (!rs || !rs.length) return;
      const ul = el('ul', 'ash-tasks'); rs.forEach((r) => { const li = el('li'); li.tabIndex = 0; li.setAttribute('role', 'button'); const a = el('span', 'ash-t'); a.append(el('b', '', r.brand), ' ' + CO.topicText(r).slice(0, 60)); const z = el('span', 'ash-sub', [r.id, r.list.join(', ') || 'Unassigned', r.stage, r.eta ? (r.due === 'overdue' ? CO.diffDays(r.eta, CO.today()) + 'd late' : CO.fmtDate(r.eta)) : 'No ETA'].filter(Boolean).join(' · ')); li.append(a, z); const go = () => document.dispatchEvent(new CustomEvent('co-open-task', { detail: r.uid })); li.addEventListener('click', go); li.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); ul.append(li); });
      b.append(ul); scroll();
    };

    /* ---- the conversation ---- */
    const ctx = () => { const p = dash.params(); return { page: PAGE_NAME[p.tab] || 'Overview', filters: [p.src ? CO.cls(p.src) : '', p.designer, p.brand, p.type].filter(Boolean).join(', '), lang: st.lang }; };
    // Keep the conversation short enough to send, cutting only at a question the person asked (never between a tool call and its result).
    const trim = () => { while (st.msgs.length > 30) { st.msgs.shift(); while (st.msgs.length && !(st.msgs[0].role === 'user' && st.msgs[0].content.some((c) => c.type === 'text'))) st.msgs.shift(); } };
    async function ask(q, viaVoice) {
      if (st.busy) return;
      st.viaVoice = viaVoice; stopSpeaking(); sugg.replaceChildren();
      bubble('me', q); st.busy = true; mood(); shown = null;
      const wait = bubble('bot wait'); wait.append(el('span', 'dots', '')); wait.setAttribute('aria-label', 'Fasty is thinking');
      let answer = '';
      try {
        if (st.ai === false || A.mode !== 'auth') answer = local(q);
        else {
          st.msgs.push({ role: 'user', content: [{ type: 'text', text: q }] }); trim();
          for (let hop = 0; hop < 7; hop++) {
            // Never wait forever: after 30 seconds answer in basic mode and say why.
            const res = await Promise.race([callApi({ action: 'assist', messages: st.msgs, context: ctx() }), new Promise((r) => setTimeout(() => r({ ok: false, error: 'busy', slow: true }), 30000))]);
            if (!res.ok && res.error === 'busy') { st.msgs.pop(); answer = local(q) + (res.slow ? ' (Quick answer: the AI service did not reply in 30 seconds, so I used basic mode.)' : ' (Quick answer: the AI service is busy right now, so I used basic mode.)'); break; }
            if (!res.ok) { if (res.error === 'not_configured') { st.ai = false; paintHead(); st.msgs.pop(); answer = local(q); } else answer = res.error || 'Something went wrong. Try again.'; break; }
            if (res.stop_reason === 'refusal') { st.msgs.pop(); answer = 'I can not help with that one. Ask me about tasks, the team or reports.'; break; }
            st.msgs.push({ role: 'assistant', content: res.content });
            const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
            const calls = res.content.filter((c) => c.type === 'tool_use');
            if (res.stop_reason !== 'tool_use' || !calls.length) { answer = text || 'Done.'; break; }
            const results = [];
            for (const c of calls) {
              let out; try { out = TOOLS[c.name] ? await TOOLS[c.name](c.input || {}) : { error: 'Unknown tool ' + c.name }; } catch (e) { out = { error: String(e.message || e) }; }
              results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out).slice(0, 12000), is_error: !!(out && out.error && out.error !== 'not_allowed') });
            }
            st.msgs.push({ role: 'user', content: results });
            if (hop === 6) answer = 'That took too many steps. Could you ask in a simpler way?';
          }
        }
      } catch (e) { if (e instanceof AuthLost) return; answer = 'I could not reach the dashboard service. Check the connection and try again.'; }
      wait.remove(); st.busy = false;
      // The AI adds "<<say>>" + a Devanagari version for Hindi/Hinglish replies: show the first part, speak the second (correct pronunciation).
      const [shownText, spoken] = String(answer).split(/\s*<<say>>\s*/);
      const b = bubble('bot', shownText.trim()); showTasks(b, shown); st.lastAskedQuestion = /\?\s*$|\?\s*["”]?$/.test(shownText.trim());
      mood(); speak((spoken || shownText).trim());
    }

    /* ---- basic mode (no Claude key): understands the common questions in English and Hinglish ---- */
    function local(q) {
      const k = norm(q), hi = /\b(hai|hain|ka|ke|ki|kitne|kitna|kya|dikhao|kholo|mera|mere|aaj|kal|mahine|batao|chalo)\b|[ऀ-ॿ]/.test(q);
      const say = (en, hn) => (hi ? hn : en);
      const sec = [['overview', /\b(overview|home|dashboard)\b/], ['standup', /stand ?up/], ['tasks', /\btasks?\b|kaam/], ['notes', /\bnotes?\b/], ['team', /\bteam\b/], ['reports', /\breports?\b/], ['health', /\bhealth\b/], ['access', /\baccess\b/]].find(([, re]) => re.test(k));
      const person = people().find((p) => k.includes(norm(p)) || norm(p).split(' ').some((w) => w.length > 2 && new RegExp('\\b' + w + '\\b').test(k)));
      if (sec && /(open|show|go|take me|kholo|dikhao|chalo|le chalo|jao)/.test(k)) { const r = TOOLS.navigate({ section: sec[0], designer: person }); return r.error ? r.detail : say('Opened ' + r.opened + '.', r.opened + ' khol diya.'); }
      if (/deliver/.test(k)) { const r = TOOLS.delivery_report({ period: /last month|pichle mahine/.test(k) ? 'last month' : /week|hafte/.test(k) ? 'this week' : /today|aaj/.test(k) ? 'today' : 'this month', group_by: 'designer', designer: person }); return say(CO.num(r.total_creatives) + ' creatives delivered ' + r.period.split(' (')[0] + (person ? ' by ' + person : '') + '.', (person ? person + ' ne ' : '') + r.period.split(' (')[0] + ' ' + CO.num(r.total_creatives) + ' creatives deliver kiye.'); }
      const due = /overdue|late|der|delay/.test(k) ? 'overdue' : /\btoday\b|\baaj\b/.test(k) ? 'today' : /tomorrow|\bkal\b/.test(k) ? 'tomorrow' : '';
      if (due || person || /pending|open|kitne|how many/.test(k)) {
        const r = TOOLS.search_tasks({ designer: person, due: due || undefined, status: due ? undefined : 'open' });
        if (r.error || r.ambiguous) return say('Which person do you mean?', 'Kaun se person ki baat kar rahe ho?');
        const what = due === 'overdue' ? say('overdue', 'overdue') : due === 'today' ? say('due today', 'aaj due') : due === 'tomorrow' ? say('due tomorrow', 'kal due') : say('open', 'open');
        return say((person ? person + ' has ' : 'There are ') + r.matched_tasks + ' ' + what + ' tasks' + (r.matched_tasks ? '. I have put them on screen.' : '.'), (person ? person + ' ke ' : 'Total ') + r.matched_tasks + ' tasks ' + what + ' hain' + (r.matched_tasks ? ', screen par dikha diye.' : '.'));
      }
      return say('I can tell you what is overdue, due today or open for anyone, what was delivered this month, and open any section. For full conversations, the admin can connect Claude.', 'Main overdue, aaj due ya open tasks, is mahine ki delivery, aur koi bhi section khol sakti hoon. Poori baatcheet ke liye admin Claude connect kar sakte hain.');
    }
    function setStatus(s) { if (!s) return; st.ai = !!s.ai; st.tts = !!s.tts; st.provider = s.provider; if (!panel.hidden) paintHead(); }
    fab.hidden = true;
    const show = (on) => { fab.hidden = !on; if (!on) { close(); hint.hidden = true; clearTimeout(tip.timer); } else { clearTimeout(tip.timer); tip.timer = setTimeout(tipCycle, 2500); } };
    return { open, close, ask, setStatus, show, get state() { return st; }, _tools: TOOLS, _local: local };
  })();

  /* ================= System check (Overview) =================
     Every refresh, the dashboard checks its own data, connections and calculations, and lists anything wrong at the top
     of the Overview with what to do about it. People who cannot fix a setting see only what affects them. */
  const SYS = (() => {
    const last = { ok: 0, at: null };
    const checks = () => {
      const out = [], admin = can('Admin'), t = CO.today();
      const add = (level, title, detail, act) => out.push({ level, title, detail, act });
      // 1. Data loading and sheets
      if (S.status === 'error') add('bad', 'The data could not load', S.error);
      if (S.staleError) add('warn', 'The last refresh failed', 'Showing data from ' + (S.loadedAt ? CO.istTime(S.loadedAt) : 'earlier') + '. ' + S.staleError, ['Try again', () => load(true)]);
      const src = S.sources || {};
      Object.keys(src).forEach((k) => { const s = src[k]; if (s && s.error && (!s.optional || admin)) add(s.optional ? 'warn' : 'bad', 'A sheet could not be read: ' + (s.file ? s.file + ' / ' + s.tab : k), s.error + (admin ? ' Check the link in Config.gs and that design.tools can open the sheet.' : ' The admin has to fix the sheet link or sharing.')); });
      if (S.loadedAt && document.visibilityState === 'visible' && Date.now() - S.loadedAt > 15 * 60 * 1000) add('warn', 'The data is ' + Math.round((Date.now() - S.loadedAt) / 60000) + ' minutes old', 'Live sync has not refreshed it. Check the internet connection.', ['Refresh now', () => load(true)]);
      // 2. Web app and integrations (admins can fix these)
      if (A.mode === 'auth' && S.verBody) {
        if (admin && S.verBody.update && S.verBody.update.err) add('warn', 'Automatic updates need attention', S.verBody.update.err);
        if (admin && S.verBody.calOff) add('warn', 'Meetings are switched off for everyone', 'Enable the Google Calendar API in the web app\'s Google Cloud project, then everyone\'s meetings load automatically.', ['Enable Calendar API', () => window.open(S.verBody.calOff, '_blank', 'noopener')]);
        if (!('assist' in S.verBody)) add('warn', admin ? 'The web app is running an older Code.gs' : 'Some features are waiting for an update', admin ? 'Paste the latest Code.gs from GitHub into Apps Script, run setup, and deploy a new version. Until then the assistant, history comparisons and reminder settings may not work.' : 'The admin needs to update the web app. Everything else works.');
        else if (admin && S.verBody.assist && !S.verBody.assist.ai) add('info', 'Fasty is in basic mode', 'Add a free GEMINI_API_KEY script property in Apps Script for full conversations in Hindi, English and Hinglish (README, Fasty).');
      }
      if (admin && S.health) {
        if (!S.health.liveTriggers) add('warn', 'Live change detection is off', 'Run setup in Apps Script once. Until then sheet edits arrive every 10 minutes instead of 30 seconds.');
        Object.keys(S.health.sources || {}).forEach((k) => { const h = S.health.sources[k]; if (h.ok && h.canEdit === false) add('warn', 'Read-only sheet: ' + (h.file || k), 'Edits from the dashboard to this sheet will fail. Give design.tools edit access.'); });
      }
      if (CAL.off) add(admin ? 'warn' : 'info', 'Google Calendar is switched off', admin ? 'Meetings cannot load until the Google Calendar API is switched on in the Google Cloud project.' : 'Meetings will show once the admin switches it on.', admin ? ['Switch on in Google Cloud', () => window.open(CAL.enableUrl, '_blank', 'noopener')] : null);
      if (admin && A.mode === 'auth' && S.verBody && 'assist' in S.verBody && HS.at && !HS.days.length) add('info', 'No daily snapshots yet', 'Week-on-week comparisons for open and overdue work start after a few days of snapshots. Run setup once if this stays for more than a day.');
      // 3. Data quality (admins: fixes are in the sheets)
      if (admin && S.status === 'ok') {
        const all = CO.rows(true) || [], skipped = (S.ignored || []).length, unknown = all.filter((r) => /Unrecognised status/.test(String(r.flags || ''))).length;
        const noEta = all.filter((r) => r.open && !r.eta).length, noDes = all.filter((r) => r.open && !r.list.length).length;
        if (skipped || unknown) add('warn', (skipped + unknown) + ' rows are not counted correctly', [skipped ? skipped + ' incomplete rows are left out' : '', unknown ? unknown + ' have a status the dashboard does not recognise' : ''].filter(Boolean).join('; ') + '. Fix them in the sheets.', ['Open Data health', () => dash.setParams({ tab: 'health' })]);
        if (noEta > 20 || noDes > 20) add('info', 'Open work missing details', noEta + ' open tasks have no Design ETA and ' + noDes + ' have no designer, so they cannot count as overdue or in anyone\'s workload.', ['Open Data health', () => dash.setParams({ tab: 'health' })]);
      }
      // 4. Calculation self-check: the same numbers worked out two independent ways must agree.
      if (S.status === 'ok') {
        const all = CO.rows(true) || [], fails = [];
        const stageSum = all.reduce((n, r) => n + (r.stage ? 1 : 0), 0); if (stageSum !== all.length) fails.push('every task has a status');
        if (all.some((r) => r.open !== CODATA.OPEN_STAGES.includes(r.stage))) fails.push('open work matches the open statuses');
        if (all.some((r) => r.stage === 'Delivered' && (!r.ddate || r.ddate > t || r.month !== r.ddate.slice(0, 7)))) fails.push('delivery dates are set and not in the future');
        const od1 = all.filter((r) => r.due === 'overdue').length, od2 = all.filter((r) => r.open && r.eta && r.eta < t).length; if (od1 !== od2) fails.push('overdue count (' + od1 + ' vs ' + od2 + ')');
        const m = CO.thisMonth(), d1 = CO.sumQty(all.filter((r) => r.stage === 'Delivered' && r.month === m)), b = TB.sum(all, [m + '-01'], 'month', m + '-01', t).get(m + '-01');
        if (d1 !== b) fails.push('delivered this month (' + d1 + ' vs ' + b + ')');
        const wd = CO.workdays(m + '-01', CO.monthEnd(m)); if (wd < 20 || wd > 23) fails.push('working days in the month (' + wd + ')');
        const withDes = all.filter((r) => r.open && r.list.length).length, perDes = [...new Set(all.flatMap((r) => r.list))].reduce((n, d) => n + all.filter((r) => r.open && r.list.includes(d)).length, 0);
        if (perDes < withDes) fails.push('designer workloads add up');
        last.ok = 7 - fails.length;
        if (fails.length) add('bad', 'A calculation check failed', 'These numbers did not agree: ' + fails.join('; ') + '. Please tell the admin; refreshing may fix it.', ['Refresh now', () => load(true)]);
      }
      last.at = new Date();
      return out;
    };
    dash.draw('syscheck', (el) => {
      if (S.status === 'loading' && !S.tasks) { el.replaceChildren(); return; }
      const list = checks(), order = { bad: 0, warn: 1, info: 2 }; list.sort((a, b) => order[a.level] - order[b.level]);
      el.replaceChildren(); el.className = 'sys ' + (list.some((x) => x.level === 'bad') ? 'bad' : list.some((x) => x.level === 'warn') ? 'warn' : 'ok');
      const head = document.createElement('button'); head.type = 'button'; head.className = 'sys-head';
      const dot = document.createElement('span'); dot.className = 'sys-dot';
      const tx = document.createElement('span'); tx.className = 'sys-t';
      const real = list.filter((x) => x.level !== 'info').length;
      tx.textContent = !list.length ? 'All systems working: data, sheets, live sync and ' + last.ok + ' calculation checks passed' : real ? real + (real === 1 ? ' thing needs' : ' things need') + ' attention' : 'Working, with ' + list.length + (list.length === 1 ? ' note' : ' notes');
      const when = document.createElement('span'); when.className = 'sys-when'; when.textContent = 'Checked ' + CO.istTime(last.at);
      head.append(dot, tx, when);
      el.append(head);
      if (!list.length) return;
      const open = el.dataset.open !== '0' && (real > 0 || el.dataset.open === '1');
      head.setAttribute('aria-expanded', String(open));
      head.addEventListener('click', () => { el.dataset.open = open ? '0' : '1'; dash.draw('syscheck'); });
      if (!open) return;
      const ul = document.createElement('ul'); ul.className = 'sys-list';
      list.forEach((x) => { const li = document.createElement('li'); li.className = x.level; const b = document.createElement('b'); b.textContent = x.title; const p = document.createElement('span'); p.textContent = x.detail; li.append(b, p); if (x.act) { const a = document.createElement('button'); a.type = 'button'; a.className = 'co-btn'; a.textContent = x.act[0]; a.addEventListener('click', x.act[1]); li.append(a); } ul.append(li); });
      el.append(ul);
    });
    setInterval(() => { if (P.tab === 'today' && document.visibilityState === 'visible') dash.draw('syscheck'); }, 60 * 1000);
    return { checks };
  })();

  renderAll();
  start();
})();
