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
  const TABS = ['mine', 'today', 'standup', 'tasks', 'notes', 'team', 'reports', 'brands', 'health', 'access'];
  /* Access. 'auth': people sign in with Google and have a role. 'key': the older shared key (before sign-in is set up). */
  const CFG = window.CO_CONFIG || {};
  const RANK = { Viewer: 1, Editor: 2, Admin: 3 };
  const ROLE_LABEL = { Viewer: 'View only', Editor: 'Can edit', Admin: 'Admin' };
  const roleText = (u) => u && u.owner ? 'Admin' : (ROLE_LABEL[u && u.role] || (u && u.role) || '') + (u && u.custom ? ' (custom)' : '');
  const A = { mode: null, url: '', clientId: '', domains: [], session: LS.get('co.session', ''), user: null };
  const can = (need) => A.mode === 'key' || !!(A.user && RANK[A.user.role] >= RANK[need]);
  /* Permissions come from the web app (role defaults, fine-tuned per person by the owner). The owner (the Creative Head:
     Admin) has all of them and is the only one who manages access, the activity log, live activity and settings. */
  const isOwner = () => A.mode === 'key' || !!(A.user && A.user.owner);
  // Access management, the activity log and live team activity: the owner and everyone with the Admin role.
  const isAdmin = () => isOwner() || !!(A.user && A.user.role === 'Admin');
  const perm = (k) => A.mode === 'key' || !!(A.user && (A.user.owner || (A.user.perms ? !!A.user.perms[k] : (k === 'edit' ? RANK[A.user.role] >= 2 : k === 'export' || k === 'fasty' ? true : RANK[A.user.role] >= 3))));
  const pageOk = (t) => { if (A.mode !== 'auth' || !A.user) return t !== 'notes' && t !== 'mine' && t !== 'access'; if (t === 'access') return isAdmin(); if (A.user.owner) return true; const pg = A.user.perms && A.user.perms.pages; return pg ? pg.includes(t) : (t !== 'health' || RANK[A.user.role] >= 3); };
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
  // quiet: background calls (the live-activity heartbeat) never sign anyone out; the 30-second check handles that with the right message.
  async function callApi(payload, quiet) {
    const res = await fetch(A.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ session: A.session }, payload)) });
    const body = parse(await res.text());
    if (body.ok && window.__liveAct) { const f = payload.fields || {}, W = { updateTask: () => 'Updated ' + (payload.id || 'a task') + ': ' + Object.keys(f).map((k) => k + ' → ' + f[k]).join(', '), noteSave: () => 'Saved a note', noteDelete: () => 'Deleted a note', noteAction: () => 'Updated an action in a note', setMember: () => 'Changed the team list' }; if (W[payload.action]) window.__liveAct('update', W[payload.action]()); }
    if (!quiet && !body.ok && ['signin_required', 'session_expired', 'no_access'].includes(body.error)) { lostAccess(body); throw new AuthLost(body.error); }
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
      S.sources = src; S.ownNoMatch = !!(body && body.ownNoMatch);
      // Every task tab the web app reports, in its order (newest tab of each kind first).
      const keys = Object.keys(src).filter((k) => !src[k].error && CODATA.kindOf(k, src[k].kind) !== 'team');
      const teamKey = Object.keys(src).find((k) => CODATA.kindOf(k, src[k].kind) === 'team');
      S.teamRaw = CODATA.parseTeam(teamKey ? src[teamKey] : null);
      const known = S.teamRaw.flatMap((m) => [m.name].concat(String(m.aliases || '').split(',').map((x) => x.trim()).filter((x) => x.includes(' '))));
      S.tasks = CODATA.buildTasks(keys.map((k) => ({ kind: CODATA.kindOf(k, src[k].kind), rows: CODATA.parseSource(CODATA.kindOf(k, src[k].kind), src[k], k) })), undefined, known);
      S.ignored = S.tasks.ignored || [];
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
    if (!pageOk('health')) { S.health = null; return; }
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
      // Access changes made by the owner reach open dashboards on the next check (role and fine-grained permissions).
      if (A.mode === 'auth' && body.ok && A.user && body.perms && !A.user.owner && JSON.stringify(body.perms) !== JSON.stringify(A.user.perms) && body.role === A.user.role) {
        A.user.perms = body.perms; A.user.custom = !!body.custom; toast('Your access was updated.'); renderAll(); loadHealth(); ASH.show(perm('fasty'));
      }
      if (A.mode === 'auth' && body.ok && body.role && A.user && body.role !== A.user.role) {
        A.user.role = body.role; if (body.perms) { A.user.perms = body.perms; A.user.custom = !!body.custom; } toast('Your access is now: ' + roleText(A.user) + '.'); renderAll(); loadHealth();
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
      dash.draw('sync-text'); dash.draw('sync-detail');
    } catch (e) { /* a missed check is retried on the next tick */ }
    checking = false;
  }
  setInterval(checkForChanges, 30 * 1000);
  setInterval(() => { if (document.visibilityState === 'visible' && S.status === 'ok') load(false); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.loadedAt) { if (Date.now() - S.loadedAt > 5 * 60 * 1000) load(false); else checkForChanges(); } });
  // Keep the 'checked … ago' line current, and redraw everything when the date changes (overdue and due-today move at midnight).
  let shownDay = new Date().toDateString();
  setInterval(() => { const d = new Date().toDateString(); if (d !== shownDay) { shownDay = d; renderAll(); } else { dash.draw('sync-text'); dash.draw('sync-detail'); } }, 15 * 1000);

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
    // Closed = completed (DONE, REJECTED) or no longer needed; everything else is still in play.
    const CLOSED = new Set(['Delivered', 'Rejected', 'Deprioritised']);
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
        case 'review': return r.shared;
        case 'underreview': return r.review;
        case 'awaiting': return r.awaiting;
        case 'hold': return r.stage === 'Hold';
        case 'delivered': return r.done;
        case 'approved': return r.stage === 'Delivered';
        case 'rejected': return r.stage === 'Rejected';
        case 'delivered-month': return r.done && r.month === thisMonth();
        case 'delivered-range': return r.done && r.ddate && r.ddate >= ctx.from && r.ddate <= ctx.to;
        case 'dropped': return r.stage === 'Deprioritised';
        default: return true;
      }
    };
    const stageColor = (s) => ({ 'WIP': 'var(--st-wip)', 'Shared': 'var(--st-review)', 'No update': 'var(--st-review)', 'Under review': 'var(--st-ureview)', 'To be planned': 'var(--st-plan)', 'Awaiting brief': 'var(--st-await)', 'Rejected': 'var(--worse-fill)', 'Hold': 'var(--st-hold)', 'Changes requested': 'var(--warn)', 'Delivered': 'var(--ok)' })[s];
    // plain: the row already shows how late it is (a "when" badge), so the chip shows only the status.
    const chip = (r, plain) => {
      const el = document.createElement('span');
      let cls = 's-mute', txt = r.stage;
      if (r.due === 'overdue') { cls = 's-bad'; if (!plain) txt = r.stage + ' · late'; }
      else if (r.due === 'today') { cls = 's-warn'; if (!plain) txt = r.stage + ' · today'; }
      else if (r.stage === 'Changes requested') cls = 's-warn';
      else if (r.stage === 'Delivered') cls = 's-ok';
      else if (r.stage === 'Rejected') cls = 's-warn';
      else if (r.stage === 'No update') cls = 's-st st-pending-approval';
      else if (r.stage === 'Under review') cls = 's-st st-under-review';
      else if (r.awaiting) cls = 's-st st-incomplete-brief';
      else if (stageColor(r.stage)) cls = 's-st st-' + r.stage.toLowerCase().replace(/[^a-z]+/g, '-');
      // Extra detail agreed with the Creative Head: why something counts as delivered, and how long a client has had it.
      if (r.awaiting && r.sub) txt = r.sub; // Awaiting brief: say what the brief is waiting for
      if (!plain && r.shared && r.eta && r.eta < today()) { const d = diffDays(r.eta, today()); txt += ' · ' + d + 'd'; el.title = 'With the client since about ' + fmtDate(r.eta) + ' (design ETA)'; }
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
  let landed = false;
  function syncControls() {
    const p = dash.params();
    const admin = A.mode === 'auth' && isAdmin();
    document.body.dataset.admin = A.mode === 'auth' && perm('load') ? '1' : '';
    document.body.dataset.owner = admin ? '1' : '';
    document.querySelectorAll('[data-owner-only]').forEach((x) => { x.hidden = !(A.mode === 'auth' && isOwner()); });
    { const pkc = document.querySelector('[data-draw="packages"]'); if (pkc) pkc.hidden = !pkPerm(); } // brand packages: owner, or people given view/edit
    document.body.dataset.export = perm('export') ? '1' : '';
    const axTab = document.querySelector('.co-tab[data-tab="access"]');
    axTab.hidden = !admin;
    // Pages each person may see (set by the owner on the Access page).
    document.querySelectorAll('.co-tab[data-tab], .btabs .bt[data-tab]').forEach((b) => { if (b.dataset.tab === 'access' || b.dataset.tab === 'notes' || b.dataset.tab === 'mine') return; b.hidden = !pageOk(b.dataset.tab); });
    const badge = axTab.querySelector('.nav-badge'); badge.hidden = !AX.pending; badge.textContent = AX.pending ? AX.pending + ' waiting' : '';
    document.querySelector('.bt-dot').hidden = !(admin && AX.pending);
    const signed = A.mode === 'auth' && !!A.user;
    const bell = document.getElementById('btn-bell'); bell.hidden = !signed;
    const unread = NT.unread(); bell.querySelector('.bell-dot').hidden = !unread;
    bell.title = unread ? unread + ' new notification' + (unread === 1 ? '' : 's') : 'Notifications'; bell.setAttribute('aria-label', bell.title);
    document.querySelector('.co-tab[data-tab="notes"]').hidden = !signed || !pageOk('notes');
    // A sidebar group heading only shows when at least one of its pages does (same layout for every role otherwise).
    document.querySelectorAll('.side .nav-h').forEach((h) => { let n = h.nextElementSibling, any = false; while (n && !n.classList.contains('nav-h')) { if (n.matches('.co-tab') && !n.hidden) any = true; n = n.nextElementSibling; } h.hidden = !any; });
    document.querySelector('.bt[data-tab="notes"]').hidden = !signed;
    document.querySelector('.btabs').classList.toggle('four', !signed);
    document.body.classList.toggle('syncing', !!S.refreshing || S.status === 'loading');
    document.getElementById('add-member').hidden = !perm('team');
    document.querySelector('.co-tab[data-tab="mine"]').hidden = !signed;
    // Team members land on My work (admins on the Overview), unless the link names a page.
    if (!landed && signed && S.team && CO.status() === 'ok') { landed = true; if (!location.hash && !admin && (myDesigner() || !pageOk('today')) && p.tab === 'today') { dash.setParams({ tab: 'mine' }); return; } }
    // On phones the second tab is My work for team members and Stand-up for admins.
    { const bt2 = document.querySelector('.btabs .bt[data-tab="standup"], .btabs .bt[data-tab="mine"]'); const mineFirst = signed && !admin; bt2.dataset.tab = mineFirst ? 'mine' : 'standup'; bt2.querySelector('span').textContent = mineFirst ? 'My work' : 'Stand-up'; }
    const tab = TABS.includes(p.tab) && pageOk(p.tab) ? p.tab : pageOk('today') ? 'today' : 'mine';
    document.querySelectorAll('[data-panel]').forEach((s) => {
      const show = s.dataset.panel === tab;
      // A short entrance when the page changes (not on every refresh).
      if (show && s.hidden && shownTab !== tab) { s.classList.remove('enter'); void s.offsetWidth; s.classList.add('enter'); s.addEventListener('animationend', () => s.classList.remove('enter'), { once: true }); }
      s.hidden = !show;
    });
    shownTab = tab;
    if (tab === 'notes') NB.open();
    if (tab === 'brands') dash.draw('packages');
    document.querySelectorAll('.co-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.bt[data-tab]').forEach((b) => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    document.getElementById('bt-more').toggleAttribute('aria-current', !['today', document.querySelector('.btabs .bt[data-tab="mine"]') ? 'mine' : 'standup', 'tasks', 'notes'].includes(tab));
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
  document.querySelectorAll('.co-kpi[data-go]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.go === 'review') { dash.setParams({ tab: 'brands' }); setTimeout(() => { const w = document.getElementById('waiting'); if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120); } else CO.goTasks(b.dataset.go); }));
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
    mine: ['My work', 'Your overdue work, what is due today, what is next and what you delivered this week.'],
    today: ['Overview', () => 'What needs attention today.'],
    brands: ['Brands', 'Every brand at a glance, and the work waiting on clients.'],
    notes: ['Notes', 'Quick notes for the team: tag people with @ to share, assign them and set reminders.'],
    standup: ['Daily stand-up', 'One card per active designer: what is late, due today, in progress and up next.'],
    tasks: ['Tasks', 'Every task from both sheets. Click a row to open or edit it.'],
    team: ['Team', 'Workload, output and who is on the team.'],
    reports: ['Delivery reports', 'Completed work (delivered + rejected) by month, brand, designer and creative type.'],
    health: ['Data health', 'Rows that make tracking less reliable, and the connection to the sheets.'],
    access: ['Access & activity', 'Who can use the dashboard, and every change they made.']
  };
  const curTab = () => { const t = dash.params().tab; return PAGES[t] && pageOk(t) ? t : pageOk('today') ? 'today' : 'mine'; };
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
  dash.draw('top-av', (el) => { el.replaceChildren(); if (A.user) { const a = CO.av(A.user.name || A.user.email); a.title = (A.user.name || A.user.email) + (isOwner() ? '' : ' · ' + roleText(A.user)); el.append(a); } });
  dash.draw('page-sub', (el) => { const s = PAGES[curTab()][1]; el.textContent = typeof s === 'function' ? s() : s; });
  dash.draw('filter-count', (el) => { const p = dash.params(); const n = ['src', 'designer', 'brand', 'type'].filter((k) => p[k]).length; el.textContent = n ? String(n) : ''; });
  dash.draw('me-card', (el) => {
    el.replaceChildren(); if (!A.user) return;
    const w = document.createElement('span'); w.className = 'su-who';
    const b = document.createElement('b'); b.textContent = A.user.name || A.user.email;
    w.append(b);
    // The owner sees just their name; everyone else also sees their role and email.
    if (!isOwner()) { const sm = document.createElement('small'); sm.textContent = roleText(A.user) + ' · ' + A.user.email; w.append(sm); } el.append(CO.av(A.user.name || A.user.email, 'lg'), w); el.title = A.user.email;
  });
  dash.draw('today-date', (el) => { el.textContent = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); });
  dash.draw('sync-dot', (el) => { el.className = 'co-sync-dot ' + (S.status === 'ok' ? (S.staleError ? 'warn' : 'ok') : S.status === 'error' ? 'bad' : S.status === 'loading' ? 'busy' : ''); });
  // The header shows only the state ("Live"); the details are in a small card on hover or keyboard focus.
  const syncInfo = () => {
    if (S.status !== 'ok') return { short: S.status === 'loading' ? 'Loading' : S.status === 'error' ? 'Offline' : 'Not connected', rows: [] };
    const at = new Date(S.generatedAt || S.loadedAt), live = S.ver && S.ver !== '0';
    const ago = S.checkedAt || S.loadedAt ? Math.max(0, Math.round((Date.now() - (S.checkedAt > S.loadedAt ? S.checkedAt : S.loadedAt)) / 1000)) : null;
    const short = S.cached ? 'Updating' : S.refreshing ? 'Syncing' : S.staleError ? 'Delayed' : live ? 'Live' : 'Connected';
    const rows = [['Data from', CO.istTime(at) + ' IST'], ['Last checked', ago == null ? '—' : ago < 5 ? 'just now' : ago < 120 ? ago + ' seconds ago' : Math.round(ago / 60) + ' minutes ago'], ['Checks', live ? 'every 30 seconds for sheet changes' : 'when you refresh']];
    if (S.cached) rows.push(['Showing', 'the copy saved on this device while fresh data loads']);
    if (S.staleError) rows.push(['Last refresh failed', S.staleError]);
    return { short, rows };
  };
  dash.draw('sync-text', (el) => { const i = syncInfo(); el.textContent = i.short; el.title = i.rows.map((r) => r[0] + ': ' + r[1]).join('\n'); });
  dash.draw('sync-detail', (el) => {
    const i = syncInfo(); el.replaceChildren();
    const h = document.createElement('b'); h.textContent = i.short === 'Live' ? 'Live sync is on' : i.short; el.append(h);
    const dl = document.createElement('dl'); i.rows.forEach(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); }); el.append(dl);
  });
  dash.draw('me', (el) => { el.textContent = A.user ? (A.user.name || A.user.email) + (isOwner() ? '' : ' · ' + roleText(A.user)) : ''; el.title = A.user ? A.user.email : ''; });
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
      : key === 'delivered' ? CO.sumQty(rs.filter((r) => r.done && r.month === m))
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
    review: (rs) => rs.filter((r) => r.shared),
    delivered: (rs) => rs.filter((r) => r.done && r.month === CO.thisMonth())
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
    else if (k === 'review') { const t0 = CO.today(), ds = list.map((r) => r.eta && r.eta < t0 ? CO.diffDays(r.eta, t0) : 0).sort((a, b) => a - b); el.textContent = ds.length ? 'Typical wait ' + ds[Math.floor((ds.length - 1) / 2)] + 'd · ' + ds.filter((d) => d > 14).length + ' over 14 days' : 'Nothing with clients'; cmp(list.length, 'review', 'none'); }
    else if (k === 'delivered') {
      const m = CO.thisMonth(), pm = CO.prevMonth(m), pto = CO.sameWorkdaysEnd(m + '-01', CO.today(), pm + '-01', CO.monthEnd(pm));
      const prevSame = CO.sumQty(rs.filter((r) => r.done && r.ddate && r.ddate >= pm + '-01' && r.ddate <= pto));
      const wd = CO.workdays(m + '-01', CO.today());
      el.append(CO.delta(CO.sumQty(list), prevSame, 'up'), ' vs the first ' + wd + ' working days of ' + CO.fmtMonth(pm).split(' ')[0]);
      el.title = 'Working days are Monday to Friday. ' + wd + ' have passed this month; ' + CO.fmtMonth(pm, true) + ' is counted from the 1st to ' + CO.fmtDate(pto) + ', its ' + wd + 'th working day.';
      // Completed = approved (DONE) + rejected; say how many of each.
      const rej = CO.sumQty(list.filter((r) => r.stage === 'Rejected'));
      const sp = document.createElement('span'); sp.className = 'kpi-split'; sp.textContent = CO.num(CO.sumQty(list) - rej) + ' approved · ' + CO.num(rej) + ' rejected'; el.append(sp);
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
  // Empty results caused by the page filters say so, with one click to clear them.
  const filterNote = () => { const p = dash.params(); return [p.src ? CO.cls(p.src) : '', p.designer === '__none' ? 'Unassigned' : p.designer, p.brand, p.type].filter(Boolean).join(', '); };
  const clearBtn = () => { const b = document.createElement('button'); b.type = 'button'; b.className = 'co-btn'; b.textContent = 'Clear filters'; b.addEventListener('click', () => dash.setParams({ src: '', designer: '', brand: '', type: '' })); return b; };
  const NA = { f: LS.get('co.naf', 'all'), all: false, min: LS.get('co.namin', '') === '1' };
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
    const note = document.createElement('p'); note.className = 'co-note'; const fl = filterNote(); note.textContent = rows.length ? 'Oldest deadline first. Click a task to open it.' + (fl ? ' Filtered: ' + fl + '.' : '') : fl ? 'Nothing for ' + fl + '.' : 'Nothing overdue, due soon or waiting on changes.'; hl.append(h2, note);
    const go = document.createElement('button'); go.type = 'button'; go.className = 'co-link'; go.textContent = 'All overdue'; go.classList.add('na-go'); go.dataset.goTasks = 'overdue'; go.addEventListener('click', () => CO.goTasks('overdue'));
    // Minimise / expand: minimised, the card is one line with the counts and the column beside it reflows under it.
    const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'na-tog'; tog.setAttribute('aria-expanded', String(!NA.min)); tog.setAttribute('aria-controls', 'na-body');
    tog.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'; tog.append(Object.assign(document.createElement('span'), { textContent: NA.min ? 'Expand' : 'Minimise' }));
    tog.title = NA.min ? 'Show the list' : 'Minimise to one line';
    tog.addEventListener('click', () => { flip(() => { NA.min = !NA.min; LS.set('co.namin', NA.min ? '1' : ''); el._drawn = false; dash.draw('attn'); }); const t2 = el.querySelector('.na-tog'); if (t2) t2.focus(); });
    const acts = document.createElement('div'); acts.className = 'na-acts'; acts.append(go, tog);
    head.append(hl, acts); el.append(head);
    el.classList.toggle('collapsed', NA.min); const grid = el.closest('.ov-grid'); if (grid) { grid.classList.toggle('na-min', NA.min); if (NA.min) grid.classList.remove('na-short'); requestAnimationFrame(naFit); }
    if (NA.min) {
      if (rows.length) {
        const parts = [[rows.filter((r) => r.due === 'overdue').length, 'overdue'], [rows.filter((r) => r.due === 'today').length, 'due today'], [rows.filter((r) => r.open && r.eta === tm).length, 'due tomorrow'], [rows.filter((r) => r.stage === 'Changes requested').length, 'changes requested']].filter((x) => x[0]);
        note.replaceChildren(); parts.forEach(([n2, l2], i) => { const b2 = document.createElement('b'); b2.textContent = n2; note.append(i ? ' · ' : '', b2, ' ' + l2); });
      }
      return;
    }
    if (!rows.length) { const ok = document.createElement('div'); ok.className = 'na-clear'; ok.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>'; const p = document.createElement('p'); p.textContent = fl ? 'Nothing needs attention with these filters.' : 'The team is on schedule.'; ok.append(p); if (fl) ok.append(clearBtn()); el.append(ok); return; }
    // composition bar (each task counted once, by its most urgent reason)
    const comp = { late: 0, today: 0, tomorrow: 0, changes: 0 }; rows.forEach((r) => comp[cat(r)]++);
    const bar = document.createElement('div'); bar.className = 'na-bar'; bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', Object.entries(comp).filter((x) => x[1]).map(([k, v]) => v + ' ' + k).join(', '));
    Object.entries(comp).forEach(([k, v]) => { if (!v) return; const seg = document.createElement('i'); seg.className = 'k-' + k; seg.style.flexGrow = '0'; seg.title = v + ' ' + ({ late: 'overdue', today: 'due today', tomorrow: 'due tomorrow', changes: 'changes requested' })[k]; bar.append(seg); requestAnimationFrame(() => requestAnimationFrame(() => { seg.style.flexGrow = String(v); })); });
    if (!animate) bar.querySelectorAll('i').forEach((i) => { i.style.transition = 'none'; });
    if (Object.values(comp).filter(Boolean).length > 1) el.append(bar);
    // filter chips
    const chips = document.createElement('div'); chips.className = 'na-chips'; chips.setAttribute('role', 'tablist'); chips.setAttribute('aria-label', 'Filter');
    F.forEach(([k, l, fn]) => {
      const c = rows.filter(fn).length; if (k !== 'all' && !c) return;
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.className = 'na-chip k-' + k; b.setAttribute('aria-selected', String(NA.f === k));
      const i = document.createElement('i'); const n = document.createElement('b'); n.textContent = c; b.append(i, l, n);
      b.addEventListener('click', () => { NA.f = k; NA.all = false; LS.set('co.naf', k); dash.draw('attn'); });
      chips.append(b);
    });
    const goM = document.createElement('button'); goM.type = 'button'; goM.className = 'na-chip na-go-m'; goM.textContent = 'All overdue ↗'; goM.addEventListener('click', () => CO.goTasks('overdue')); chips.append(goM);
    el.append(chips);
    const fn = (F.find((f) => f[0] === NA.f) || F[0])[2];
    const list = rows.filter(fn), LIM = matchMedia('(max-width: 640px)').matches ? 8 : 40;
    const ul = document.createElement('ul'); ul.className = 'na-list'; ul.id = 'na-body';
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
    if (!list.length) {
      // Nothing dated in the next two weeks: show the open work that has no ETA yet (it needs a date), oldest request first.
      const noEta = CO.rows().filter((r) => r.due === 'noeta').sort((a, b) => (a.req || '9999').localeCompare(b.req || '9999'));
      CO.emptyRow(tb, 4, noEta.length ? 'Nothing due in the next two weeks. Open work with no ETA, oldest request first:' : 'No open work due in the next two weeks.');
      noEta.slice(0, 5).forEach((r) => {
        const tr = tb.insertRow(); tr.className = 'click up-mini'; tr.dataset.uid = r.uid; const td = tr.insertCell(); td.colSpan = 4;
        const row = document.createElement('div'); row.className = 'up-row';
        const chip = document.createElement('span'); chip.className = 'up-chip'; chip.textContent = 'No ETA';
        const tx = document.createElement('span'); tx.className = 'up-t'; const b = document.createElement('b'); b.textContent = r.brand; tx.append(b, ' · ' + CO.topicText(r)); tx.title = (r.id ? r.id + ' · ' : '') + r.brand + ' · ' + CO.topicText(r);
        const who = document.createElement('span'); who.className = 'up-who'; who.textContent = r.list.length ? r.list.join(', ') : 'Unassigned';
        row.append(chip, tx, who); td.append(row);
      });
      return;
    }
    list.forEach((r) => cells(tb.insertRow(), r, ['when', 'task', 'who', 'stage']));
  });
  dash.draw('upcoming-noeta', (el) => {
    if (CO.status() !== 'ok') { el.textContent = ''; return; }
    const n = CO.rows().filter((r) => r.due === 'noeta').length;
    el.textContent = n ? n + ' open with no ETA' : ''; el.hidden = !n;
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
    el.append(head); collapser(el, 'unassigned', 'Unassigned');
    if (!open.length) { const p = document.createElement('p'); p.className = 'su-free'; p.textContent = 'Every open task has a designer.'; el.append(p); return; }
    const late = open.filter((r) => r.due === 'overdue').length, noeta = open.filter((r) => r.due === 'noeta').length;
    const big = document.createElement('div'); big.className = 'uq-big';
    const b = document.createElement('b'); b.textContent = CO.num(CO.sumQty(open)); const sp = document.createElement('span');
    sp.textContent = (CO.sumQty(open) === 1 ? 'creative' : 'creatives') + ' waiting' + (late ? ' · ' : '') ; if (late) { const x = document.createElement('span'); x.className = 'bad'; x.textContent = late + ' overdue'; sp.append(x); } if (noeta) sp.append(' · ' + noeta + ' with no ETA');
    big.append(b, sp); el.append(big);
    const list = document.createElement('div'); list.className = 'uq-list'; list.dataset.fill = '1';
    open.slice().sort((a, b2) => (a.due === 'overdue' ? 0 : 1) - (b2.due === 'overdue' ? 0 : 1) || (a.eta || '9999').localeCompare(b2.eta || '9999') || String(a.req || '').localeCompare(String(b2.req || ''))).slice(0, 20).forEach((r, i) => {
      const row = document.createElement('div'); row.className = 'row click'; row.dataset.uid = r.uid; row.tabIndex = 0; if (i >= 5) row.hidden = true; // more show when the column has room
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
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Open creatives per designer: ' + data.map((d) => d.name + ' ' + d.total + (d.overdue ? ' (' + d.overdue + ' overdue)' : '')).join(', '));
    const meas = svg.append('text').attr('class', 'lbl').text(data.reduce((a, d) => d.name.length > a.length ? d.name : a, ''));
    const L = Math.min(W * 0.45, meas.node().getComputedTextLength() + 14); meas.remove();
    const x = d3.scaleLinear([0, d3.max(data, (d) => d.total)], [L, W - 34]);
    const y = d3.scaleBand(data.map((d) => d.name), [0, H - 24]).padding(0.42);
    const keys = [['overdue', 'var(--worse-fill)', 'Overdue'], ['week', 'var(--primary)', 'Due in 7 days'], ['later', 'var(--chart-later)', 'Later or no ETA']];
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
    const base = [['To be planned', 'tbp'], ['WIP', 'wip'], ['Changes requested', 'changes'], ['Under review', 'underreview'], ['Shared', 'review'], ['No update', 'review'], ['Awaiting brief', 'awaiting'], ['Hold', 'hold']];
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
    const rs = CO.rows().filter((r) => r.done && r.month);
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
    const sum = (rows, keys, g, from, to) => { const m = new Map(keys.map((k) => [k, 0])); rows.forEach((r) => { if (r.done && r.ddate && r.ddate >= from && r.ddate <= to) { const k = key(r.ddate, g); if (m.has(k)) m.set(k, m.get(k) + (r.qty || 1)); } }); return m; };
    // The window to compare a bucket with: the bucket before it, cut to the same number of elapsed days when the bucket is still running.
    // Running buckets are matched on working days elapsed (Mon–Fri), so a month 7 working days in is compared with the first 7 working days of the month before.
    const prevWindow = (k, g) => { const pk = prev(k, g), today = CO.today(); const running = end(k, g) >= today; return { from: pk, to: running ? (g === 'day' ? end(pk, g) : CO.sameWorkdaysEnd(k, today, pk, end(pk, g))) : end(pk, g), partial: running }; };
    const between = (rows, f, t) => CO.sumQty(rows.filter((r) => r.done && r.ddate && r.ddate >= f && r.ddate <= t));
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
    el.textContent = s.g === 'custom' ? 'Creatives completed per ' + TB.G[g].noun + ', ' + CO.fmtDate(s.from) + ' to ' + CO.fmtDate(s.to) + '. Hover for details.' : 'Creatives completed per ' + TB.G[g].noun + ', last ' + TB.G[g].n + ' ' + TB.G[g].noun + 's. Hover for details.';
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
    // Taller when the card beside it (Top brands) is taller, so the two cards end together without blank space.
    let H = 230; { const card = el.closest('.co-card'), grid = card && card.parentElement, sib = grid && [...grid.children].find((c) => c !== card && c.classList.contains('co-card'));
      if (sib && getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length > 1) { const extra = sib.offsetHeight - card.offsetHeight; H = Math.max(230, Math.min(420, (el.offsetHeight || 230) + extra)); }
      if (sib && !el._ro) { let tm = 0; el._ro = new ResizeObserver(() => { clearTimeout(tm); tm = setTimeout(() => { const c2 = el.closest('.co-card'); if (Math.abs(sib.offsetHeight - c2.offsetHeight) > 12) { el._drawn = false; dash.draw('trend'); } }, 120); }); el._ro.observe(sib); } }
    const W = Math.max(300, el.clientWidth), mB = 26, mT = 16;
    const lastRunning = ser[ser.length - 1].running;
    const done = lastRunning ? ser.slice(0, -1) : ser, avg = d3.mean(done, (d) => d.n) || 0;
    const y = d3.scaleLinear([0, Math.max(4, d3.max(ser, (d) => d.n), avg) * 1.1], [H - mB, mT]).nice();
    const ticks = y.ticks(4);
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Creatives completed per ' + TB.G[g].noun + ': ' + ser.map((d) => TB.label(d.w, g) + ' ' + d.n).join(', '));
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
      // Not joined to the line: a part-week (or month) is not comparable with full ones, so it stands alone, labelled.
      svg.append('circle').attr('r', 4.5).attr('cx', x(last.w)).attr('cy', y(last.n)).style('fill', 'var(--panel)').style('stroke', 'var(--bar)').attr('stroke-width', 2).style('opacity', 0.8);
      const wd = Math.max(1, CO.workdays(last.w, CO.today()));
      svg.append('text').attr('class', 'ref-l').attr('x', x(last.w) - 8).attr('y', y(last.n) - 10).attr('text-anchor', 'end').text(CO.num(last.n) + ' so far (' + wd + ' working day' + (wd === 1 ? '' : 's') + ')');
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
    const w = brandWindow(), del = CO.rows().filter((r) => r.done && r.ddate);
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
    const deliveredLog = new Set(DY.moves.filter((m) => m.to === 'Delivered' || m.to === 'Rejected').map((m) => m.id));
    const startedLog = new Set(DY.moves.filter((m) => m.to === 'WIP').map((m) => m.id));
    const pick = all.filter((r) => (r.stage === 'To be planned' || r.stage === 'Changes requested') && r.eta && r.eta >= t && r.eta <= next);
    const wip = all.filter((r) => r.stage === 'WIP');
    const done = all.filter((r) => r.done && ((r.id && deliveredLog.has(r.id)) || r.ddate === t));
    const carried = all.filter((r) => r.due === 'overdue');
    return { pick, wip, done, carried, startedLog, deliveredLog };
  };
  /* Today widget (sidebar on desktop, top of the Overview on phones): a progress ring for the day, four tiles
     (pick up, in progress, delivered, carried forward) and the tasks behind the chosen tile. */
  const TW = { sel: LS.get('co.twsel', ''), open: LS.get('co.twopen', '0') === '1', pop: false };
  const TW_KINDS = [['pick', 'Pick up', 'To be planned or changes requested, due today or the next working day'], ['wip', 'In progress', 'WIP'], ['done', 'Completed', 'Completed today: status changed to DONE or REJECTED today (or Delivered On / ETA today)'], ['carried', 'Carried over', 'Open and past its ETA: the same tasks as the Overdue number']];
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
    tog.addEventListener('click', (e) => { e.stopPropagation(); flip(() => { setOpen(!isOpen); dash.draw('tw'); }); });
    head.append(rWrap, tt, tog);
    // tiles
    const tiles = document.createElement('div'); tiles.className = 'tw-tiles'; tiles.setAttribute('role', 'tablist'); tiles.setAttribute('aria-label', 'Today');
    TW_KINDS.forEach(([k, l, tip]) => {
      const t = document.createElement('button'); t.type = 'button'; t.className = 'tw-tile k-' + k + (n(k) ? '' : ' zero'); t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', String(TW.sel === k)); t.title = tip;
      const num = document.createElement('b'); const lab = document.createElement('span'); lab.textContent = l; t.append(num, lab); if (k === 'carried') { const sm2 = document.createElement('small'); sm2.className = 'tw-sub'; sm2.textContent = 'overdue'; t.append(sm2); }
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
    if (!list.length) { const m = document.createElement('li'); m.className = 'tw-empty'; const fl = filterNote(); m.textContent = (TW.sel === 'done' ? 'Nothing delivered yet today' : TW.sel === 'carried' ? 'Nothing carried over' : 'Nothing here right now') + (fl ? ' for ' + fl + '.' : '.'); if (fl) { m.append(document.createElement('br'), clearBtn()); } ul.append(m); }
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

  /* ================= Shared task row (My work, Brands) ================= */
  const workRow = (r, opts) => {
    const o = opts || {}, t = CO.today(), d = r.eta ? CO.diffDays(t, r.eta) : null;
    const k = o.kind || (r.due === 'overdue' ? 'late' : r.due === 'today' ? 'today' : r.shared ? 'changes' : 'tomorrow');
    const li = document.createElement('li'); li.className = 'na-row k-' + k; li.dataset.uid = r.uid; li.tabIndex = 0;
    const rail = document.createElement('i'); rail.className = 'na-rail';
    const main = document.createElement('div'); main.className = 'na-main';
    const t1 = document.createElement('span'); t1.className = 'na-t'; const bb = document.createElement('b'); bb.textContent = r.brand; if (o.noBrand) t1.append(CO.topicText(r)); else t1.append(bb, ' ' + CO.topicText(r)); t1.title = r.brand + ' · ' + CO.topicText(r);
    const m = document.createElement('span'); m.className = 'na-m'; const id = document.createElement('span'); id.className = 'co-id'; id.textContent = r.id || 'no ID';
    m.append(id, r.type + (r.qty > 1 ? ' ×' + r.qty : ''), CO.srcTag(r)); if (!o.waiting) m.append(CO.chip(r, true));
    main.append(t1, m); li.append(rail, main);
    if (o.who !== false) { const w = document.createElement('span'); w.className = 'na-who'; (r.list.length ? r.list : ['Unassigned']).slice(0, 2).forEach((x) => w.append(CO.av(x))); const wn = document.createElement('span'); wn.className = 'na-wn'; wn.textContent = r.list.length ? r.list[0].split(' ')[0] + (r.list.length > 1 ? ' +' + (r.list.length - 1) : '') : 'Unassigned'; w.append(wn); li.append(w); }
    const when = document.createElement('span'); when.className = 'na-when k-' + k;
    if (o.waiting) { const wd = r.eta ? Math.max(0, CO.diffDays(r.eta, t)) : null; when.textContent = wd == null ? 'No date' : wd + 'd waiting'; when.title = r.eta ? 'Shared about ' + CO.fmtDate(r.eta, true) + ' (design ETA)' : ''; }
    else if (o.done) { when.textContent = r.ddate === t ? 'Today' : CO.fmtDate(r.ddate); when.title = r.date_basis === 'eta' ? 'Delivered ' + CO.fmtDate(r.ddate, true) + ' (Design ETA)' : 'No Design ETA: dated by request date'; }
    else { when.textContent = d == null ? 'No ETA' : d < 0 ? (-d) + 'd late' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : CO.fmtDate(r.eta); when.title = r.eta ? 'Design ETA ' + CO.fmtDate(r.eta, true) : 'No Design ETA'; }
    li.append(when); return li;
  };
  const mondayOf = (iso) => { let d = iso; while (new Date(d + 'T00:00:00Z').getUTCDay() !== 1) d = CO.addDays(d, -1); return d; };
  const filterNote2 = () => { const p = dash.params(); return [p.src ? CO.cls(p.src) : '', p.designer === '__none' ? 'Unassigned' : p.designer, p.brand, p.type].filter(Boolean).join(', '); };
  const clearBtn2 = () => { const b = document.createElement('button'); b.type = 'button'; b.className = 'co-btn'; b.textContent = 'Clear filters'; b.addEventListener('click', () => dash.setParams({ src: '', designer: '', brand: '', type: '' })); return b; };
  const card = (title, note, count) => { const c = document.createElement('section'); c.className = 'co-card'; const hd = document.createElement('div'); hd.className = 'na-head'; const l = document.createElement('div'); const h2 = document.createElement('h2'); h2.className = 'co-h2'; h2.textContent = title; if (count != null) { const n = document.createElement('span'); n.className = 'na-count' + (count ? '' : ' ok'); n.textContent = count; h2.append(n); } const p = document.createElement('p'); p.className = 'co-note'; p.textContent = note; l.append(h2, p); hd.append(l); c.append(hd); return c; };
  const emptyLine = (text) => { const p = document.createElement('p'); p.className = 'mw-empty'; p.textContent = text; return p; };

  /* ================= My work =================
     One person's day: overdue and due today first, then what is next, what is with the client and what they delivered
     this week. Team members land here; admins can view any team member. */
  const MW = { who: LS.get('co.mwho2', '') };
  dash.draw('mine', (el) => {
    if (A.mode !== 'auth' || !A.user) { el.replaceChildren(); return; }
    if (CO.notReady(el, 'box')) return;
    el.replaceChildren();
    const fn = String(A.user.name || '').toLowerCase().split(' ')[0];
    const admin = perm('load'), mine = myDesigner() || CT.writers().find((w) => w.toLowerCase().split(' ')[0] === fn) || null; // content writers not on the team list (Gul)
    const people = (S.team || []).filter((m) => m.status !== 'Inactive' && !EF.hidden(m.name)).map((m) => m.name).concat(CT.writers().filter((w) => !(S.team || []).some((m) => m.name === w))).sort((a, b) => a.localeCompare(b));
    // My work is always the signed-in person's own work first; "View as" (owner and managers) is a deliberate switch.
    if (mine && !people.includes(mine)) people.unshift(mine);
    let who = admin && MW.who && people.includes(MW.who) ? MW.who : mine || (admin ? people[0] : null);
    const head = document.createElement('section'); head.className = 'co-card mw-head';
    if (!who) {
      const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'Your name (' + (A.user.name || A.user.email) + ') is not on the team list, so there is no personal view yet. Ask the admin to add it, or to add this spelling under "Also written as" in the team sheet.';
      head.append(p); el.append(head); return;
    }
    const all = CO.rows().filter((r) => r.list.includes(who));
    const t = CO.today(), wk = mondayOf(t);
    const open = all.filter((r) => r.open), focus = open.filter((r) => r.due === 'overdue' || r.due === 'today').sort((a, b) => (a.eta || '').localeCompare(b.eta || ''));
    const next = open.filter((r) => r.due !== 'overdue' && r.due !== 'today').sort((a, b) => (a.eta || '9999').localeCompare(b.eta || '9999') || (a.priority || 'P9').localeCompare(b.priority || 'P9'));
    const waiting = all.filter((r) => r.shared).sort((a, b) => (a.eta || '9999').localeCompare(b.eta || '9999'));
    const done = all.filter((r) => r.done && r.ddate && r.ddate >= wk && r.ddate <= t).sort((a, b) => b.ddate.localeCompare(a.ddate));
    // header: who, role, load; admins pick the person
    const id = document.createElement('div'); id.className = 'mw-id'; const av = CO.av(who); av.classList.add('lg');
    const nm = document.createElement('div'); const h2 = document.createElement('h2'); h2.className = 'co-h2'; h2.textContent = who === mine ? 'Your work, ' + who.split(' ')[0] : who; const rl = document.createElement('p'); rl.className = 'co-note';
    const L = EF.load(who), rTxt = String(EF.role(who) || '').replace(/\s*\(not shown\)\s*/i, '').trim(); rl.textContent = [who === mine && isOwner() ? '' : rTxt || 'Role not set', open.length ? open.length + ' open' : 'nothing open', L.hours ? 'about ' + (L.days < 1 ? Math.round(L.hours) + ' h' : L.days.toFixed(1) + ' working days') + ' of work' + (L.content && !open.length ? ' (content writing)' : '') : ''].filter(Boolean).join(' · ');
    nm.append(h2, rl); id.append(av, nm); head.append(id);
    if (admin) {
      const sel = document.createElement('select'); sel.className = 'co-select'; sel.setAttribute('aria-label', 'View as');
      people.forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n === mine ? n + ' (you)' : n; sel.append(o); }); sel.value = who;
      if (who !== mine && mine) { const back = document.createElement('button'); back.type = 'button'; back.className = 'co-link mw-back'; back.textContent = 'Back to my work'; back.addEventListener('click', () => { MW.who = ''; LS.set('co.mwho2', ''); dash.draw('mine'); }); head.append(back); }
      sel.addEventListener('change', () => { MW.who = sel.value === mine ? '' : sel.value; LS.set('co.mwho2', MW.who); dash.draw('mine'); });
      const lab = document.createElement('label'); lab.className = 'mw-as'; lab.append('View as ', sel); head.append(lab);
    }
    // tiles
    const tiles = document.createElement('div'); tiles.className = 'mw-tiles';
    [['late', 'Overdue', open.filter((r) => r.due === 'overdue')], ['today', 'Due today', open.filter((r) => r.due === 'today')], ['wip', 'In progress', open.filter((r) => r.stage === 'WIP')], ['done', 'Delivered this week', done]].forEach(([k, l, list]) => {
      const b = document.createElement('div'); b.className = 'mw-tile k-' + k + (list.length ? '' : ' zero'); const n = document.createElement('b'); n.textContent = CO.num(list.length); const sp = document.createElement('span'); sp.textContent = l; const sm = document.createElement('small'); const cq = CO.sumQty(list); sm.textContent = (list.length === 1 ? '1 task' : list.length + ' tasks') + (cq !== list.length ? ' · ' + cq + ' creatives' : ''); b.append(n, sp, sm); tiles.append(b);
    });
    head.append(tiles); el.append(head);
    const fl = filterNote2();
    const section = (title, note, list, opts, empty, limit) => {
      const c = card(title, note, list.length); collapser(c, 'mw:' + title, title); const ul = document.createElement('ul'); ul.className = 'na-list mw-list';
      list.slice(0, limit || 50).forEach((r, i) => { const li = workRow(r, Object.assign({ who: false }, opts)); li.classList.add('in'); li.style.setProperty('--i', Math.min(i, 10)); ul.append(li); });
      if (list.length > (limit || 50)) { const m = document.createElement('li'); m.className = 'tw-more'; m.textContent = '+' + (list.length - (limit || 50)) + ' more in Tasks'; ul.append(m); }
      if (!list.length) { c.append(emptyLine(fl ? empty + ' (filtered: ' + fl + ')' : empty)); if (fl) c.append(clearBtn2()); } else c.append(ul);
      return c;
    };
    const grid = document.createElement('div'); grid.className = 'mw-grid';
    const left = document.createElement('div'); left.className = 'mw-col'; const right = document.createElement('div'); right.className = 'mw-col';
    // Content writers: briefs whose content they are still writing (the design has not started).
    // Content tasks (briefs, scripts, content), separate from design: every task whose Content Owner names this person.
    const cto = CT.of(who), isWriter = CT.writers().some((w) => w === who) || CT.contentOnly(who);
    if (isWriter || cto.open.length) left.append(section('Content tasks', 'Briefs, scripts and content in your bucket.', cto.open, { kind: 'changes' }, 'No open content tasks.'));
    if (cto.client.length) right.append(section('Content with the client', 'Briefs shared with the client.', cto.client, { waiting: true }, ''));
    left.append(section('Focus now', 'Overdue and due today, oldest deadline first.', focus, {}, 'Nothing overdue or due today.'),
      section('Up next', 'Open work by ETA; work with no ETA comes last.', next, { kind: 'tomorrow' }, 'Nothing else open.', 12));
    if (who === mine && isOwner()) { const rev = CO.rows().filter((r) => r.review).sort((a, b) => (a.eta || '9999').localeCompare(b.eta || '9999')); right.append(section('Waiting for your review', 'Your team finished these (UNDER REVIEW). Move each to DONE or SHARED after reviewing.', rev, { kind: 'today' }, 'Nothing waiting for your review.')); }
    right.append(section('With the client', 'Shared and waiting for approval. Not counted as late.', waiting, { waiting: true, kind: 'changes' }, 'Nothing waiting on a client.', 10),
      section('Delivered this week', 'Since Monday ' + CO.fmtDate(wk) + '.', done, { done: true, kind: 'done' }, 'Nothing delivered yet this week.'));
    grid.append(left, right); el.append(grid);
  });

  /* ================= Brands ================= */
  const BR2 = { q: '', sort: LS.get('co.brsort', 'late'), dir: -1 };
  dash.draw('brands', (el) => {
    if (CO.notReady(el, 'box')) return;
    const keepFocus = document.activeElement && document.activeElement.classList.contains('br-search');
    el.replaceChildren();
    const rows = CO.rows(), t = CO.today(), m0 = t.slice(0, 7) + '-01', pm = CO.addMonths(t.slice(0, 7), -1), pm0 = pm + '-01';
    const lastSameEnd = CO.sameWorkdaysEnd(m0, t, pm0, CO.monthEnd(pm));
    const map = new Map();
    rows.forEach((r) => {
      const b = map.get(r.brand) || { brand: r.brand, src: new Set(), open: 0, late: 0, wait: 0, oldest: null, thisM: 0, lastSame: 0, last: '' };
      b.src.add(r.source);
      if (r.open) { b.open++; if (r.due === 'overdue') b.late++; }
      if (r.shared) { b.wait++; const wd = r.eta && r.eta < t ? CO.diffDays(r.eta, t) : 0; if (b.oldest == null || wd > b.oldest) b.oldest = wd; }
      if (r.done && r.ddate) { if (r.ddate >= m0 && r.ddate <= t) b.thisM += r.qty || 1; if (r.ddate >= pm0 && r.ddate <= lastSameEnd) b.lastSame += r.qty || 1; if (r.ddate > b.last) b.last = r.ddate; }
      map.set(r.brand, b);
    });
    let list = [...map.values()].filter((b) => b.open || b.wait || b.thisM || b.lastSame);
    const q = BR2.q.trim().toLowerCase(); if (q) list = list.filter((b) => b.brand.toLowerCase().includes(q));
    const key = { brand: (b) => b.brand.toLowerCase(), open: (b) => b.open, late: (b) => b.late * 1000 + b.open, wait: (b) => b.wait, thisM: (b) => b.thisM, last: (b) => b.last }[BR2.sort] || ((b) => b.late);
    list.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (BR2.sort === 'brand' ? 1 : -1) * (BR2.dir === 1 ? -1 : 1) || a.brand.localeCompare(b.brand); });
    const hd = document.createElement('div'); hd.className = 'na-head';
    const l = document.createElement('div'); const h2 = document.createElement('h2'); h2.className = 'co-h2'; h2.textContent = 'Brands'; const note = document.createElement('p'); note.className = 'co-note'; note.textContent = 'Brands with open work, work with a client or deliveries this month or last. Click a brand for its tasks.'; l.append(h2, note);
    const tools = document.createElement('div'); tools.className = 'br-tools';
    const search = document.createElement('input'); search.type = 'search'; search.className = 'co-input br-search'; search.placeholder = 'Search brands'; search.value = BR2.q; search.setAttribute('aria-label', 'Search brands');
    search.addEventListener('input', () => { BR2.q = search.value; dash.draw('brands'); });
    const count = document.createElement('span'); count.className = 'co-note'; count.textContent = list.length + (list.length === 1 ? ' brand' : ' brands');
    tools.append(search, count); hd.append(l, tools); el.append(hd); collapser(el, 'brands', 'Brands');
    if (!list.length) { const fl = filterNote2(); el.append(emptyLine(q ? 'No brand matches "' + BR2.q + '".' : fl ? 'No brands for ' + fl + '.' : 'No brand activity yet.')); if (fl) el.append(clearBtn2()); if (keepFocus) search.focus(); return; }
    const wrap = document.createElement('div'); wrap.className = 'co-tablewrap';
    const tb = document.createElement('table'); tb.className = 'co-table br-table';
    const cols = [['brand', 'Brand', ''], ['src', 'Int / Ext', 'co-hide-md'], ['open', 'Open', 'n'], ['late', 'Late', 'n'], ['wait', 'With client', 'n'], ['thisM', 'Completed this month', 'n'], ['vs', 'vs same days last month', 'n co-hide-md'], ['last', 'Last delivery', 'co-hide-md']];
    const thead = tb.createTHead().insertRow();
    cols.forEach(([k, label, cls]) => {
      const th = document.createElement('th'); th.className = cls; th.scope = 'col';
      if (['brand', 'open', 'late', 'wait', 'thisM', 'last'].includes(k)) { const b = document.createElement('button'); b.type = 'button'; b.className = 'th-sort'; b.textContent = label; th.setAttribute('aria-sort', BR2.sort === k ? (BR2.dir === -1 ? 'descending' : 'ascending') : 'none'); b.addEventListener('click', () => { if (BR2.sort === k) BR2.dir = -BR2.dir; else { BR2.sort = k; BR2.dir = -1; } LS.set('co.brsort', k); dash.draw('brands'); }); th.append(b); }
      else th.textContent = label;
      thead.append(th);
    });
    const body = tb.createTBody();
    list.forEach((b) => {
      const tr = body.insertRow(); tr.className = 'click'; tr.tabIndex = 0; tr.title = 'Open ' + b.brand + "'s tasks";
      const go = () => CO.goTasks('active', { brand: b.brand });
      tr.addEventListener('click', go); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      const nb = document.createElement('b'); nb.textContent = b.brand; CO.td(tr, nb);
      CO.td(tr, [...b.src].map((x) => CO.cls(x)).join(' + '), 'co-hide-md co-muted');
      CO.td(tr, CO.num(b.open), 'n'); CO.td(tr, b.late ? CO.num(b.late) : '0', 'n' + (b.late ? ' bad' : ''));
      const w = CO.td(tr, b.wait ? b.wait + (b.oldest ? ' · ' + b.oldest + 'd' : '') : '0', 'n'); if (b.wait) w.title = 'Oldest has waited about ' + b.oldest + ' days';
      CO.td(tr, CO.num(b.thisM), 'n');
      const vs = document.createElement('span'); vs.append(CO.delta(b.thisM, b.lastSame, 'up')); CO.td(tr, vs, 'n co-hide-md');
      CO.td(tr, b.last ? CO.fmtDate(b.last) : '—', 'co-hide-md co-muted');
    });
    wrap.append(tb); el.append(wrap);
    if (keepFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
  });

  /* Waiting on client: everything shared and waiting for approval, by brand, longest wait first. */
  const WC = { band: '' };
  const WAIT_BANDS = [['b7', 'Up to 7 days', (d) => d <= 7], ['b14', '8–14 days', (d) => d > 7 && d <= 14], ['b30', '15–30 days', (d) => d > 14 && d <= 30], ['b99', 'Over 30 days', (d) => d > 30]];
  dash.draw('waiting', (el) => {
    if (CO.notReady(el, 'box')) return;
    el.replaceChildren();
    const t = CO.today(), rows = CO.rows().filter((r) => r.shared);
    const days = (r) => r.eta && r.eta < t ? CO.diffDays(r.eta, t) : 0;
    const band = WAIT_BANDS.find((b) => b[0] === WC.band), shown = band ? rows.filter((r) => band[2](days(r))) : rows;
    const by = new Map(); shown.forEach((r) => { const l = by.get(r.brand) || []; l.push(r); by.set(r.brand, l); });
    const groups = [...by].map(([brand, list]) => ({ brand, list: list.sort((a, b) => days(b) - days(a)), oldest: Math.max(...list.map(days)) })).sort((a, b) => b.oldest - a.oldest || b.list.length - a.list.length);
    const over = rows.filter((r) => days(r) > 14).length;
    const hd = document.createElement('div'); hd.className = 'na-head';
    const l = document.createElement('div'); const h2 = document.createElement('h2'); h2.className = 'co-h2'; h2.textContent = 'Waiting on client'; const n = document.createElement('span'); n.className = 'na-count' + (rows.length ? '' : ' ok'); n.textContent = rows.length; h2.append(n);
    const note = document.createElement('p'); note.className = 'co-note'; note.textContent = rows.length ? 'Shared and waiting for approval, by brand, longest wait first. Days are counted from the design ETA. ' + over + ' have waited more than 14 days.' : 'Nothing is waiting on a client.'; l.append(h2, note);
    const dl = document.createElement('button'); dl.type = 'button'; dl.className = 'co-btn dl-csv'; dl.textContent = 'Download CSV'; dl.disabled = !rows.length;
    dl.addEventListener('click', () => CO.csv('waiting-on-client-' + t + '.csv', ['Brand', 'ID', 'Creative', 'Type', 'Creatives', 'Designer', 'Shared (design ETA)', 'Days waiting', 'Internal / External'], groups.flatMap((g) => g.list.map((r) => [r.brand, r.id, CO.topicText(r), r.type, r.qty || 1, r.list.join(', '), r.eta || '', days(r), CO.cls(r.source)]))));
    hd.append(l, dl); el.append(hd); collapser(el, 'waiting', 'Waiting on client');
    if (!rows.length) { const fl = filterNote2(); if (fl) { el.append(emptyLine('Nothing for ' + fl + '.'), clearBtn2()); } return; }
    // How long approvals take: the median and the longest wait, then how many tasks fall in each band (click to filter).
    const ds = rows.map(days).sort((a, b) => a - b), med = ds[Math.floor((ds.length - 1) / 2)], max = ds[ds.length - 1];
    const dist = document.createElement('div'); dist.className = 'wd';
    const sum = document.createElement('p'); sum.className = 'wd-sum'; const mb = document.createElement('b'); mb.textContent = med + (med === 1 ? ' day' : ' days'); const xb = document.createElement('b'); xb.textContent = max + (max === 1 ? ' day' : ' days');
    if (rows.length === 1) sum.append('1 task, waiting ', xb); else sum.append('Typical wait ', mb, ' (median of ' + rows.length + ' tasks) · longest ', xb);
    const counts = WAIT_BANDS.map(([k, l, fn]) => ({ k, l, n: rows.filter((r) => fn(days(r))).length, late: k === 'b30' || k === 'b99' })), top = Math.max(1, ...counts.map((c) => c.n));
    const bars = document.createElement('div'); bars.className = 'wd-bars'; bars.setAttribute('role', 'group'); bars.setAttribute('aria-label', 'Tasks by days waiting: ' + counts.map((c) => c.l + ' ' + c.n).join(', ') + '. Choose a band to list only those tasks.');
    counts.forEach((c) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'wd-row' + (c.late ? ' late' : '') + (WC.band === c.k ? ' on' : ''); b.setAttribute('aria-pressed', String(WC.band === c.k)); b.disabled = !c.n && WC.band !== c.k;
      const lab = document.createElement('span'); lab.className = 'wd-l'; lab.textContent = c.l;
      const tr = document.createElement('span'); tr.className = 'wd-track'; const fill = document.createElement('i'); fill.style.width = (c.n / top * 100) + '%'; tr.append(fill);
      const v = document.createElement('b'); v.className = 'wd-v'; v.textContent = c.n; const pc = document.createElement('small'); pc.textContent = Math.round(c.n / rows.length * 100) + '%'; v.append(pc);
      b.append(lab, tr, v); b.title = c.n + ' tasks waiting ' + c.l.toLowerCase() + (WC.band === c.k ? ' (click again to show all)' : ' (click to list only these)');
      b.dataset.band = c.k; b.addEventListener('click', () => { WC.band = WC.band === c.k ? '' : c.k; dash.draw('waiting'); const again = document.querySelector('.wd-row[data-band="' + c.k + '"]'); if (again) again.focus(); });
      bars.append(b);
    });
    dist.append(sum, bars);
    if (band) { const f = document.createElement('p'); f.className = 'co-note wd-f'; f.textContent = 'Showing ' + shown.length + ' waiting ' + band[1].toLowerCase() + '. '; const all = document.createElement('button'); all.type = 'button'; all.className = 'co-link'; all.textContent = 'Show all ' + rows.length; all.addEventListener('click', () => { WC.band = ''; dash.draw('waiting'); }); f.append(all); dist.append(f); }
    el.append(dist);
    const wrap = document.createElement('div'); wrap.className = 'wc-groups';
    groups.forEach((g, gi) => {
      const d = document.createElement('details'); d.className = 'wc-group'; if (gi < 3) d.open = true;
      const sm = document.createElement('summary'); const b = document.createElement('b'); b.textContent = g.brand; const c = document.createElement('span'); c.className = 'co-note'; c.textContent = g.list.length + (g.list.length === 1 ? ' task' : ' tasks'); const o = document.createElement('span'); o.className = 'na-when ' + (g.oldest > 14 ? 'k-late' : 'k-changes'); o.textContent = 'oldest ' + g.oldest + 'd';
      sm.append(b, c, o); d.append(sm);
      const ul = document.createElement('ul'); ul.className = 'na-list'; g.list.forEach((r) => ul.append(workRow(r, { waiting: true, noBrand: true, kind: days(r) > 14 ? 'late' : 'changes' }))); d.append(ul);
      wrap.append(d);
    });
    el.append(wrap);
  });

  /* Reports: turnaround, from the request date to the Design ETA (the delivery date) of work completed in the period. */
  dash.draw('r-ontime', (el) => {
    if (CO.notReady(el, 'box')) return;
    el.replaceChildren();
    const pr = CO.period(), to = pr.to > CO.today() ? CO.today() : pr.to;
    const del = CO.rows().filter((r) => r.done && r.ddate && r.ddate >= pr.from && r.ddate <= to);
    const withReq = del.filter((r) => r.date_basis === 'eta' && r.req && r.req <= r.ddate), tat = withReq.map((r) => Math.max(0, CO.workdays(r.req, r.ddate) - 1)).sort((a, b) => a - b);
    const q = (p) => tat[Math.min(tat.length - 1, Math.ceil(tat.length * p) - 1)];
    const hd = document.createElement('div'); hd.className = 'na-head'; const l = document.createElement('div'); const h2 = document.createElement('h2'); h2.className = 'co-h2'; h2.textContent = 'Turnaround'; const note = document.createElement('p'); note.className = 'co-note';
    note.textContent = 'Working days from the request date to the Design ETA (the delivery date) of work completed in this period. ' + withReq.length + ' of ' + del.length + ' tasks have both dates.'; l.append(h2, note); hd.append(l); el.append(hd);
    const MIN = 10, days = (n) => n + (n === 1 ? ' day' : ' days');
    const tiles = document.createElement('div'); tiles.className = 'ot-tiles';
    const tile = (cls, val, label, sub) => { const d = document.createElement('div'); d.className = 'ot-tile ' + cls; const b = document.createElement('b'); b.textContent = val; const s1 = document.createElement('span'); s1.textContent = label; const s2 = document.createElement('small'); s2.textContent = sub; d.append(b, s1, s2); tiles.append(d); };
    if (tat.length >= MIN) {
      tile('k-pick', days(q(0.5)), 'Typical turnaround (median)', 'Half the tasks took this long or less');
      tile('k-wip', days(q(0.9)), '9 in 10 tasks within', 'The slowest tenth took longer');
      const fast = tat.filter((n) => n <= 3).length;
      tile('k-done', Math.round(fast / tat.length * 100) + '%', 'Within 3 working days', fast + ' of ' + tat.length + ' tasks');
    } else tile('k-wait', '—', 'Turnaround', 'Needs ' + MIN + ' completed tasks with both dates; ' + tat.length + ' so far');
    el.append(tiles);
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
    const cOpen = new Set(cs.flatMap((c) => (c.content ? c.content.open.map((r) => r.uid) : []))).size; pill(cOpen, cOpen === 1 ? 'content task open' : 'content tasks open', 'ct');
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
    // Content tasks block on a writer's card: its own count and breakdown, separate from design and editing.
    const CLAB = { PENDING: 'Pending', WIP: 'WIP', CHANGES: 'Changes', 'INCOMPLETE BRIEF': 'Incomplete brief', TBP: 'TBP', TBD: 'TBD' };
    const cline = (r) => {
      const d = line(r); const m = d.querySelector('.meta'); m.textContent = [r.id, r.type, 'Content: ' + (CLAB[String(r.content_status).trim().toUpperCase()] || r.content_status), r.designers ? 'Design: ' + r.designers : '', CO.cls(r)].filter(Boolean).join(' · ');
      const mm = d.querySelector('.m'); mm.textContent = r.eta ? 'ETA ' + CO.fmtDate(r.eta) : 'No ETA'; mm.classList.remove('bad', 'warn'); return d;
    };
    function contentBlock(ct, name) {
      const box = document.createElement('div'); box.className = 'su-content';
      const h = document.createElement('h3'); h.className = 'su-ct-h'; h.append('Content tasks'); const n = document.createElement('b'); n.textContent = ct.open.length + ' open'; h.append(n); box.append(h);
      const chips = document.createElement('div'); chips.className = 'su-stats';
      CT.OPEN.forEach((k) => { const l = (ct.by[k] || []).length; if (l) { const s2 = document.createElement('span'); s2.className = 'chip s-content'; s2.textContent = l + ' ' + CLAB[k]; chips.append(s2); } });
      if (ct.client.length) { const s2 = document.createElement('span'); s2.className = 'chip s-lav'; s2.textContent = ct.client.length + ' with client'; chips.append(s2); }
      if (ct.hold.length) { const s2 = document.createElement('span'); s2.className = 'chip s-mute'; s2.textContent = ct.hold.length + ' on hold'; chips.append(s2); }
      if (chips.childNodes.length) box.append(chips);
      if (ct.open.length) { const sec = document.createElement('div'); sec.className = 'su-sec'; ct.open.slice(0, 5).forEach((r) => sec.append(cline(r))); if (ct.open.length > 5) { const b = document.createElement('button'); b.type = 'button'; b.className = 'co-link'; b.textContent = '+' + (ct.open.length - 5) + ' more'; b.addEventListener('click', () => { dash.setParams({ tab: 'mine' }); }); sec.append(b); } box.append(sec); }
      else { const f = document.createElement('p'); f.className = 'su-free'; f.textContent = 'No open content tasks.'; box.append(f); }
      const t = CO.today(), wk = ct.doneIn(CO.addDays(t, -6), t).length;
      if (wk) { const d = document.createElement('p'); d.className = 'su-done'; d.textContent = wk + (wk === 1 ? ' content task' : ' content tasks') + ' completed in the last 7 days (by ETA)'; box.append(d); }
      return box;
    }
    dash.draw('standup', (el) => {
      if (CO.notReady(el, 'box')) return;
      const rs = CO.rows(), t = CO.today(), wkAgo = CO.addDays(t, -6);
      const people = new Map();
      CO.team().byKey.forEach((m) => { if (m.status === 'Active') people.set(m.name, []); });
      rs.forEach((r) => {
        const recentDone = r.done && r.ddate && r.ddate >= wkAgo && r.ddate <= t;
        if (CO.CLOSED.has(r.stage) && !recentDone) return;
        if (!r.list.length) { if (r.open) { if (!people.has('Unassigned')) people.set('Unassigned', []); people.get('Unassigned').push(r); } return; }
        // Inactive people appear only while they still hold open work, so it can be reassigned.
        r.list.forEach((d) => { if (EF.hidden(d) || (!CO.isActive(d) && !r.open)) return; if (!people.has(d)) people.set(d, []); people.get(d).push(r); });
      });
      // Content-only writers have no design card unless they hold design work; every content writer gets a card.
      [...people.keys()].forEach((k) => { if (CT.contentOnly(k) && !people.get(k).length) people.delete(k); });
      CT.writers().forEach((w) => { if (!people.has(w)) people.set(w, []); });
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
          review: list.filter((r) => r.shared), done: list.filter((r) => r.done),
          content: CT.writers().includes(name) ? CT.of(name, rs) : null };
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
        const cOnly = c.content && CT.contentOnly(c.name) && !c.open.length;
        const card = document.createElement('article'); card.className = 'su ' + (c.overdue.length ? 'late' : c.open.length || (cOnly && c.content.open.length) ? 'busy' : 'free') + (c.content ? ' has-content' : '');
        const head = document.createElement('div'); head.className = 'su-head';
        const nm = document.createElement('span'); nm.className = 'su-name'; nm.append(CO.av(c.name === 'Unassigned' ? '?' : c.name, 'lg' + (c.name === 'Unassigned' ? ' none' : '')), c.name);
        const mem = CO.member(c.name);
        if (mem.role) { const r = document.createElement('span'); r.className = 'su-role'; r.textContent = mem.role; nm.append(r); }
        if (mem.status === 'New' && c.name !== 'Unassigned') { const n = document.createElement('span'); n.className = 'tag-new'; n.textContent = 'New'; nm.append(n); }
        if (mem.status === 'Inactive') { const n = document.createElement('span'); n.className = 'tag-new'; n.textContent = 'Inactive · reassign'; nm.append(n); }
        const load = document.createElement('span'); load.className = 'su-load'; load.append(CO.num(cOnly ? c.content.open.length : CO.sumQty(c.open))); const sm = document.createElement('small'); sm.textContent = cOnly ? 'content open' : 'open'; load.append(sm);
        head.append(nm, load); card.append(head);
        const stats = document.createElement('div'); stats.className = 'su-stats';
        const st = (n, lab, cls, color) => { if (!n) return; const s = document.createElement('span'); s.className = 'chip ' + cls; if (color) s.style.color = color; s.textContent = n + ' ' + lab; stats.append(s); };
        st(c.overdue.length, 'overdue', 's-bad'); st(c.today.length, 'due today', 's-warn'); st(c.open.filter((r) => r.stage === 'WIP').length, 'WIP', '', CO.stageColor('WIP'));
        st(c.open.filter((r) => r.stage === 'To be planned').length, 'TBP', 's-mute'); st(c.review.length, 'pending approval', 's-lav');
        if (stats.childNodes.length) card.append(stats);
        const more = () => CO.goTasks('open', { designer: c.name === 'Unassigned' ? '__none' : c.name });
        [section('Overdue', c.overdue, 4, more), section('Due today', c.today, 4, more), section('WIP', c.wip, 4, more), section('Changes requested', c.changes, 3, more), section('Up next', c.next, 3, more)].forEach((s) => { if (s) card.append(s); });
        const onlyContent = c.content && CT.contentOnly(c.name) && !c.open.length && !c.review.length && !c.done.length;
        if (!c.open.length && !onlyContent) { const f = document.createElement('p'); f.className = 'su-free'; f.textContent = c.review.length ? 'No open design work, ' + c.review.length + ' with reviewers. Free to take new tasks.' : 'No open design work. Free to take new tasks.'; card.append(f); }
        if (c.done.length) { const d = document.createElement('p'); d.className = 'su-done'; const nd = CO.sumQty(c.done); d.textContent = CO.num(nd) + (nd === 1 ? ' creative' : ' creatives') + ' delivered in the last 7 days (by ETA)'; card.append(d); }
        if (c.content) card.append(contentBlock(c.content, c.name));
        el.append(card);
      });
    });
  })();

  /* ================= Day plan (Stand-up) =================
     Each person's tasks for the day, saved by the web app at 10:00 IST (open tasks due today or overdue, and work in
     progress), plus tasks that come into scope during the day. Today's statuses are live; past days show their
     end-of-day status. Before 10:00 a preview from the live data is shown. */
  const DP = { view: LS.get('co.suview', 'cards'), date: '', data: null, busy: false, at: 0, open: new Set() };
  const DPG = [['done', 'Done', 'Delivered'], ['review', 'Under review', 'Under review'], ['client', 'With client', 'Shared'], ['wip', 'WIP', 'WIP'], ['changes', 'Changes', 'Changes requested'], ['tbp', 'To be planned', 'To be planned'], ['other', 'Other', '']];
  const dpGroup = (st) => st === 'Delivered' ? 'done' : st === 'Under review' ? 'review' : st === 'Shared' || st === 'No update' ? 'client' : st === 'WIP' ? 'wip' : st === 'Changes requested' ? 'changes' : st === 'To be planned' ? 'tbp' : 'other';
  function dpSetView(v) {
    DP.view = v; LS.set('co.suview', v);
    document.querySelectorAll('[data-suview]').forEach((b) => { const on = b.dataset.suview === v; b.setAttribute('aria-selected', String(on)); b.classList.toggle('on', on); });
    document.querySelector('[data-draw="standup"]').hidden = v === 'plan';
    document.querySelector('[data-draw="su-summary"]').hidden = v === 'plan';
    document.getElementById('su-sort').hidden = v === 'plan';
    document.querySelector('[data-draw="dayplan"]').hidden = v !== 'plan';
    if (v === 'plan') { dpLoad(); dash.draw('dayplan'); }
  }
  document.querySelectorAll('[data-suview]').forEach((b) => b.addEventListener('click', () => flip(() => dpSetView(b.dataset.suview))));
  async function dpLoad(force) {
    if (A.mode !== 'auth' || !A.user || DP.busy || (!force && DP.data && DP.data.date === (DP.date || DP.data.today) && Date.now() - DP.at < 60000)) return;
    DP.busy = true;
    try { const b = await callApi({ action: 'dayplan', date: DP.date || undefined }, true); if (b.ok) { DP.data = b; DP.at = Date.now(); } else DP.err = b.error; } catch (e) { DP.err = e.message; }
    DP.busy = false; dash.draw('dayplan');
  }
  setInterval(() => { if (DP.view === 'plan' && curTab() === 'standup' && document.visibilityState === 'visible') dpLoad(true); }, 60 * 1000);
  // Live rows for today (and the preview before 10:00): the same rule the web app uses.
  const dpPreview = () => { const t = CO.today(), out = []; (CO.rows(true) || []).forEach((r) => { if (!(r.open && ((r.eta && r.eta <= t) || r.stage === 'WIP' || r.stage === 'Changes requested'))) return; r.list.forEach((p) => out.push({ person: p, uid: r.uid, id: r.id, brand: r.brand, topic: CO.topicText(r), type: r.type, qty: r.qty || 1, cls: CO.cls(r), start: r.stage, now: r.stage, added: 'Preview' })); }); return out; };
  /* Four phases a stand-up walks through (the user's own words: assigned, picked up, out for approval, delivered).
     The exact sheet status stays on each task. */
  const DPP = [['todo', 'Not started', 'Assigned, not picked up yet'], ['doing', 'In progress', 'WIP and changes'], ['review', 'In review', 'Under review or with the client'], ['done', 'Delivered', 'Done']];
  const dpPhase = (st) => { if (st === 'Rejected') return 'done'; const g = dpGroup(st); return g === 'done' ? 'done' : g === 'review' || g === 'client' ? 'review' : g === 'wip' || g === 'changes' ? 'doing' : g === 'tbp' ? 'todo' : 'other'; };
  const dpEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const dpDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  dash.draw('dayplan', (el) => {
    if (DP.view !== 'plan') return;
    el.replaceChildren();
    const d = DP.data, live = new Map((CO.rows(true) || []).map((r) => [r.uid, r]));
    const today = d ? d.today : CO.today(), day = d ? d.date : today, isToday = day === today;
    let rows = d && d.rows ? d.rows.slice() : [];
    const preview = isToday && (!d || d.waiting || !rows.length);
    if (preview) rows = dpPreview();
    if (isToday) rows = rows.map((x) => { const r = live.get(x.uid); return Object.assign({}, x, { now: !r ? 'Removed from the sheet' : r.list.includes(x.person) ? r.stage : 'Reassigned', eta: r ? r.eta : '' }); });
    const p = dash.params(); if (p.designer && p.designer !== '__none') rows = rows.filter((x) => x.person === p.designer);
    rows.forEach((x) => { x.ph = dpPhase(x.now); x.late = x.ph !== 'done' && x.ph !== 'other' && x.eta && x.eta < day ? dpDays(x.eta, day) : 0; x.picked = dpPhase(x.start) === 'todo' && x.ph !== 'todo' && x.ph !== 'other'; x.isNew = x.added === 'During the day'; });
    const active = rows.filter((x) => x.ph !== 'other');
    const cnt = (xs) => { const o = { todo: 0, doing: 0, review: 0, done: 0, other: 0 }; xs.forEach((x) => { o[x.ph]++; }); return o; };
    const tot = cnt(rows);

    // ---- Hero: the day at a glance
    const hero = dpEl('div', 'co-card dp-hero');
    const top = dpEl('div', 'dp-hero-top');
    const tl = dpEl('div', 'dp-title');
    tl.append(dpEl('h2', 'co-h2', isToday ? 'Today’s plan' : 'Plan for ' + CO.fmtDate(day, true)),
      dpEl('p', 'co-note', preview ? (d && d.waiting ? 'The plan is saved at 10:00 IST. Until then this is a live preview from the sheets.' : 'Live preview from the sheets.') : isToday ? 'Saved at 10:00 IST · statuses update live · tasks added later are marked New' : 'How the day ended: the status of every planned task at close.'));
    const sel = dpEl('select', 'co-select'); sel.setAttribute('aria-label', 'Day');
    const days = [today].concat(((d && d.days) || []).filter((x) => x !== today));
    days.forEach((x) => sel.append(new Option(x === today ? 'Today, ' + CO.fmtDate(x) : CO.fmtDate(x, true), x)));
    sel.value = day; sel.addEventListener('change', () => { DP.date = sel.value === today ? '' : sel.value; DP.data = null; dash.draw('dayplan'); dpLoad(true); });
    top.append(tl, sel); hero.append(top);
    if (!d && DP.busy) hero.append(dpEl('p', 'co-note', 'Loading the day’s plan…'));
    if (!active.length && !(DP.busy && !d)) { hero.append(dpEl('p', 'dp-empty', isToday ? 'Nothing is due, overdue or in progress for anyone today.' : 'No plan was saved for this day.')); el.append(hero); return; }
    const body = dpEl('div', 'dp-hero-body');
    const big = dpEl('div', 'dp-big'); const bn = dpEl('b', '', CO.num(tot.done)); const bs = dpEl('span', 'dp-of', '/' + CO.num(active.length));
    const bl = dpEl('span', 'dp-big-l', (isToday ? 'delivered so far' : 'delivered') + ' · ' + Math.round(tot.done / Math.max(1, active.length) * 100) + '%');
    const bnw = dpEl('div', 'dp-big-n'); bnw.append(bn, bs); big.append(bnw, bl);
    const chart = dpEl('div', 'dp-chart');
    const bar = dpEl('div', 'dp-sbar'); bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', DPP.map(([k, l]) => tot[k] + ' ' + l).join(', '));
    DPP.forEach(([k, l]) => { if (!tot[k]) return; const s2 = dpEl('i', 'ph-' + k); s2.style.flexGrow = tot[k]; s2.title = tot[k] + ' ' + l; bar.append(s2); });
    const leg = dpEl('div', 'dp-leg');
    DPP.forEach(([k, l, hint]) => { const it = dpEl('div', 'dp-leg-i ph-' + k + (tot[k] ? '' : ' zero')); const n = dpEl('b', '', CO.num(tot[k])); const t2 = dpEl('span', '', l); const h = dpEl('small', '', hint); it.append(n, t2, h); leg.append(it); });
    chart.append(bar, leg); body.append(big, chart); hero.append(body);
    // what to talk about at stand-up
    const flags = [];
    const late = active.filter((x) => x.late).length, chg = rows.filter((x) => x.now === 'Changes requested').length, picked = rows.filter((x) => x.picked).length, added = rows.filter((x) => x.isNew).length;
    const byP = new Map(); rows.forEach((x) => { if (!byP.has(x.person)) byP.set(x.person, []); byP.get(x.person).push(x); });
    const idle = [...byP].filter(([, xs]) => xs.some((x) => x.ph === 'todo') && !xs.some((x) => x.ph === 'doing' || x.ph === 'review' || x.ph === 'done')).map(([n]) => n.split(' ')[0]);
    if (late) flags.push(['bad', late + (late === 1 ? ' task is' : ' tasks are') + ' past the ETA']);
    if (chg) flags.push(['warn', chg + ' waiting on changes']);
    if (idle.length) flags.push(['mute', idle.length === 1 ? idle[0] + ' hasn’t picked anything up yet' : idle.length + ' people haven’t picked anything up: ' + idle.slice(0, 4).join(', ') + (idle.length > 4 ? '…' : '')]);
    if (picked && !preview) flags.push(['ok', picked + ' picked up since the morning']);
    if (added) flags.push(['info', added + ' added during the day']);
    if (tot.other) flags.push(['mute', tot.other + ' moved off the plan (reassigned, on hold or removed)']);
    if (flags.length) { const fl = dpEl('div', 'dp-flags'); flags.forEach(([c, t]) => fl.append(dpEl('span', 'dp-flag f-' + c, t))); hero.append(fl); }
    el.append(hero);

    // ---- Board: one row per person, one column per phase
    const board = dpEl('div', 'co-card dp-board'); board.setAttribute('role', 'table'); board.setAttribute('aria-label', 'Tasks by person and phase');
    const hr = dpEl('div', 'dp-row dp-hrow'); hr.setAttribute('role', 'row');
    const h0 = dpEl('div', 'dp-hc dp-pc', 'Person'); h0.setAttribute('role', 'columnheader'); hr.append(h0);
    DPP.forEach(([k, l]) => { const h = dpEl('div', 'dp-hc ph-' + k); h.setAttribute('role', 'columnheader'); h.append(dpEl('i', 'dp-dot'), dpEl('span', '', l), dpEl('b', '', CO.num(tot[k]))); hr.append(h); });
    board.append(hr);
    const MAX = 3;
    const people = [...byP].sort((a, b) => { const ca = cnt(a[1]), cb = cnt(b[1]); return (cb.todo + cb.doing + cb.review) - (ca.todo + ca.doing + ca.review) || b[1].length - a[1].length || a[0].localeCompare(b[0]); });
    people.forEach(([name, xs]) => {
      const c = cnt(xs), act = xs.filter((x) => x.ph !== 'other'), open = DP.open.has(name);
      const row = dpEl('div', 'dp-row'); row.setAttribute('role', 'row');
      const pc = dpEl('div', 'dp-pc'); pc.setAttribute('role', 'rowheader');
      const who = dpEl('div', 'dp-who'); const tm = CO.team().resolve(name);
      const nm = dpEl('div', 'dp-nm'); nm.append(dpEl('b', '', name), dpEl('span', '', (tm && tm.role) || 'Team'));
      who.append(CO.av(name), nm);
      const prog = dpEl('div', 'dp-prog'); const pb = dpEl('div', 'dp-pbar'); pb.setAttribute('role', 'img'); pb.setAttribute('aria-label', DPP.filter(([k]) => c[k]).map(([k, l]) => c[k] + ' ' + l).join(', '));
      DPP.forEach(([k]) => { if (!c[k]) return; const s2 = dpEl('i', 'ph-' + k); s2.style.flexGrow = c[k]; pb.append(s2); });
      prog.append(pb, dpEl('span', 'dp-pl', c.done + ' of ' + act.length + ' delivered' + (c.other ? ' · ' + c.other + ' off the plan' : '')));
      pc.append(who, prog); row.append(pc);
      let hidden = 0;
      DPP.forEach(([k, l]) => {
        const cell = dpEl('div', 'dp-cell ph-' + k); cell.setAttribute('role', 'cell'); cell.dataset.label = l;
        const list = xs.filter((x) => x.ph === k).sort((a, b) => (b.late - a.late) || String(a.brand).localeCompare(String(b.brand)));
        if (!list.length) cell.classList.add('none');
        const head = dpEl('div', 'dp-cl'); head.append(dpEl('i', 'dp-dot'), dpEl('span', '', l + ' · ' + list.length)); cell.append(head);
        const cap = list.length <= MAX + 1 ? list.length : MAX; // never hide just one
        (open ? list : list.slice(0, cap)).forEach((x) => cell.append(dpTask(x, live)));
        if (!open && list.length > cap) hidden += list.length - cap;
        row.append(cell);
      });
      if (hidden || open) {
        const more = dpEl('button', 'dp-more', open ? 'Show less' : 'Show ' + hidden + ' more'); more.type = 'button'; more.setAttribute('aria-expanded', String(open));
        more.addEventListener('click', () => flip(() => { if (open) DP.open.delete(name); else DP.open.add(name); dash.draw('dayplan'); }));
        pc.append(more);
      }
      board.append(row);
    });
    el.append(board);
  });
  function dpTask(x, live) {
    const r = live.get(x.uid), t = dpEl('div', 'dp-tk ph-' + x.ph + (x.now === 'Changes requested' ? ' chg' : ''));
    if (r) { t.dataset.uid = x.uid; t.tabIndex = 0; t.setAttribute('role', 'button'); t.title = 'Open ' + (x.id || 'task'); }
    const l1 = dpEl('div', 'dp-tk1'); l1.append(dpEl('b', '', x.brand || 'No brand'), dpEl('span', '', [x.type, x.qty > 1 ? '×' + x.qty : ''].filter(Boolean).join(' ')));
    const l2 = dpEl('div', 'dp-tk2', x.topic || x.id || '');
    t.append(l1, l2);
    const tags = [];
    const fine = { 'Changes requested': 'Changes', 'Shared': 'With client', 'No update': 'Client: no update', 'Under review': 'Under review', 'WIP': '', 'Delivered': '', 'To be planned': '' };
    const f = fine[x.now] !== undefined ? fine[x.now] : x.now; if (f && x.ph !== 'other') tags.push(['st', f]);
    if (x.late) tags.push(['late', x.late + 'd late']);
    if (x.picked && x.ph !== 'done') tags.push(['up', 'Picked up today']);
    if (x.ph === 'done' && x.start !== x.now) tags.push(['ok', 'Delivered today']);
    if (x.isNew) tags.push(['new', 'New']);
    if (x.cls === 'External') tags.push(['ext', 'External']);
    if (tags.length) { const tg = dpEl('div', 'dp-tags'); tags.forEach(([c, s2]) => tg.append(dpEl('span', 't-' + c, s2))); t.append(tg); }
    return t;
  }
  setTimeout(() => dpSetView(DP.view), 0);

  /* ================= Brand packages (Brands page) =================
     A brand buys a package (e.g. 5 AI UGC, 2 AI Catalogue, 3 Static). Delivered = completed (DONE) creatives of that
     brand and creative type from the purchase date, from the sheet(s) the package counts; they fill the oldest open
     package first, then the next. Remaining = purchased - delivered. Requests still open for the brand are shown
     against what is left, so nothing beyond the package is picked up. Owner only, unless the owner grants view/edit. */
  const PK = { list: null, busy: false, err: '', edit: null };
  const pkPerm = () => (A.mode !== 'auth' || !A.user ? '' : A.user.owner ? 'edit' : (A.user.perms && A.user.perms.packages) || '');
  const pkNorm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  async function pkLoad() {
    if (!pkPerm() || PK.busy) return; PK.busy = true;
    try { const b = await callApi({ action: 'packages' }, true); if (b.ok) { PK.list = b.packages; PK.err = ''; } else PK.err = b.error === 'forbidden' ? '' : (b.error || 'Packages could not load'); } catch (e) { PK.err = e.message; }
    PK.busy = false; dash.draw('packages');
  }
  // Allocation of delivered creatives to packages, oldest package first.
  function pkAlloc(pkgs) {
    const rows = CO.rows(true) || [], out = new Map();
    const ps = pkgs.map((p) => ({ p, items: p.items.map((it) => ({ type: it.type, key: pkNorm(it.type), qty: it.qty, used: 0, over: 0 })) })).sort((a, b) => a.p.date.localeCompare(b.p.date));
    ps.forEach((x) => out.set(x.p.id, x));
    const done = rows.filter((r) => r.stage === 'Delivered' && r.ddate).sort((a, b) => a.ddate.localeCompare(b.ddate));
    done.forEach((r) => {
      const bk = pkNorm(r.brand), tk = pkNorm(r.type), cls = r.source === 'Paid' ? 'External' : 'Internal';
      const cands = ps.filter((x) => x.p.status !== 'Closed' && pkNorm(x.p.brand) === bk && x.p.date <= r.ddate && (x.p.from === 'Both' || x.p.from === cls));
      let units = r.qty || 1; let lastItem = null;
      for (const x of cands) { const it = x.items.find((i) => i.key === tk) || x.items.find((i) => i.key === 'any type'); if (!it) continue; lastItem = it; const take = Math.min(units, it.qty - it.used); if (take > 0) { it.used += take; units -= take; } if (!units) break; }
      if (units && lastItem) lastItem.over += units; // delivered beyond what was bought
    });
    // requests still open for each brand and type (from the package date), against what is left
    ps.forEach((x) => { x.items.forEach((it) => { it.open = rows.filter((r) => r.open && pkNorm(r.brand) === pkNorm(x.p.brand) && (pkNorm(r.type) === it.key || it.key === 'any type') && (r.req || '') >= x.p.date && (x.p.from === 'Both' || x.p.from === (r.source === 'Paid' ? 'External' : 'Internal'))).reduce((a, r) => a + (r.qty || 1), 0); }); });
    return out;
  }
  const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  dash.draw('packages', (el) => {
    const perm = pkPerm(); el.hidden = !perm; if (!perm) { el.replaceChildren(); return; }
    if (PK.list === null && !PK.busy) pkLoad();
    el.replaceChildren();
    const head = document.createElement('div'); head.className = 'co-card-head';
    const l = document.createElement('div'); const h2 = document.createElement('h2'); h2.className = 'co-h2'; h2.textContent = 'Brand packages';
    const nt = document.createElement('p'); nt.className = 'co-note'; nt.textContent = 'Creatives each brand has bought, delivered and still due. Updates automatically from the sheets.'; l.append(h2, nt); head.append(l);
    if (perm === 'edit') { const add = document.createElement('button'); add.type = 'button'; add.className = 'co-btn primary'; add.textContent = 'Add package'; add.addEventListener('click', () => pkOpen(null)); head.append(add); }
    el.append(head); collapser(el, 'packages', 'Brand packages');
    if (PK.err) { const e = document.createElement('p'); e.className = 'co-note bad'; e.textContent = PK.err; el.append(e); return; }
    if (PK.list === null) { const e = document.createElement('p'); e.className = 'co-note'; e.textContent = 'Loading packages…'; el.append(e); return; }
    if (CO.status() !== 'ok') return;
    const list = PK.list.slice(), al = pkAlloc(list);
    const sum = (f) => list.reduce((a, p) => a + f(p, al.get(p.id)), 0);
    const bought = sum((p) => p.total), deliv = sum((p, x) => x.items.reduce((a, it) => a + it.used, 0)), active = list.filter((p) => p.status !== 'Closed' && al.get(p.id).items.some((it) => it.used < it.qty)).length;
    const tiles = document.createElement('div'); tiles.className = 'pk-tiles';
    [['Packages', CO.num(list.length), active + ' still running'], ['Creatives bought', CO.num(bought), ''], ['Delivered', CO.num(deliv), bought ? Math.round(deliv / bought * 100) + '%' : ''], ['Remaining', CO.num(Math.max(0, bought - deliv)), ''], ['Value', inr(sum((p) => p.amount)), 'incl. tax']].forEach(([lab, v, s2]) => {
      const t = document.createElement('div'); t.className = 'pk-tile'; const b = document.createElement('b'); b.textContent = v; const sp = document.createElement('span'); sp.textContent = lab; t.append(b, sp); if (s2) { const sm = document.createElement('small'); sm.textContent = s2; t.append(sm); } tiles.append(t);
    });
    el.append(tiles);
    if (!list.length) { const e = document.createElement('p'); e.className = 'qn-empty'; e.textContent = perm === 'edit' ? 'No packages yet. Add one with Add package; deliveries are counted automatically.' : 'No packages yet.'; el.append(e); return; }
    const wrap = document.createElement('div'); wrap.className = 'pk-list';
    list.sort((a, b) => (a.status === 'Closed') - (b.status === 'Closed') || b.date.localeCompare(a.date)).forEach((p) => {
      const x = al.get(p.id), used = x.items.reduce((a, it) => a + it.used, 0), over = x.items.reduce((a, it) => a + it.over, 0), left = Math.max(0, p.total - used), openReq = x.items.reduce((a, it) => a + it.open, 0);
      const st = p.status === 'Closed' ? 'closed' : left === 0 ? 'complete' : 'running';
      const card = document.createElement('article'); card.className = 'pk-item s-' + st + (perm === 'edit' ? ' can' : '');
      const top = document.createElement('div'); top.className = 'pk-top';
      const nm = document.createElement('div'); nm.className = 'pk-name'; const b = document.createElement('b'); b.textContent = p.brand; const meta = document.createElement('span'); meta.textContent = 'Bought ' + CO.fmtDate(p.date, true) + ' · ' + (p.from === 'Both' ? 'Internal + External' : p.from) + (p.amount ? ' · ' + inr(p.amount) : ''); nm.append(b, meta);
      const chip = document.createElement('span'); chip.className = 'pk-chip s-' + st; chip.textContent = st === 'closed' ? 'Closed' : st === 'complete' ? (over ? 'Complete · ' + over + ' over' : 'Complete') : left + ' left';
      top.append(nm, chip); card.append(top);
      const bar = document.createElement('div'); bar.className = 'pk-bar'; const f = document.createElement('i'); f.style.width = Math.min(100, p.total ? used / p.total * 100 : 0) + '%'; bar.append(f);
      const bl = document.createElement('div'); bl.className = 'pk-bl'; bl.textContent = used + ' of ' + p.total + ' delivered'; card.append(bar, bl);
      const ul = document.createElement('div'); ul.className = 'pk-types';
      x.items.forEach((it) => { const r = document.createElement('div'); r.className = 'pk-type'; const t1 = document.createElement('span'); t1.textContent = it.type; const t2 = document.createElement('span'); t2.className = 'pk-tn'; t2.textContent = it.used + ' / ' + it.qty + (it.over ? ' (+' + it.over + ' over)' : ''); const t3 = document.createElement('span'); t3.className = 'pk-tl'; const lf = Math.max(0, it.qty - it.used); t3.textContent = lf ? lf + ' left' : 'done'; if (!lf) t3.classList.add('ok'); r.append(t1, t2, t3); ul.append(r); });
      card.append(ul);
      if (st !== 'closed' && openReq && openReq > left) { const w = document.createElement('p'); w.className = 'pk-warn'; w.textContent = left ? openReq + ' requests are open for ' + p.brand + ' but only ' + left + ' creatives are left in this package.' : 'Package complete: ' + openReq + ' more request' + (openReq === 1 ? ' is' : 's are') + ' open for ' + p.brand + '. Don’t pick up new requests unless a new package is bought.'; card.append(w); }
      else if (st === 'complete') { const w = document.createElement('p'); w.className = 'pk-ok'; w.textContent = 'All purchased creatives delivered.'; card.append(w); }
      if (p.notes) { const n2 = document.createElement('p'); n2.className = 'co-note'; n2.textContent = p.notes; card.append(n2); }
      if (perm === 'edit') { card.tabIndex = 0; card.addEventListener('click', () => pkOpen(p)); card.addEventListener('keydown', (e) => { if (e.key === 'Enter') pkOpen(p); }); }
      wrap.append(card);
    });
    el.append(wrap);
  });
  // ---- add / edit ----
  const $p = (id) => document.getElementById(id), pkDlg = $p('pk-dlg');
  const pkBrands = () => { const s = new Set((CO.rows(true) || []).map((r) => r.brand).filter((b) => b && b !== 'No brand')); (PK.list || []).forEach((p) => s.add(p.brand)); return [...s].sort((a, b) => a.localeCompare(b)); };
  const pkTypes = () => { const s = new Set((CO.rows(true) || []).map((r) => r.type).filter(Boolean)); (PK.list || []).forEach((p) => p.items.forEach((it) => s.add(it.type))); return ['Any type'].concat([...s].filter((t) => t !== 'Any type').sort((a, b) => a.localeCompare(b))); };
  function pkItemRow(it) {
    const row = document.createElement('div'); row.className = 'pk-irow';
    const sel = document.createElement('select'); sel.className = 'co-select'; sel.setAttribute('aria-label', 'Creative type'); pkTypes().forEach((t) => sel.append(new Option(t, t))); sel.append(new Option('+ Other type…', '__new'));
    const other = document.createElement('input'); other.className = 'co-input'; other.placeholder = 'Type name'; other.maxLength = 60; other.hidden = true;
    const q = document.createElement('input'); q.className = 'co-input pk-q'; q.type = 'number'; q.min = '1'; q.step = '1'; q.setAttribute('aria-label', 'Quantity'); q.value = it ? it.qty : 1;
    const x = document.createElement('button'); x.type = 'button'; x.className = 'icon-btn'; x.setAttribute('aria-label', 'Remove'); x.textContent = '×';
    if (it) { if ([...sel.options].some((o) => o.value === it.type)) sel.value = it.type; else { sel.value = '__new'; other.hidden = false; other.value = it.type; } } else sel.value = (pkTypes()[1] || 'Any type');
    sel.addEventListener('change', () => { other.hidden = sel.value !== '__new'; if (!other.hidden) other.focus(); pkSum(); });
    q.addEventListener('input', pkSum); x.addEventListener('click', () => { row.remove(); pkSum(); });
    row.read = () => ({ type: sel.value === '__new' ? other.value.trim() : sel.value, qty: Math.round(Number(q.value) || 0) });
    row.append(sel, other, q, x); return row;
  }
  const pkRows = () => [...$p('pk-items').children].map((r) => r.read());
  function pkSum() { const n = pkRows().reduce((a, it) => a + (it.qty > 0 ? it.qty : 0), 0); $p('pk-total').textContent = n + (n === 1 ? ' creative' : ' creatives') + ' in total'; }
  function pkOpen(p) {
    PK.edit = p; $p('pk-title').textContent = p ? 'Edit package' : 'Add a package'; $p('pk-err').textContent = '';
    const bs = $p('pk-brand'); bs.replaceChildren(new Option('Choose a brand…', '')); pkBrands().forEach((b) => bs.append(new Option(b, b))); bs.append(new Option('+ Add a new brand…', '__new'));
    bs.value = p ? p.brand : ''; $p('pk-newbrand-l').hidden = true; $p('pk-newbrand').value = '';
    $p('pk-date').value = p ? p.date : CO.today(); $p('pk-amount').value = p && p.amount ? p.amount : ''; $p('pk-from').value = p ? p.from : 'External'; $p('pk-notes').value = p ? p.notes : ''; $p('pk-closed').checked = !!(p && p.status === 'Closed');
    $p('pk-items').replaceChildren(...(p ? p.items : [null]).map(pkItemRow)); pkSum(); $p('pk-del').hidden = !p;
    if (pkDlg.showModal) pkDlg.showModal(); else pkDlg.setAttribute('open', '');
  }
  $p('pk-brand').addEventListener('change', (e) => { const n = e.target.value === '__new'; $p('pk-newbrand-l').hidden = !n; if (n) $p('pk-newbrand').focus(); });
  $p('pk-add-item').addEventListener('click', () => { $p('pk-items').append(pkItemRow(null)); pkSum(); });
  $p('pk-cancel').addEventListener('click', () => pkDlg.close());
  $p('pk-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const brand = $p('pk-brand').value === '__new' ? $p('pk-newbrand').value.trim() : $p('pk-brand').value;
    const items = pkRows().filter((it) => it.type && it.qty > 0);
    const pkg = { brand, date: $p('pk-date').value, amount: Number($p('pk-amount').value) || 0, from: $p('pk-from').value, items, notes: $p('pk-notes').value.trim(), status: $p('pk-closed').checked ? 'Closed' : 'Active' };
    const err = !brand ? 'Choose or type a brand.' : !pkg.date ? 'Add the purchase date.' : !items.length ? 'Add at least one creative type with a quantity.' : '';
    if (err) { $p('pk-err').textContent = err; return; }
    $p('pk-save').disabled = true;
    try { const r = await callApi(Object.assign({ action: 'packageSave', pkg }, PK.edit ? { id: PK.edit.id } : {})); if (!r.ok) throw new Error(r.error || 'Not saved'); pkDlg.close(); toast(PK.edit ? 'Package saved' : 'Package added for ' + brand); PK.list = null; pkLoad(); }
    catch (er) { $p('pk-err').textContent = er.message; }
    $p('pk-save').disabled = false;
  });
  $p('pk-del').addEventListener('click', async () => {
    if (!PK.edit || !confirm('Delete the ' + PK.edit.brand + ' package? Deliveries stay in the sheets; only the package is removed.')) return;
    try { const r = await callApi({ action: 'packageDelete', id: PK.edit.id }); if (!r.ok) throw new Error(r.error || 'Not deleted'); pkDlg.close(); toast('Package deleted'); PK.list = null; pkLoad(); } catch (er) { $p('pk-err').textContent = er.message; }
  });

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
    const CHIPS = [['active', 'Not completed'], ['open', 'Open'], ['overdue', 'Overdue'], ['week', 'Due this week'], ['noeta', 'No ETA'], ['underreview', 'Under review'], ['review', 'Shared'], ['awaiting', 'Awaiting brief'], ['delivered-month', 'Completed this month'], ['all', 'All']];
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
    const hidden = (name) => /not shown/i.test(role(name)) && !/creative head/i.test(role(name)) && !/^anmol\b/i.test(name); // the Creative Head's own work is shown (Nov 2026)
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
      const content = rs.filter((r) => r.awaiting && ['Brief in progress', 'Brief ready for scripting', 'Brief changes requested'].includes(r.sub) && r.owner && r.owner.toLowerCase().split(/[ ,]/)[0] === first);
      hours += content.reduce((a, r) => a + 1 * (r.qty || 1) * (intern(name) ? 1.3 : 1), 0);
      return { hours, days: hours / CAP, tasks: mine.length + content.length, content: content.length };
    };
    return { HOURS, CAP, role, hidden, intern, writer, typeHours, hoursFor, load };
  })();

  /* ================= Content tasks (briefs, scripts, content) =================
     Counted separately from design and editing, never mixed with creatives. A content task belongs to everyone named in
     its Content Owner cell ("Anmol, Jahanvi" counts for both). Content Status decides where it is:
       open (the writer's bucket): PENDING, WIP, CHANGES, INCOMPLETE BRIEF, TBP, TBD
       with the client: SHARED      completed: DONE (dated by Design ETA, else request date, never later than today)
       on hold: HOLD                 blank: not a content task
     Content writers: Jahanvi and Gul (content only), anyone with the "Content Writer" role, and the Creative Head
     (Anmol), who also does design work. Dropped tasks (Deprioritised) are not open content work. */
  const CT = (() => {
    const OPEN = ['PENDING', 'WIP', 'CHANGES', 'INCOMPLETE BRIEF', 'TBP', 'TBD'];
    const ONLY = ['jahanvi', 'gul'], ALSO = ['anmol'];
    const first = (n) => String(n || '').toLowerCase().trim().split(/\s+/)[0];
    const isHead = (name) => /creative head/i.test(EF.role(name)) || ALSO.includes(first(name));
    const contentOnly = (name) => !isHead(name) && (ONLY.includes(first(name)) || EF.writer(name));
    const writers = () => {
      const out = [], seen = new Set();
      (S.team || []).filter((m) => m.status !== 'Inactive').forEach((m) => { if (contentOnly(m.name) || isHead(m.name)) { out.push(m.name); seen.add(first(m.name)); } });
      ONLY.concat(ALSO).forEach((f) => { if (!seen.has(f)) out.push(f.charAt(0).toUpperCase() + f.slice(1)); }); // e.g. Gul, who is not on the team list
      return out;
    };
    // Every name in the Content Owner cell counts: "Client, Gul", "Gul, Client", "Client,Gul", "Client / Gul", "Client & Gul", one per line…
    const owners = (r) => String(r.owner || '').toLowerCase().split(/\s*(?:,|;|&|\/|\+|\n|\r|\|| and )\s*/).map((x) => x.trim()).filter(Boolean);
    // A writer is counted when their full name, or their first name as a whole word, appears in any entry ("Client Gul" from a cell with a line break; never "Gulshan").
    const owns = (r, name) => { const f = first(name), full = String(name).toLowerCase().trim(); return owners(r).some((o) => o === full || o.split(/\s+/).includes(f)); };
    const state = (r) => {
      const cs = String(r.content_status || '').trim().toUpperCase().replace(/\s+/g, ' ');
      if (!cs) return '';
      if (cs === 'DONE') return 'done';
      if (r.group === 'dropped') return '';
      if (cs === 'SHARED') return 'client';
      if (cs === 'HOLD') return 'hold';
      return OPEN.includes(cs) ? 'open' : '';
    };
    const cdate = (r) => { const d = r.eta || r.req || ''; const t = CO.today(); return d && d > t ? t : d; };
    const of = (name, rows) => {
      const rs = (rows || CO.rows() || []).filter((r) => owns(r, name)), o = { open: [], client: [], hold: [], done: [], by: {} };
      rs.forEach((r) => { const st = state(r); if (!st) return; o[st].push(r); if (st === 'open') { const k = String(r.content_status).trim().toUpperCase().replace(/\s+/g, ' '); (o.by[k] = o.by[k] || []).push(r); } });
      const byEta = (a, b) => (a.eta || '9999').localeCompare(b.eta || '9999');
      o.open.sort(byEta); o.client.sort(byEta);
      o.doneIn = (from, to) => o.done.filter((r) => { const d = cdate(r); return d && d >= from && d <= to; });
      return o;
    };
    return { OPEN, writers, contentOnly, isHead, owns, state, cdate, of };
  })();
  window.CO_ct = (name, brand) => { const o = CT.of(name, brand ? CO.rows().filter((r) => r.brand === brand) : undefined); return { open: o.open.length, by: Object.fromEntries(Object.entries(o.by).map(([k, v]) => [k, v.length])), client: o.client.length, hold: o.hold.length, done: o.done.length }; }; // read-only (tests)
  window.CO_writers = () => CT.writers();

  /* ================= Team ================= */
  (() => {
    const shown = (n) => !EF.hidden(n) && ((dash.params().who || 'active') === 'all' || CO.isActive(n)) && !(CT.contentOnly(n) && !(CO.rows() || []).some((r) => r.open && r.list.includes(n))); // content-only writers are in Content tasks (unless they hold open design work)
    const statusCell = (name) => {
      const m = CO.member(name);
      const wrap = document.createElement('span'); wrap.className = 'co-status';
      const tag = document.createElement('span');
      tag.className = m.status === 'New' ? 'tag-new' : m.status === 'Inactive' ? 'tag-off' : 'chip s-ok';
      tag.textContent = m.status === 'New' ? 'New · not on list' : m.status;
      if (!perm('team')) { wrap.append(tag); return wrap; }
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'co-link';
      btn.textContent = m.status === 'New' ? 'Add to team' : m.status === 'Active' ? 'Set inactive' : 'Set active';
      btn.addEventListener('click', (e) => { e.stopPropagation(); setMember(name, m.status === 'Active' ? 'Inactive' : 'Active'); });
      wrap.append(tag, btn); return wrap;
    };
    dash.draw('team-content', (tb) => {
      if (CO.notReady(tb, 'table')) return;
      tb.replaceChildren();
      const m = CO.thisMonth(), pm = CO.prevMonth(m), mEnd = CO.today(), rs = CO.rows();
      const monthRange = (mm) => [mm + '-01', CO.addDays((mm.slice(5) === '12' ? (+mm.slice(0, 4) + 1) + '-01' : mm.slice(0, 5) + String(+mm.slice(5) + 1).padStart(2, '0')) + '-01', -1)];
      const [pf, pt] = monthRange(pm);
      const total = { open: new Set(), done: new Set() };
      CT.writers().forEach((w) => {
        const ct = CT.of(w, rs), tr = tb.insertRow(); tr.className = 'click';
        const nm = tr.insertCell(); const b = document.createElement('span'); b.className = 'co-name'; b.append(CO.av(w), document.createTextNode(w)); nm.append(b);
        if (CT.isHead(w)) { const r2 = document.createElement('span'); r2.className = 'su-role'; r2.textContent = 'also design'; nm.append(' ', r2); }
        const num = (v, cls) => { const c = CO.td(tr, CO.num(v), 'n' + (cls ? ' ' + cls : '')); return c; };
        num(ct.open.length, ct.open.length ? 'ct-open' : '');
        ['PENDING', 'WIP', 'CHANGES', 'INCOMPLETE BRIEF'].forEach((k) => num((ct.by[k] || []).length));
        num((ct.by.TBP || []).length + (ct.by.TBD || []).length);
        num(ct.client.length); num(ct.hold.length);
        const dm = ct.doneIn(m + '-01', mEnd); num(dm.length); num(ct.doneIn(pf, pt).length);
        ct.open.forEach((r) => total.open.add(r.uid)); dm.forEach((r) => total.done.add(r.uid));
        tr.addEventListener('click', () => { MW.who = w === myDesigner() ? '' : w; LS.set('co.mwho2', MW.who); dash.setParams({ tab: 'mine' }); });
      });
      const tr = tb.insertRow(); tr.className = 'co-total';
      CO.td(tr, 'All content tasks (each counted once)'); CO.td(tr, CO.num(total.open.size), 'n');
      for (let i = 0; i < 7; i++) CO.td(tr, '', 'n');
      CO.td(tr, CO.num(total.done.size), 'n'); CO.td(tr, '', 'n');
    });
    dash.draw('team', (tb) => {
      if (CO.notReady(tb, 'table')) return;
      tb.replaceChildren();
      const rs = CO.rows(), m = CO.thisMonth(), pm = CO.prevMonth(m);
      const top = CO.topTypes(rs.filter((r) => r.done), 5), cmap = CO.typeColors(top);
      const by = new Map();
      CO.team().byKey.forEach((mm) => by.set(mm.name, []));
      rs.forEach((r) => r.list.forEach((d) => { if (!by.has(d)) by.set(d, []); by.get(d).push(r); }));
      const p = dash.params();
      const data = [...by].filter(([name]) => shown(name) && (!p.designer || p.designer === name)).map(([name, list]) => {
        const del = list.filter((r) => r.done);
        const ms = new Set(del.map((r) => r.month).filter(Boolean));
        const open = list.filter((r) => r.open);
        return {
          name, open: open.length, wip: open.filter((r) => r.stage === 'WIP').length, overdue: list.filter((r) => r.due === 'overdue').length,
          week: list.filter((r) => r.due === 'today' || r.due === 'week').length, review: list.filter((r) => r.shared).length,
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
        CO.td(tr, String(EF.role(d.name) || '').replace(/\s*\(not shown\)\s*/i, '').trim() || '—', 'co-nowrap co-muted co-hide-xl');
        { const L = EF.load(d.name); const b2 = document.createElement('span'); b2.className = 'ef-load ' + (L.days > 5 ? 'hi' : L.days > 2.5 ? 'mid' : 'lo'); b2.textContent = L.hours ? (L.days < 1 ? Math.round(L.hours) + ' h' : L.days.toFixed(1) + ' d') : 'free'; const c = CO.td(tr, b2, 'n adm-only co-nowrap'); c.title = L.tasks + ' open tasks ≈ ' + Math.round(L.hours) + ' hours of work = ' + L.days.toFixed(1) + ' working days at ' + EF.CAP + ' h a day' + (L.content ? ' (incl. ' + L.content + ' content in progress)' : '') + '. Estimate by creative type and role.'; }
        const ob = document.createElement('span'); ob.className = 'co-inbar'; const bi = document.createElement('i'); bi.style.width = (d.open / maxOpen * 3) + 'rem'; ob.append(bi, String(d.open)); CO.td(tr, ob, 'n');
        CO.td(tr, String(d.wip), 'n co-hide-lg');
        CO.td(tr, String(d.overdue), 'n' + (d.overdue ? ' bad' : ''));
        CO.td(tr, String(d.week), 'n co-hide-lg'); CO.td(tr, String(d.review), 'n'); const tm = document.createElement('span'); tm.className = 'n-with-dl'; const tmb = document.createElement('b'); tmb.textContent = CO.num(d.thisM); tm.append(tmb, CO.delta(d.thisM, d.lastSame, 'up')); tm.lastChild.title += ' (vs the same number of working days last month)'; CO.td(tr, tm, 'n'); CO.td(tr, CO.num(d.lastM), 'n'); const pd = CO.td(tr, d.perDay ? d.perDay.toFixed(1) : '0', 'n'); pd.title = CO.num(d.thisM) + ' creatives ÷ ' + CO.workdays(m + '-01', CO.today()) + ' working days so far this month (Mon–Fri)';
        CO.td(tr, d.brands, 'co-hide-lg co-clip').title = d.brands;
        const mix = document.createElement('span'); mix.className = 'co-mix';
        const total = CO.sumQty(d.del);
        top.forEach((t) => { const c = CO.sumQty(d.del.filter((r) => CO.typeOf(r, top) === t)); if (!c) return; const i = document.createElement('i'); i.style.flex = c + ' 1 0'; i.style.background = cmap.get(t); i.title = t + ': ' + c; mix.append(i); });
        mix.title = top.map((t) => t + ': ' + CO.sumQty(d.del.filter((r) => CO.typeOf(r, top) === t))).filter((x) => !/: 0$/.test(x)).join(' · ');
        CO.td(tr, mix, 'co-hide-xl');
      });
      // Reconciliation: tasks with no designer are counted only here, and the last row counts every task once
      // (a task shared by two people appears in both of their rows above, but once in the total).
      if (!p.designer) {
        const sameEnd = CO.sameWorkdaysEnd(m + '-01', CO.today(), pm + '-01', CO.monthEnd(pm));
        const foot = (label, list, cls, title) => {
          const del = list.filter((r) => r.done), open = list.filter((r) => r.open);
          const tr = tb.insertRow(); tr.className = 'team-foot ' + cls; tr.title = title;
          const nb = document.createElement('b'); nb.textContent = label; CO.td(tr, nb, 'team-foot-l'); CO.td(tr, '', ''); CO.td(tr, '', 'co-hide-xl'); CO.td(tr, '', 'n adm-only');
          CO.td(tr, String(open.length), 'n'); CO.td(tr, String(open.filter((r) => r.stage === 'WIP').length), 'n co-hide-lg');
          CO.td(tr, String(list.filter((r) => r.due === 'overdue').length), 'n'); CO.td(tr, String(list.filter((r) => r.due === 'today' || r.due === 'week').length), 'n co-hide-lg');
          CO.td(tr, String(list.filter((r) => r.shared).length), 'n');
          const tm = document.createElement('span'); tm.className = 'n-with-dl'; const tmb = document.createElement('b'); tmb.textContent = CO.num(CO.sumQty(del.filter((r) => r.month === m))); tm.append(tmb, CO.delta(CO.sumQty(del.filter((r) => r.month === m)), CO.sumQty(del.filter((r) => r.ddate && r.ddate >= pm + '-01' && r.ddate <= sameEnd)), 'up')); CO.td(tr, tm, 'n');
          CO.td(tr, CO.num(CO.sumQty(del.filter((r) => r.month === pm))), 'n'); CO.td(tr, '', 'n'); CO.td(tr, '', 'co-hide-lg'); CO.td(tr, '', 'co-hide-xl');
        };
        foot('Unassigned (not allotted)', rs.filter((r) => !r.list.length), 'unassigned', 'Tasks with no designer/editor in the sheet. They are never counted for a person.');
        const others = rs.filter((r) => r.list.length && !r.list.some((n) => shown(n)));
        if (others.length) foot('Not shown here', others, 'others', 'Tasks assigned only to people not listed above (inactive people when hidden, the Creative Head, or names not on the team list).');
        foot('All tasks (each counted once)', rs, 'total', 'Every task once, whoever it is assigned to. Rows above can add up to more because a task shared by two people is counted for both.');
      }
    });
    dash.draw('team-wd', (el) => {
      const m = CO.thisMonth(), t = CO.today(), pm = CO.prevMonth(m), so = CO.workdays(m + '-01', t), all = CO.workdays(m + '-01', CO.monthEnd(m));
      el.textContent = 'Working days are Monday to Friday. ' + CO.fmtMonth(m, true) + ' has ' + all + ' working days; ' + so + ' so far. "This month" is compared with the first ' + so + ' working days of ' + CO.fmtMonth(pm, true).split(' ')[0] + ', and "Per work day" is this month\'s creatives ÷ ' + so + '.';
    });
    dash.draw('team-legend', (el) => {
      if (CO.notReady(el, 'list')) return;
      const top = CO.topTypes(CO.rows().filter((r) => r.done), 5), cmap = CO.typeColors(top);
      el.replaceChildren(...top.map((t) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = cmap.get(t); s.append(i, t); return s; }));
    });
    dash.draw('heat', (table) => {
      if (CO.notReady(table, 'table')) return;
      table.replaceChildren();
      const del = CO.rows().filter((r) => r.done && r.month);
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
    const inRange = (rs, f, t) => rs.filter((r) => r.done && r.ddate && r.ddate >= f && r.ddate <= t);
    const delivered = () => CO.rows().filter((r) => r.done && r.ddate);
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
        const sel = document.createElement('span'); const si = document.createElement('i'); si.style.background = 'var(--bar-on)'; sel.append(si, 'report period');
        const oth = document.createElement('span'); const oi = document.createElement('i'); oi.style.background = 'var(--bar-soft)'; oth.append(oi, 'other ' + TB.G[TB.get('rchart', 'month').g].noun + 's · hover a bar for the change');
        el.replaceChildren(sel, oth); void sw; void n;
        return;
      }
      const top = CO.topTypes(delivered(), 5), cmap = CO.typeColors(top);
      el.replaceChildren(...top.map((t) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = cmap.get(t); s.append(i, t); return s; }));
    });
    dash.draw('r-chart-note', (el) => { const s = TB.get('rchart', 'month'), g = TB.grainOf(s); el.textContent = 'Creatives completed per ' + TB.G[g].noun + '. The report period is highlighted; click a bar to report on it.'; });
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
      const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Creatives completed per ' + TB.G[g].noun + ': ' + series.map((d) => TB.label(d.m, g) + ' ' + d.total).join(', '));
      const yt = d3.scaleLinear([0, d3.max(series, (d) => d.total) || 1], [H - mB, mT]).nice();
      const ticks = yt.ticks(4);
      const meas = svg.append('text').attr('class', 'tick').text(CO.num(d3.max(ticks)));
      const mL = meas.node().getComputedTextLength() + 10; meas.remove();
      const x = d3.scaleBand(ms, [mL, W - 4]).padding(0.25);
      svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'grid').attr('x1', mL).attr('x2', W - 4).attr('y1', yt).attr('y2', yt);
      svg.append('g').selectAll('text').data(ticks).join('text').attr('class', 'tick').attr('x', mL - 6).attr('y', yt).attr('dy', '0.35em').attr('text-anchor', 'end').text((d) => CO.num(d));
      const every = Math.ceil(ms.length / Math.max(1, Math.floor((W - mL) / 52)));
      svg.append('g').selectAll('text').data(ms).join('text').attr('class', (m) => 'tick' + (inSel(m) && !pr.all ? ' on' : '')).attr('x', (m, i) => i === ms.length - 1 && x(m) + x.bandwidth() / 2 + 26 > W ? W - 2 : x(m) + x.bandwidth() / 2).attr('y', H - 6).attr('text-anchor', (m, i) => i === ms.length - 1 && x(m) + x.bandwidth() / 2 + 26 > W ? 'end' : 'middle')
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
        // Plain bars: the report period in FASTRR blue, other months lavender; the change vs the month before is in the tooltip and tables.
        bar(g2.append('rect').attr('class', 'mk tone-bar')).style('fill', (d) => on(d) && !pr.all ? 'var(--bar-on)' : 'var(--bar-soft)').style('opacity', (d) => d.running ? 0.85 : 1);
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
      CO.csv('creative-report-' + (pr.all ? 'all-time' : pr.from + '-to-' + pr.to) + '.csv', ['Period', 'Breakdown', 'Name', 'Creative type', 'Creatives completed'], out);
    });
  })();

  /* ================= Sheet health ================= */
  (() => {
    let pick = '';
    const ORDER = ['Duplicate ID', 'No Creative_ID', 'ID should start with SRAP (External sheet)', 'ID should start with SRA (Internal sheet)', 'Incomplete row, not counted', 'Design and content status blank', 'Unrecognised status', 'Open, no ETA', 'No designer assigned', 'Completed, no designer', 'Completed, no creative link', 'Design finished but brief not approved', 'ETA before request date', 'Request date year looks mistyped', 'ETA year looks mistyped', 'Request date unreadable', 'ETA unreadable', 'No brand'];
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
      if (window.__liveAct) window.__liveAct('open', 'Opened task ' + EDITING.label);
      if (perm('edit')) setTimeout(checkForChanges, 50);
      const list = r.designers ? [...new Set(r.designers.split(' + ').map(CO.canon))] : [];
      before = { status: r.stage, eta: r.eta || '', designer: list.join(', '), priority: r.priority || '', qty: String(r.qty || 1) };
      $('ed-where').textContent = CO.cls(r) + ' · ' + (SHEET[r.src] || r.source) + (r.row ? ' · row ' + r.row : '') + (r.id ? ' · ' + r.id : '');
      $('ed-title').textContent = r.brand + ' · ' + r.type;
      $('ed-topic').textContent = CO.topicText(r);
      const st = $('ed-status');
      [...st.querySelectorAll('option[data-extra]')].forEach((o) => o.remove());
      // The dropdown edits Design Status only, so a task awaiting its brief shows its design status (TBP or blank).
      const dStage = r.awaiting ? 'To be planned' : r.stage;
      if (![...st.options].some((o) => o.value === dStage)) { const o = new Option(dStage + ' (as in the sheet)', dStage); o.dataset.extra = '1'; o.disabled = true; st.append(o); }
      st.value = dStage;
      $('ed-eta').value = r.eta || '';
      $('ed-designer').value = before.designer;
      const names = new Set(); (S.team || []).forEach((m) => { if (m.status !== 'Inactive') names.add(m.name); }); S.tasks.forEach((t) => t.designers && t.designers.split(' + ').forEach((d) => names.add(CO.canon(d))));
      $('ed-people').replaceChildren(...[...names].sort().map((n) => new Option(n)));
      $('ed-priority').value = /^P[0-3]$/.test(r.priority) ? r.priority : '';
      const cols = (S.cols && S.cols[r.src]) || {};
      $('ed-qty-wrap').hidden = !cols.qty; $('ed-qty').value = before.qty;
      $('ed-priority').disabled = cols.priority === false;
      $('ed-info').textContent = r.awaiting ? 'Awaiting brief (' + (r.sub || 'content not approved') + '): design has not started because the brief (content status ' + (r.content_status || 'blank') + ') is not approved yet.' : (r.done && !cols.delivered ? '' : '');
      const links = CO.links(r); $('ed-links').replaceChildren(links);
      $('ed-msg').textContent = r.id ? '' : 'This row has no ID in the sheet, so it can only be edited there.';
      $('ed-save').disabled = !r.id; $('ed-save').textContent = 'Save to sheet';
      const edit = perm('edit');
      ['ed-status', 'ed-eta', 'ed-designer', 'ed-qty'].forEach((id) => { $(id).disabled = !edit; });
      if (!edit) $('ed-priority').disabled = true;
      $('ed-save').hidden = !edit;
      if (!edit) $('ed-msg').textContent = 'View only. Ask the admin for Editor access to change tasks.';
      $('ed-history').hidden = !(A.mode === 'auth' && isAdmin() && r.id);
      if (dlgE.showModal) dlgE.showModal(); else dlgE.setAttribute('open', '');
    }
    const openFrom = (e) => {
      if (e.target.closest('a, button, input, select')) return;
      const el = e.target.closest('[data-uid]'); if (el) openEditor(el.dataset.uid);
    };
    document.querySelector('.co').addEventListener('click', openFrom);
    // Read-only hook for the reconciliation checks (the same rows this page already shows; nothing new is exposed).
  window.CO_rows = () => (CO.rows() || []).map((r) => Object.assign({}, r));
  // Static cards (their content is drawn inside them): Overview charts and lists, Team and Reports sections.
  setTimeout(() => document.querySelectorAll('[data-panel="today"] .co-card:not([data-draw]), [data-panel="team"] .co-card:not([data-draw]), [data-panel="reports"] > .co-card:not([data-draw])').forEach((c) => { const h = c.querySelector(':scope > .co-card-head .co-h2'); if (h && !c.classList.contains('na') && !c.classList.contains('daily')) collapser(c, 'card:' + h.textContent.trim(), h.textContent.trim()); }), 0);
  document.addEventListener('co-open-editor', (e) => openEditor(e.detail));
    document.querySelector('.co').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-uid][tabindex]')) openEditor(e.target.dataset.uid); });
    $('ed-cancel').addEventListener('click', () => dlgE.close());
    dlgE.addEventListener('close', () => { EDITING.uid = ''; EDITING.label = ''; });
    $('ed-history').addEventListener('click', () => { if (!current) return; dlgE.close(); AX.q = current.id; AX.kind = ''; document.getElementById('ax-q').value = current.id; document.getElementById('ax-kind').value = ''; dash.setParams({ tab: 'access' }); });
    $('editor-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = current; if (!r || !perm('edit')) return;
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
        Object.assign(t, CODATA.groupOf(t.stage)); if (t.done) { t.ddate = t.eta || t.req; if (t.ddate && t.ddate > CO.today()) t.ddate = CO.today(); t.month = t.ddate ? t.ddate.slice(0, 7) : ''; } else { t.ddate = null; t.month = ''; }
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
    if (A.mode !== 'auth' || !isAdmin()) return;
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
  /* Section picker: which parts of the dashboard a person can open (one, several or all). A dropdown with checkboxes;
     My work is always included. Used when adding someone, approving a request, giving access back and editing access. */
  const SECTIONS = [['mine', 'My work'], ['today', 'Overview'], ['standup', 'Stand-up'], ['tasks', 'Tasks'], ['notes', 'Notes'], ['team', 'Team'], ['reports', 'Reports'], ['brands', 'Brands'], ['health', 'Data health']];
  const DEF_PAGES = (role) => SECTIONS.map((x) => x[0]).filter((k) => role === 'Admin' || k !== 'health');
  const samePages = (a, b) => a.length === b.length && a.every((k) => b.includes(k));
  function secPicker(pages, onChange) {
    const d = el('details', 'sec-dd'), sm = el('summary', 'sec-sum'), pan = el('div', 'sec-pan');
    sm.setAttribute('aria-label', 'Sections they can open'); d.append(sm, pan);
    const allL = el('label', 'sec-all'), allC = document.createElement('input'); allC.type = 'checkbox'; allL.append(allC, el('span', '', 'All sections')); pan.append(allL);
    const boxes = SECTIONS.map(([k, l]) => { const lab = el('label', 'sec-opt'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = k; if (k === 'mine') { cb.disabled = true; lab.title = 'Everyone keeps their own work page'; } lab.append(cb, el('span', '', l)); pan.append(lab); return cb; });
    const paint = () => { const on = boxes.filter((b) => b.checked); allC.checked = on.length === boxes.length; allC.indeterminate = on.length > 1 && on.length < boxes.length; sm.textContent = on.length === boxes.length ? 'All sections' : on.length === 1 ? 'My work only' : on.length + ' sections: ' + on.filter((b) => b.value !== 'mine').map((b) => SECTIONS.find((x) => x[0] === b.value)[1]).join(', '); };
    d.set = (pg) => { boxes.forEach((b) => { b.checked = b.value === 'mine' || pg.includes(b.value); }); paint(); };
    d.read = () => boxes.filter((b) => b.checked).map((b) => b.value);
    boxes.forEach((b) => b.addEventListener('change', () => { d.touched = true; paint(); if (onChange) onChange(d.read()); }));
    allC.addEventListener('change', () => { d.touched = true; boxes.forEach((b) => { if (!b.disabled) b.checked = allC.checked; }); paint(); if (onChange) onChange(d.read()); });
    document.addEventListener('click', (e) => { if (d.open && !d.contains(e.target)) d.open = false; });
    d.set(pages); return d;
  }
  // Only send permissions when they differ from the role's defaults (so "defaults" stay defaults).
  const permsFor = (role, pages) => (samePages(pages, DEF_PAGES(role)) ? undefined : { pages });
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
  async function openPerson(email, toPerms) {
    PR.email = email; PR.log = null; PR.draft = null; drawPerson();
    if (dlgP.showModal && !dlgP.open) dlgP.showModal(); else dlgP.setAttribute('open', '');
    if (toPerms) setTimeout(() => { const b = document.getElementById('pm-box'); if (b) { b.scrollIntoView({ block: 'start', behavior: 'smooth' }); b.classList.add('pm-flash'); setTimeout(() => b.classList.remove('pm-flash'), 1400); } }, 60);
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
    const chip = el('span', 'chip ' + (u.status === 'Approved' ? 's-ok' : u.status === 'Pending' ? 's-warn' : 's-mute'), STATUS_LABEL[u.status] + (u.status === 'Approved' ? ' · ' + roleText(u) : ''));
    who.append(chip);
    head.append(avatar(u, 'lg'), who);
    const fact = (k, v) => { if (!v) return; facts.append(el('dt', '', k), el('dd', '', v)); };
    fact('Team / role', u.team); fact('Note to admin', u.note); fact('First asked', when(u.requestedOn));
    fact('Decided by', u.decidedBy ? nameOf(u.decidedBy) + ' · ' + when(u.decidedOn) : ''); fact('Last sign-in', when(u.lastSignIn));
    const locked = u.owner || u.email === AX.you;
    if (locked) act.append(el('p', 'co-note', u.owner ? 'The owner (Admin) always has every permission.' : 'You cannot change your own access.'));
    else {
      const sel = roleSelect(u.role);
      const lab = el('label', 'co-field', 'Access level'); lab.append(sel);
      act.append(lab);
      let pick = null;
      if (u.status !== 'Approved') {
        pick = secPicker(DEF_PAGES(u.role)); const pl = el('div', 'co-field'); pl.append(el('span', '', 'Sections they can open'), pick); act.append(pl);
        sel.addEventListener('change', () => { if (!pick.touched) pick.set(DEF_PAGES(sel.value)); });
        const w2 = el('p', 'co-note warn pm-warn', (u.name || u.email).split(' ')[0] + ' is not on the team list: as View only they would see no tasks (they only see work assigned to them). Choose Can edit, or set All tasks after approving.'); act.append(w2);
        const pw = () => { w2.hidden = !(sel.value === 'Viewer' && u.onTeam === false); }; sel.addEventListener('change', pw); pw();
      }
      const withPerms = (o) => { const pm = pick ? permsFor(sel.value, pick.read()) : undefined; return pm ? Object.assign(o, { perms: pm }) : o; };
      const btn = (text, cls, fn) => { const b = el('button', 'co-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.addEventListener('click', fn); act.append(b); };
      if (u.status === 'Pending') {
        btn('Approve', 'primary', () => setAccess(u.email, withPerms({ status: 'Approved', role: sel.value }), (u.name || u.email) + ' approved: ' + ROLE_LABEL[sel.value]));
        btn('Reject', '', () => { if (confirm('Reject the request from ' + u.email + '?')) setAccess(u.email, { status: 'Denied' }, 'Request from ' + u.email + ' rejected'); });
      } else if (u.status === 'Approved') {
        sel.addEventListener('change', () => setAccess(u.email, { role: sel.value }, (u.name || u.email) + ': ' + ROLE_LABEL[sel.value]));
        btn('Revoke access', 'danger', () => { if (confirm('Revoke access for ' + (u.name || u.email) + '? They are signed out within 30 seconds. Their past changes stay in the log.')) setAccess(u.email, { status: 'Revoked' }, 'Access revoked for ' + (u.name || u.email)); });
      } else {
        btn('Give access', 'primary', () => setAccess(u.email, withPerms({ status: 'Approved', role: sel.value }), (u.name || u.email) + ' has access: ' + ROLE_LABEL[sel.value]));
      }
    }
    // Section-by-section access (owner and Admins, any time after access is given): Hidden / View / Edit per section,
    // plus which tasks they see and the extra abilities. Saved together; every change is logged.
    if (!locked && u.status === 'Approved') {
      const P0 = u.perms || {}, first = (u.name || u.email).split(' ')[0];
      const box = el('fieldset', 'pm-box'); box.id = 'pm-box'; box.append(el('legend', '', 'What ' + first + ' can see and do'));
      const base = { pages: new Set(P0.pages || DEF_PAGES(u.role)), edit: !!P0.edit, team: !!P0.team, packages: P0.packages || '', scope: P0.scope || (u.role === 'Viewer' ? 'own' : 'all'), export: !!P0.export, load: !!P0.load, fasty: !!P0.fasty };
      base.pages.add('mine');
      const snapOf = (o) => JSON.stringify({ p: [...o.pages].sort(), e: o.edit, t: o.team, k: o.packages, s: o.scope, x: o.export, l: o.load, f: o.fasty });
      // unsaved changes survive the 30-second refresh of the access list
      const st = PR.draft && PR.draft.email === u.email ? PR.draft.st : Object.assign({}, base, { pages: new Set(base.pages) });
      const snap = () => snapOf(st), start = snapOf(base);
      const sum = el('p', 'pm-sum');
      // [key, label, what View means, what Edit means (or '' when there is nothing to edit)]
      const ROWS = [['mine', 'My work', 'Their own tasks and to-dos (always on)', ''], ['today', 'Overview', 'Team numbers, Needs attention and charts', ''], ['standup', 'Stand-up', 'Stand-up cards and the Day plan', ''],
        ['tasks', 'Tasks', 'The task list', 'Change status, ETA, designer and priority (wherever tasks appear)'], ['notes', 'Notes', 'Notes they write or are tagged in', ''], ['team', 'Team', 'Scorecards and workload', 'Add people and set them active or inactive'],
        ['reports', 'Reports', 'Reports and trends', ''], ['brands', 'Brands', 'Brand performance', ''], ['packages', 'Brand packages', 'Packages and what is left', 'Add, change and close packages'], ['health', 'Data health', 'Sheet checks and fixes needed', '']];
      const level = (k) => k === 'packages' ? (st.pages.has('brands') ? (st.packages === 'edit' ? 'edit' : st.packages === 'view' ? 'view' : 'hidden') : 'hidden')
        : !st.pages.has(k) ? 'hidden' : (k === 'tasks' && st.edit) || (k === 'team' && st.team) ? 'edit' : 'view';
      const setLevel = (k, v) => {
        if (k === 'mine') return;
        if (k === 'packages') { st.packages = v === 'hidden' ? '' : v; if (v !== 'hidden') st.pages.add('brands'); return; }
        if (v === 'hidden') { st.pages.delete(k); if (k === 'tasks') st.edit = false; if (k === 'team') st.team = false; if (k === 'brands') st.packages = ''; return; }
        st.pages.add(k); if (k === 'tasks') st.edit = v === 'edit'; if (k === 'team') st.team = v === 'edit';
      };
      const grid = el('div', 'pm-grid'); grid.setAttribute('role', 'table'); grid.setAttribute('aria-label', 'Access by section');
      const gh = el('div', 'pm-gh'); gh.setAttribute('role', 'row'); gh.append(el('span', '', 'Section'), el('span', '', 'Access')); grid.append(gh);
      const segs = [];
      ROWS.forEach(([k, label, vHint, eHint]) => {
        const r = el('div', 'pm-row' + (k === 'packages' ? ' sub' : '')); r.setAttribute('role', 'row');
        const nm = el('div', 'pm-nm'); nm.append(el('b', '', label)); const hint = el('small', '', ''); nm.append(hint);
        const seg = el('div', 'pm-seg'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', label + ' access');
        const opts = k === 'mine' ? [['view', 'View']] : eHint ? [['hidden', 'Hidden'], ['view', 'View'], ['edit', 'Edit']] : [['hidden', 'Hidden'], ['view', 'View']];
        const btns = opts.map(([v, t]) => { const b = el('button', 'pm-opt o-' + v, t); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.v = v; b.addEventListener('click', () => { setLevel(k, v); paint(); }); seg.append(b); return b; });
        segs.push({ k, btns, hint, vHint, eHint, r });
        r.append(nm, seg); grid.append(r);
      });
      box.append(sum, grid);
      // which tasks + extra abilities
      const more = el('div', 'pm-more');
      const sc = el('label', 'co-field', 'Tasks they can see'); const scs = el('select', 'co-select'); scs.append(new Option('All tasks', 'all'), new Option('Only tasks assigned to them (or whose brief they own)', 'own')); scs.value = st.scope; sc.append(scs);
      const ownWarn = el('p', 'co-note warn pm-warn', first + ' is not on the team list, so "only tasks assigned to them" would show nothing. Choose All tasks, or add them to the team list first.');
      scs.addEventListener('change', () => { st.scope = scs.value; paint(); });
      more.append(sc, ownWarn);
      const AB = [['load', 'See workload and others\' work', 'Workload estimates and "View as" on My work'], ['export', 'Download data', 'CSV downloads on Tasks, Reports and Brands'], ['fasty', 'Use Fasty', 'The voice and chat assistant']];
      const ab = el('div', 'pm-abs');
      AB.forEach(([k, l, hint]) => { const lab = el('label', 'sw'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.k = k; cb.checked = st[k]; cb.addEventListener('change', () => { st[k] = cb.checked; paint(); }); const ui = el('span', 'sw-ui'); const tx = el('span', ''); tx.append(el('b', '', l), el('small', 'co-note', hint)); lab.append(cb, ui, tx); ab.append(lab); });
      more.append(ab); box.append(more);
      box.append(el('p', 'co-note', 'Only you and Admins: giving access, the activity log and live team activity. Only you: settings. Changes apply within 30 seconds, without signing out.' + (u.custom ? '' : ' Now using the defaults for ' + ROLE_LABEL[u.role] + '.')));
      const row = el('div', 'pm-act');
      const save = el('button', 'co-btn primary', 'Save changes'); save.type = 'button';
      const undo = el('button', 'co-btn', 'Undo changes'); undo.type = 'button'; undo.addEventListener('click', () => { PR.draft = null; drawPerson(); });
      save.addEventListener('click', () => { PR.draft = null; const perms = { pages: [...st.pages], scope: st.scope, packages: st.packages, edit: st.edit, team: st.team, export: st.export, load: st.load, fasty: st.fasty }; setAccess(u.email, { perms }, 'Access saved for ' + (u.name || u.email)); });
      row.append(save, undo);
      if (u.custom) { const rs = el('button', 'co-btn ghost', 'Reset to ' + ROLE_LABEL[u.role] + ' defaults'); rs.type = 'button'; rs.addEventListener('click', () => setAccess(u.email, { perms: null }, (u.name || u.email) + ': back to ' + ROLE_LABEL[u.role] + ' defaults')); row.append(rs); }
      box.append(row); act.append(box);
      function paint() {
        segs.forEach(({ k, btns, hint, vHint, eHint, r }) => {
          const lv = level(k); btns.forEach((b) => { const on = b.dataset.v === lv; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
          hint.textContent = lv === 'edit' ? 'Can see and ' + eHint.charAt(0).toLowerCase() + eHint.slice(1) : lv === 'view' ? vHint + (eHint ? ' · view only' : '') : 'Not shown to ' + first;
          r.classList.toggle('off', lv === 'hidden');
        });
        const n = SECTIONS.filter(([k]) => st.pages.has(k)).length, edits = [st.edit && 'tasks', st.team && 'the team list', st.packages === 'edit' && 'brand packages'].filter(Boolean);
        sum.textContent = 'Opens ' + n + ' of ' + SECTIONS.length + ' sections · ' + (edits.length ? 'can edit ' + edits.join(', ') : 'view only') + ' · sees ' + (st.scope === 'own' ? 'only their own tasks' : 'all tasks');
        ownWarn.hidden = !(st.scope === 'own' && u.onTeam === false);
        const dirty = snap() !== start; PR.draft = dirty ? { email: u.email, st } : null; save.disabled = !dirty; undo.hidden = !dirty; box.classList.toggle('dirty', dirty);
      }
      paint();
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
  dlgP.addEventListener('close', () => { PR.email = ''; PR.draft = null; });
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
      if (locked || u.status !== 'Approved') rc.textContent = u.owner ? 'Admin' : ROLE_LABEL[u.role] + (u.custom ? ' · custom' : '');
      else { const s = roleSelect(u.role); s.addEventListener('change', () => setAccess(u.email, { role: s.value }, (u.name || u.email) + ': ' + ROLE_LABEL[s.value])); rc.append(s); }
      if (u.status === 'Approved' && !u.owner) { const P = u.perms || {}, n = (P.pages || []).length, ed = [P.edit && 'tasks', P.team && 'team', P.packages === 'edit' && 'packages'].filter(Boolean); rc.append(el('small', 'ax-psum', n + '/' + SECTIONS.length + ' sections · ' + (ed.length ? 'edits ' + ed.join(', ') : 'view only') + (P.packages === 'view' ? ' · sees packages' : ''))); }
      const sc = tr.insertCell(); const chip = el('span', 'chip ' + (u.status === 'Approved' ? 's-ok' : 's-mute'), STATUS_LABEL[u.status]); sc.append(chip);
      CO.td(tr, when(u.lastSignIn), 'co-nowrap');
      CO.td(tr, u.decidedBy ? nameOf(u.decidedBy) + ' · ' + when(u.decidedOn) : '—', 'co-nowrap co-muted co-hide-md');
      const ac = tr.insertCell(); ac.className = 'co-nowrap ax-acts';
      if (!locked && u.status === 'Approved') { const pb = el('button', 'co-link ax-perm', 'Permissions'); pb.type = 'button'; pb.addEventListener('click', () => openPerson(u.email, true)); ac.append(pb); }
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
    if (!AX.log) { CO.emptyRow(tb, 5, AX.err || 'Loading…'); return; }
    if (!AX.log.length) { CO.emptyRow(tb, 5, AX.q || AX.kind || AX.who ? 'Nothing matches.' : 'No activity recorded yet.'); return; }
    AX.log.forEach((e) => {
      const tr = tb.insertRow();
      const mk = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
      CO.td(tr, when(e.when), 'ax-when');
      const w = CO.td(tr, e.who.includes('@') ? nameOf(e.who) : e.who, 'ax-who'); w.title = e.who + (e.role ? ' · ' + (ROLE_LABEL[e.role] || e.role) : '');
      const ac = tr.insertCell(); ac.className = 'ax-act'; ac.append(mk('b', '', e.action)); if (e.record) ac.append(mk('span', 'ax-rec', e.record));
      const ch = tr.insertCell(); ch.className = 'ax-chg';
      if (e.field) {
        ch.append(mk('span', 'ax-field', e.field));
        const line = mk('span', 'ax-line');
        const bf = mk('span', 'ax-before', e.before === '' ? '(blank)' : e.before), af = mk('span', 'ax-after', e.after === '' ? '(blank)' : e.after);
        line.append(bf, mk('span', 'ax-arrow', '→'), af); ch.append(line); ch.title = e.field + ': ' + (e.before || '(blank)') + ' → ' + (e.after || '(blank)');
      } else ch.append(mk('span', 'ax-after', e.after || e.details || '—'));
      if (e.field && e.details) ch.append(mk('span', 'ax-det', e.details));
      CO.td(tr, [[e.sheet, e.tab].filter(Boolean).join(' / '), e.row ? 'row ' + e.row : '', e.via].filter(Boolean).join(' · '), 'ax-where');
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
  // Section picker on the "add a person" form; follows the chosen access level until changed by hand.
  const AXP = secPicker(DEF_PAGES('Viewer'));
  document.getElementById('ax-role').after(AXP);
  document.getElementById('ax-role').addEventListener('change', (e) => { if (!AXP.touched) AXP.set(DEF_PAGES(e.target.value)); });
  document.getElementById('ax-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('ax-email').value.trim().toLowerCase(), role = document.getElementById('ax-role').value, perms = permsFor(role, AXP.read());
    const msg = document.getElementById('ax-msg');
    if (!A.domains.some((d) => email.endsWith('@' + d))) { msg.textContent = 'Use a ' + A.domains.map((d) => '@' + d).join(' or ') + ' address.'; return; }
    const exists = (AX.users || []).find((u) => u.email === email);
    msg.textContent = '';
    setAccess(email, Object.assign({ status: 'Approved', role }, perms ? { perms } : {}), email + ' can now sign in: ' + ROLE_LABEL[role]);
    e.target.reset(); AXP.touched = false; AXP.set(DEF_PAGES('Viewer'));
  });

  /* Reminder times (IST minutes since midnight); the web app sends the admin's settings with every check. */
  const REMIND_AT = { morning: 600, evening: 1080, label: { morning: '10:00', evening: '18:00' } };
  /* Presence: who is online (admins only see the list; everyone is told it is visible). */
  const PRS = { on: true, list: [] };
  const PAGE_NAME = { mine: 'My work', today: 'Overview', standup: 'Stand-up', tasks: 'Tasks', notes: 'Notes', team: 'Team', reports: 'Reports', brands: 'Brands', health: 'Data health', access: 'Access' };
  const agoText = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : CO.istDateTime(iso); };
  dash.draw('presence-mini', (el) => {
    el.replaceChildren(); if (!isAdmin() || A.mode !== 'auth' || !PRS.on) return;
    const on = PRS.list.filter((p) => p.online && (!A.user || p.email !== A.user.email));
    if (!on.length) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pm-mini'; b.title = on.map((p) => p.name + ' · ' + (p.doing || PAGE_NAME[p.page] || 'dashboard')).join('\n');
    on.slice(0, 4).forEach((p) => { const a = CO.av(p.name); a.classList.add('live'); b.append(a); });
    const n = document.createElement('span'); n.textContent = on.length + ' online'; b.append(n);
    b.addEventListener('click', () => { dash.setParams({ tab: 'today' }); setTimeout(() => { const c = document.querySelector('.la-card'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 150); }); el.append(b);
  });
  dash.draw('presence', (el) => {
    el.replaceChildren();
    if (!PRS.on) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'Presence is switched off in the reminder settings below.'; el.append(p); return; }
    const list = PRS.list.slice().sort((a, b) => (b.online - a.online) || String(b.at).localeCompare(String(a.at)));
    if (!list.length) { const p = document.createElement('p'); p.className = 'co-note'; p.textContent = 'Checking who is online…'; el.append(p); return; }
    const box = document.createElement('div'); box.className = 'la-list'; list.forEach((p) => box.append(liveRow(p))); el.append(box);
  });

  /* ============ Live team activity ============
     Everyone's dashboard reports, every 15 seconds and a few seconds after anything they do: the page, a one-line
     description of what they are doing, whether they are idle, and their recent actions on the dashboard (pages opened,
     buttons clicked, boxes ticked, filters chosen, searches, tasks opened and updates saved; never what they type in notes).
     The owner's dashboard shows who is online, where, and a live feed of those actions. Kept 30 minutes in the server cache. */
  const LIVE = { lastInput: Date.now(), acts: [], since: Date.now(), soon: 0, lastSent: 0, page: '', feed: LS.get('co.lafeed', 'all'), more: false };
  ['keydown', 'scroll', 'pointerdown', 'pointermove'].forEach((ev) => addEventListener(ev, () => { LIVE.lastInput = Date.now(); }, { passive: true }));
  const cleanT = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const labelOf = (el) => cleanT(el.getAttribute('aria-label') || (el.matches('.co-kpi') ? (el.querySelector('.co-kpi-label') || el).textContent : '') || el.textContent || el.title).replace(/[↗→↓↑]/g, '').trim().slice(0, 60);
  function liveAct(kind, text) {
    if (!text || A.mode !== 'auth' || !A.user) return;
    const last = LIVE.acts[LIVE.acts.length - 1];
    if (last && last.x === text && Date.now() - last.t < 4000) return;
    LIVE.acts.push({ t: Date.now(), k: kind, x: String(text).slice(0, 110), p: curTab() });
    if (LIVE.acts.length > 25) LIVE.acts.shift();
    clearTimeout(LIVE.soon); LIVE.soon = setTimeout(sendBeat, Math.max(1200, 4000 - (Date.now() - LIVE.lastSent)));
  }
  window.__liveAct = liveAct;
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a[href], [role="tab"], [role="radio"], [role="button"], summary, .co-kpi');
    if (!t || t.closest('.ash, .la-card, #gate') || t.matches('input, label')) return;
    const x = labelOf(t); if (!x || x.length < 2) return;
    liveAct('click', 'Clicked “' + x + '”');
  }, true);
  document.addEventListener('change', (e) => {
    const t = e.target; if (!t || !t.matches || t.closest('.ash, .la-card, #gate')) return;
    const lab = cleanT((t.labels && t.labels[0] && t.labels[0].textContent) || t.getAttribute('aria-label') || t.name || '').slice(0, 50);
    if (t.type === 'checkbox' || t.type === 'radio') liveAct('check', (t.checked ? 'Ticked ' : 'Unticked ') + '“' + (lab || 'a box') + '”');
    else if (t.tagName === 'SELECT') { const o = t.selectedOptions && t.selectedOptions[0]; liveAct('filter', 'Chose “' + cleanT(o ? o.textContent : t.value).slice(0, 40) + '”' + (lab ? ' in ' + lab : '')); }
    else if (t.type === 'date') liveAct('filter', 'Set ' + (lab || 'a date') + ' to ' + t.value);
  }, true);
  let liveQ = 0;
  document.addEventListener('input', (e) => { const t = e.target; if (!t || t.type !== 'search' || t.closest('.ash')) return; clearTimeout(liveQ); liveQ = setTimeout(() => { if (t.value.trim()) liveAct('search', 'Searched “' + t.value.trim().slice(0, 40) + '”'); }, 1200); }, true);
  setInterval(() => { const t = curTab(); if (A.mode === 'auth' && A.user && t !== LIVE.page) { if (LIVE.page) liveAct('view', 'Opened ' + (PAGE_NAME[t] || t)); LIVE.page = t; } }, 1000);
  const describeActivity = () => {
    const p = dash.params(), tab = curTab(), parts = [];
    if (EDITING.uid) return 'Editing ' + EDITING.label;
    const fy = document.querySelector('.ash:not([hidden])'); if (fy) return 'Asking Fasty';
    const dlg = document.querySelector('dialog[open]'); if (dlg) { const t = (dlg.querySelector('h2, .co-h2, [id$="title"]') || {}).textContent; if (tab === 'notes' || /note/i.test(dlg.id)) return 'Writing a note'; if (t) return 'Viewing ' + t.trim().slice(0, 60); }
    const f = [p.src ? CO.cls(p.src) : '', p.designer === '__none' ? 'Unassigned' : p.designer, p.brand, p.type].filter(Boolean);
    if (tab === 'tasks') parts.push('Tasks' + (p.stage && p.stage !== 'active' ? ': ' + p.stage.replace(/-/g, ' ') : ''));
    else if (tab === 'reports') parts.push('Reports: ' + (p.rpreset || 'this month').replace(/-/g, ' '));
    else parts.push(PAGE_NAME[tab] || 'Dashboard');
    if (f.length) parts.push('filtered by ' + f.join(', '));
    return 'Viewing ' + parts.join(' · ');
  };
  function sendBeat() {
    if (A.mode !== 'auth' || !A.user || document.visibilityState !== 'visible') return;
    clearTimeout(LIVE.soon); LIVE.lastSent = Date.now();
    const idle = Date.now() - LIVE.lastInput > 2 * 60 * 1000, acts = LIVE.acts.splice(0);
    callApi({ action: 'beat', at: { page: curTab(), task: EDITING.uid, taskLabel: EDITING.label, doing: describeActivity(), idle, away: false, since: LIVE.since, now: Date.now(), acts } }, true)
      .then((b) => { if (!b || !b.ok) LIVE.acts.unshift(...acts.slice(-10)); }).catch(() => { LIVE.acts.unshift(...acts.slice(-10)); });
  }
  setInterval(sendBeat, 15 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { LIVE.since = LIVE.since || Date.now(); sendBeat(); } });
  async function pollPresence() {
    if (A.mode !== 'auth' || !isAdmin() || document.visibilityState !== 'visible') return;
    try { const b = await callApi({ action: 'presence' }, true); if (b.ok) { PRS.on = b.on !== false; PRS.list = b.presence || []; PRS.at = Date.now(); PRS.skew = b.now ? Date.now() - b.now : 0; dash.draw('presence'); dash.draw('presence-mini'); dash.draw('live-activity'); } } catch (e) { /* next time */ }
  }
  // Faster while the live card is on screen (Overview or Access), slower otherwise (just the "online" pill).
  let presTick = 0;
  setInterval(() => { presTick++; const fast = ['today', 'access'].includes(curTab()); if (fast || presTick % 3 === 0) pollPresence(); }, 5 * 1000);
  // A colour per person, from the brand palette, so they are recognisable at a glance.
  const HUES = ['#6037d7', '#ff5a26', '#2f8fa0', '#7a8c00', '#c2410c', '#685bc7', '#0f9d8a', '#b8357a'];
  const hueOf = (email) => { let h = 0; for (const c of String(email)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]; };
  const identity = (p, size) => {
    const w = document.createElement('span'); w.className = 'la-id' + (size ? ' ' + size : ''); w.style.setProperty('--hue', hueOf(p.email));
    const av = document.createElement('span'); av.className = 'la-av';
    if (p.photo) { const im = document.createElement('img'); im.src = p.photo; im.alt = ''; im.referrerPolicy = 'no-referrer'; im.onerror = () => { im.remove(); av.textContent = CO.initials(p.name); }; av.append(im); } else av.textContent = CO.initials(p.name);
    const dot = document.createElement('i'); dot.className = 'la-dot'; w.append(av, dot); return w;
  };
  const stateOf = (p) => !p.online ? 'offline' : p.away ? 'away' : p.idle ? 'idle' : p.taskLabel ? 'editing' : 'active';
  const STATE_L = { active: 'Active', editing: 'Editing', idle: 'Idle', away: 'Away', offline: 'Offline' };
  const srvNow = () => Date.now() - (PRS.skew || 0);
  const secsAgo = (t) => { const s = Math.max(0, Math.round((srvNow() - new Date(t)) / 1000)); return s < 10 ? 'just now' : s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };
  const durText = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : ''); };
  const KIND = { view: 'Page', click: 'Click', check: 'Tick', filter: 'Filter', search: 'Search', open: 'Task', update: 'Update' };
  const el2 = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
  const liveRow = (p) => {
    const st = stateOf(p), r = el2('div', 'la-row s-' + st);
    const tx = el2('div', 'la-tx');
    const top = el2('div', 'la-top'); top.append(el2('b', '', p.name)); if (p.online) top.append(el2('span', 'la-page', PAGE_NAME[p.page] || 'Dashboard'));
    tx.append(top, el2('small', 'la-doing', p.online ? (p.doing || (p.taskLabel ? 'Editing ' + p.taskLabel : 'On ' + (PAGE_NAME[p.page] || 'the dashboard'))) : 'Last active ' + agoText(p.at)));
    const lastA = (p.acts || [])[0];
    if (p.online && lastA) tx.append(el2('small', 'la-last', lastA.x + ' · ' + secsAgo(lastA.t)));
    const side = el2('div', 'la-side'); side.append(el2('span', 'la-state', STATE_L[st]));
    if (p.online && p.since) side.append(el2('small', 'la-for', 'online ' + durText(srvNow() - p.since)));
    r.append(identity(p), tx, side); return r;
  };
  dash.draw('live-activity', (el) => {
    const show = A.mode === 'auth' && isAdmin() && PRS.on;
    el.classList.toggle('la-off', !show); if (!show) { el.replaceChildren(); return; }
    const others = PRS.list.filter((p) => !A.user || p.email !== A.user.email);
    const rank = { editing: 0, active: 1, idle: 2, away: 3, offline: 4 };
    const on = others.filter((p) => p.online).sort((a, b) => rank[stateOf(a)] - rank[stateOf(b)] || a.name.localeCompare(b.name));
    const off = others.filter((p) => !p.online).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    el.replaceChildren();
    const hd = el2('div', 'na-head');
    const l = el2('div'); const h2 = el2('h2', 'co-h2'); h2.append(el2('i', 'la-pulse'), 'Live team activity'); h2.append(el2('span', 'na-count' + (on.length ? '' : ' ok'), on.length + ' online'));
    l.append(h2, el2('p', 'co-note', on.length ? 'Who is on the dashboard, where, and what they are doing. Only Admins see this.' : 'Nobody else is on the dashboard right now. Their actions show here as soon as they open it.'));
    hd.append(l); el.append(hd); collapser(el, 'live', 'Live team activity');
    const body = el2('div', 'la-body');
    if (on.length) { const list = el2('div', 'la-list'); on.forEach((p) => list.append(liveRow(p))); body.append(list); }
    if (off.length) {
      const d = el2('details', 'la-offline'); const sm = el2('summary'); const avs = el2('span', 'la-avs'); off.slice(0, 6).forEach((p) => avs.append(identity(Object.assign({}, p, { online: false }), 'sm')));
      sm.append(avs, el2('span', '', off.length + ' offline' + (off[0].at ? ' · last seen ' + off[0].name.split(' ')[0] + ' ' + agoText(off[0].at) : ''))); d.append(sm);
      const ol = el2('div', 'la-list'); off.forEach((p) => ol.append(liveRow(p))); d.append(ol); body.append(d);
    }
    // Activity feed: every recent action across the team, newest first.
    const all = [];
    others.forEach((p) => (p.acts || []).forEach((a) => all.push(Object.assign({ who: p }, a))));
    all.sort((a, b) => b.t - a.t);
    const feedHd = el2('div', 'la-feed-hd'); feedHd.append(el2('h3', '', 'Activity'));
    const seg = el2('div', 'la-seg'); [['all', 'Everything'], ['update', 'Updates only']].forEach(([k, t]) => { const bt = el2('button', k === LIVE.feed ? 'on' : '', t); bt.type = 'button'; bt.setAttribute('aria-pressed', String(k === LIVE.feed)); bt.addEventListener('click', () => { LIVE.feed = k; LS.set('co.lafeed', k); flip(() => dash.draw('live-activity')); }); seg.append(bt); });
    feedHd.append(seg); body.append(feedHd);
    const rows = all.filter((a) => LIVE.feed === 'all' || a.k === 'update' || a.k === 'check');
    const lim = LIVE.more ? 40 : 8, ul = el2('ul', 'la-feed');
    if (!rows.length) ul.append(el2('li', 'la-empty', LIVE.feed === 'all' ? 'Actions appear here as people use the dashboard.' : 'No updates in the last 30 minutes.'));
    rows.slice(0, lim).forEach((a) => {
      const li = el2('li', 'k-' + a.k); li.style.setProperty('--hue', hueOf(a.who.email));
      const tm = el2('span', 'la-t', secsAgo(a.t)); tm.title = new Date(a.t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
      const tx = el2('span', 'la-ft'); tx.append(el2('b', '', a.who.name.split(' ')[0]), ' ' + a.x.charAt(0).toLowerCase() + a.x.slice(1));
      const meta = el2('span', 'la-fm'); meta.append(el2('span', 'la-kind', KIND[a.k] || 'Action'), el2('span', '', PAGE_NAME[a.p] || ''));
      li.append(el2('i', 'la-fdot'), tm, tx, meta); ul.append(li);
    });
    body.append(ul);
    if (rows.length > 8) { const mb = el2('button', 'co-link cal-more-btn'); mb.textContent = LIVE.more ? 'Show fewer' : 'Show ' + (Math.min(40, rows.length) - 8) + ' more'; mb.type = 'button'; mb.addEventListener('click', () => flip(() => { LIVE.more = !LIVE.more; dash.draw('live-activity'); })); body.append(mb); }
    el.append(body);
  });

  /* Daily snapshots kept by the web app (open, overdue… per day, IST), for exact before/after comparisons. */
  const HS = { days: [], at: 0 };
  async function loadHistory() {
    if (A.mode !== 'auth' || !A.user || Date.now() - HS.at < 30 * 60 * 1000) return;
    HS.at = Date.now();
    try { const b = await callApi({ action: 'history' }); if (b.ok) { HS.days = b.days || []; dash.draw('kpi-sub'); } } catch (e) { /* older web app: no comparisons */ }
  }

  /* ================= Dropdown menus =================
     Every dropdown (select.co-select and Fasty's language) opens the same menu: aligned to the control's left edge, at
     least as wide as it, a tick on the current choice, a search box for long lists, full keyboard support. The native
     select stays the source of truth (same layout, same change events). Phones keep the native picker. */
  (() => {
    if (!matchMedia('(pointer: fine)').matches) return;
    const SEL = 'select.co-select, select.ash-lang';
    let cur = null;
    const menu = document.createElement('div'); menu.className = 'cs-menu'; menu.hidden = true; menu.setAttribute('role', 'listbox'); document.body.append(menu);
    // The menu goes in the browser's top layer, so it shows above open dialogs (Add package, task editor, person) too.
    const POP = typeof menu.showPopover === 'function'; if (POP) menu.setAttribute('popover', 'manual');
    const popShow = (s) => {
      // inside an open dialog the rest of the page is inert (cannot be clicked), so the menu moves into that dialog
      const host = (s && s.closest('dialog[open]')) || document.body;
      if (menu.parentNode !== host) { popHide(); host.append(menu); }
      if (!POP) return; try { if (menu.matches(':popover-open')) menu.hidePopover(); menu.showPopover(); } catch (e) { /* older browser: z-index */ }
    };
    const popHide = () => { if (POP) try { if (menu.matches(':popover-open')) menu.hidePopover(); } catch (e) { /* ignore */ } };
    const close = (refocus) => { if (!cur) return; const s = cur.sel; menu.hidden = true; popHide(); s.setAttribute('aria-expanded', 'false'); s.classList.remove('cs-open'); cur = null; if (refocus) s.focus(); };
    const place = () => {
      if (!cur) return; const r = cur.sel.getBoundingClientRect(), vh = innerHeight, vw = document.documentElement.clientWidth;
      menu.style.minWidth = Math.max(r.width, 180) + 'px'; menu.style.maxWidth = Math.max(r.width, Math.min(360, vw - 24)) + 'px';
      const h = Math.min(menu.scrollHeight, 340), below = vh - r.bottom - 12, up = below < Math.min(h, 220) && r.top > below;
      menu.style.maxHeight = Math.max(160, (up ? r.top : below) - 8) + 'px';
      menu.style.top = (up ? Math.max(8, r.top - Math.min(h, r.top - 16) - 6) : r.bottom + 6) + 'px';
      const left = Math.min(r.left, vw - menu.offsetWidth - 12); menu.style.left = Math.max(12, left) + 'px';
    };
    function build(q) {
      const s = cur.sel, items = [], ql = String(q || '').toLowerCase().trim();
      menu.querySelectorAll('.cs-opt, .cs-group, .cs-none').forEach((x) => x.remove());
      [...s.children].forEach((ch) => {
        const opts = ch.tagName === 'OPTGROUP' ? [...ch.children] : [ch];
        if (ch.tagName === 'OPTGROUP') { const g = document.createElement('div'); g.className = 'cs-group'; g.textContent = ch.label; menu.append(g); }
        opts.forEach((o) => {
          if (o.hidden || (ql && !o.textContent.toLowerCase().includes(ql))) return;
          const b = document.createElement('div'); b.className = 'cs-opt' + (o.selected ? ' on' : '') + (o.disabled ? ' off' : ''); b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(o.selected)); b.textContent = o.textContent; b.dataset.v = o.value;
          b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', () => { if (!o.disabled) choose(o.value); });
          menu.append(b); items.push(b);
        });
      });
      if (!items.length) { const n = document.createElement('div'); n.className = 'cs-none'; n.textContent = 'Nothing matches'; menu.append(n); }
      cur.items = items; cur.hi = Math.max(0, items.findIndex((x) => x.classList.contains('on'))); paint();
    }
    const paint = () => { cur.items.forEach((x, i) => x.classList.toggle('hi', i === cur.hi)); const h = cur.items[cur.hi]; if (h) h.scrollIntoView({ block: 'nearest' }); };
    function choose(v) { const s = cur.sel; if (s.value !== v) { s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); } close(true); }
    function open(s) {
      if (cur && cur.sel === s) { close(true); return; } close(); if (s.disabled) return;
      cur = { sel: s, items: [], hi: 0 }; menu.replaceChildren(); menu.classList.toggle('cs-ash', s.matches('.ash-lang'));
      if (s.options.length > 10) { const f = document.createElement('input'); f.className = 'cs-find'; f.type = 'search'; f.placeholder = 'Search'; f.setAttribute('aria-label', 'Search options'); f.addEventListener('input', () => { build(f.value); place(); }); f.addEventListener('keydown', key); menu.append(f); setTimeout(() => f.focus(), 0); }
      build(''); menu.hidden = false; popShow(s); s.setAttribute('aria-expanded', 'true'); s.classList.add('cs-open'); place();
    }
    function key(e) {
      if (!cur) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!cur.items.length) return; cur.hi = (cur.hi + (e.key === 'ArrowDown' ? 1 : -1) + cur.items.length) % cur.items.length; paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); const h = cur.items[cur.hi]; if (h && !h.classList.contains('off')) choose(h.dataset.v); }
      else if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); close(e.key === 'Escape'); }
    }
    document.addEventListener('mousedown', (e) => {
      const s = e.target.closest && e.target.closest(SEL);
      if (s && e.button === 0) { e.preventDefault(); s.focus(); open(s); return; }
      if (cur && !menu.contains(e.target)) close();
    }, true);
    document.addEventListener('keydown', (e) => {
      const s = e.target.closest && e.target.closest(SEL);
      if (s && !cur && (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown'))) { e.preventDefault(); open(s); return; }
      if (cur && (e.target === cur.sel || menu.contains(e.target))) key(e);
    }, true);
    addEventListener('resize', () => close()); addEventListener('scroll', (e) => { if (cur && !menu.contains(e.target)) place(); }, true);
  })();

  /* ================= Motion helpers ================= */
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* Smooth layout (FLIP): note where every card is, make the change, then glide each card from its old place and size to
     the new one, so minimising or expanding anything never makes the page jump, overlap or leave a gap. */
  /* Masonry: a stack of cards shown in two or more columns (the Overview side column when Needs attention is minimised,
     or on tablets) packs each card under the shortest column instead of leaving row gaps. CSS grid with 1px rows: each card
     spans its own height. One column = normal flow. */
  const MAS = { list: [], ro: null, queued: false, mos: [] };
  /* Needs attention beside the side cards only when its list is at least as tall as them; otherwise it goes full
     width on top and the side cards pack in two columns below, so neither column leaves blank space. */
  function naFit() {
    const na = document.querySelector('.ov-grid.fill > .co-card.na'), grid = na && na.closest('.ov-grid'), side = grid && grid.querySelector('.ov-side');
    if (!na || !side || !na.offsetParent || NA.min || innerWidth <= 1100) { if (grid && innerWidth <= 1100) grid.classList.remove('na-short'); return; }
    const list = na.querySelector('.na-list');
    const naNeed = [...na.children].reduce((h, c) => h + (c === list ? c.scrollHeight : c.offsetHeight), 0) + 60;
    const kids = [...side.children].filter((k) => getComputedStyle(k).display !== 'none'), gap = 16;
    const short = grid.classList.contains('na-short');
    // the side column's single-column height (cards keep similar heights; hysteresis avoids flipping back and forth)
    const sideNeed = kids.reduce((h, k) => h + k.scrollHeight + gap, 0) * (short ? 1.15 : 1);
    const want = naNeed < sideNeed * (short ? 1 : 0.92);
    if (want !== short) { grid.classList.toggle('na-short', want); masQueue(); }
  }
  addEventListener('resize', () => requestAnimationFrame(naFit));
  function masLayout(c) {
    const all = [...c.children];
    all.forEach((k) => { k.style.gridColumn = ''; k.style.gridRowStart = ''; k.style.gridRowEnd = ''; k.style.minHeight = ''; k.classList.remove('mas-wide'); });
    const cs = getComputedStyle(c), cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
    if (cols < 2) { c.classList.remove('mas-on'); all.forEach((k) => k.classList.remove('mas-wide')); return; }
    c.classList.add('mas-on');
    const gap = parseFloat(cs.columnGap) || 16, STRETCH = 56; // small bottom differences only: no tall empty space inside a card
    const kids = all.filter((k) => getComputedStyle(k).display !== 'none');
    // .mas-flex cards (Pipeline) may run full width or sit in a column: whichever leaves less empty space.
    const items = kids.map((k) => ({ k, flex: k.classList.contains('mas-flex'), h: Math.ceil(k.scrollHeight + 2) }));
    const planSeg = (seg) => {
      const n = seg.length, hs = seg.map((x) => x.h + gap), fixed = Math.min(cols, n), restN = n - fixed;
      const score = (asg) => { const ch = new Array(cols).fill(0); asg.forEach((col, i) => { ch[col] += hs[i]; }); return Math.max(...ch) * 1000 + asg.reduce((s2, col, i) => s2 + col * (n - i), 0) / 1e3; };
      let best = null;
      if (Math.pow(cols, restN) <= 6561) {
        const asg = seg.map((_, i) => (i < fixed ? i : 0));
        const rec = (i) => { if (i === n) { const sc = score(asg); if (!best || sc < best.sc) best = { sc, asg: asg.slice() }; return; } for (let col = 0; col < cols; col++) { asg[i] = col; rec(i + 1); } };
        rec(fixed);
      } else { const ch = new Array(cols).fill(0), asg = []; hs.forEach((h, i) => { const col = i < fixed ? i : ch.indexOf(Math.min(...ch)); asg.push(col); ch[col] += h; }); best = { asg }; }
      const off = new Array(cols).fill(0), last = new Array(cols).fill(-1), pos = [];
      seg.forEach((x, i) => { const col = best.asg[i]; pos.push({ x, col, top: off[col], span: hs[i], grow: 0 }); off[col] += hs[i]; last[col] = i; });
      const maxH = n ? Math.max(...off) : 0; let voidPx = 0;
      last.forEach((i, col) => { const d = maxH - off[col]; if (i < 0) { voidPx += maxH; return; } if (d > 0 && d <= STRETCH) pos[i].grow = d; else voidPx += d; });
      return { pos, height: maxH, voidPx };
    };
    const plan = (fullFlex) => {
      let base = 0, voidPx = 0, seg = []; const out = [];
      const flush = () => { if (!seg.length) return; const r = planSeg(seg); r.pos.forEach((q) => out.push(Object.assign(q, { top: q.top + base }))); base += r.height; voidPx += r.voidPx; seg = []; };
      items.forEach((x) => { if (x.flex && fullFlex) { flush(); out.push({ x, col: -1, top: base, span: x.h + gap, grow: 0 }); base += x.h + gap; } else seg.push(x); });
      flush(); return { out, voidPx, height: base };
    };
    const hasFlex = items.some((x) => x.flex);
    let best = plan(false);
    if (hasFlex) {
      // Measure the full-width height of the flex card first (its content reflows to two columns).
      items.forEach((x) => { if (x.flex) { x.k.classList.add('mas-wide'); x.hw = Math.ceil(x.k.scrollHeight + 2); x.k.classList.remove('mas-wide'); } });
      const hN = items.map((x) => x.h); items.forEach((x) => { if (x.flex) x.h = x.hw; });
      const wide = plan(true); items.forEach((x, i) => { x.h = hN[i]; });
      if (wide.voidPx + wide.height * 0.02 < best.voidPx + best.height * 0.02) { best = wide; items.forEach((x) => { if (x.flex) x.h = x.hw; }); }
    }
    // A column that ends short: if its last card has more rows to show ([data-fill]), show as many as fit.
    const lastIn = {}; best.out.forEach((q) => { if (q.col >= 0 && (!lastIn[q.col] || q.top > lastIn[q.col].top)) lastIn[q.col] = q; });
    let filled = false;
    Object.values(lastIn).forEach((q) => {
      const end = q.top + q.span, segEnd = best.out.filter((o) => o.col >= 0 && o.top < end + 1 && o.top + o.span > q.top).reduce((m, o) => Math.max(m, o.top + o.span), 0), room = segEnd - end;
      const fl = room > 40 && q.x.k.querySelector('[data-fill]'); if (!fl) return;
      const hid = [...fl.children].filter((c) => c.hidden), shown = [...fl.children].find((c) => !c.hidden);
      const rh = shown ? shown.offsetHeight + 8 : 60; let n = Math.floor(room / rh);
      hid.slice(0, n).forEach((c) => { c.hidden = false; filled = true; });
    });
    if (filled) { MAS.mos.forEach((o) => o.takeRecords()); return masLayout(c); }
    best.out.forEach((q) => {
      const k = q.x.k; k.classList.toggle('mas-wide', q.col < 0);
      k.style.gridColumn = q.col < 0 ? '1 / -1' : String(q.col + 1);
      k.style.gridRowStart = String(q.top + 1);
      k.style.gridRowEnd = 'span ' + Math.max(1, q.span + q.grow);
      if (q.grow) k.style.minHeight = (k.getBoundingClientRect().height + q.grow) + 'px';
    });
  }
  const masAll = () => { MAS.queued = false; naFit(); MAS.list.forEach((c) => { if (c.isConnected && c.offsetParent) masLayout(c); }); MAS.mos.forEach((o) => o.takeRecords()); };
  const masQueue = () => { if (MAS.queued) return; MAS.queued = true; requestAnimationFrame(masAll); };
  function masonry(c) {
    if (!c || MAS.list.includes(c)) return; MAS.list.push(c);
    if (!MAS.ro) MAS.ro = new ResizeObserver(masQueue);
    MAS.ro.observe(c); [...c.children].forEach((k) => MAS.ro.observe(k));
    const mo = new MutationObserver(() => { [...c.children].forEach((k) => MAS.ro.observe(k)); masQueue(); });
    mo.observe(c, { childList: true }); mo.observe(c, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] }); MAS.mos.push(mo);
    masQueue();
  }
  setTimeout(() => document.querySelectorAll('[data-masonry]').forEach(masonry), 0);
  function flip(mutate) {
    const root = document.querySelector('.co-panel:not([hidden])') || document.body;
    const items = REDUCED ? [] : [...root.querySelectorAll('.co-card, .su, .co-kpi, .sys, .brief-card')].filter((e) => e.offsetParent);
    const before = new Map(items.map((e) => [e, e.getBoundingClientRect()]));
    mutate(); masAll();
    items.forEach((e) => {
      if (!e.isConnected || !e.offsetParent) return;
      const a = before.get(e), b = e.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top, dh = a.height - b.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(dh) < 1) return;
      const opts = { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)' };
      if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) e.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], opts);
      if (Math.abs(dh) >= 1) { e.style.overflow = 'hidden'; const an = e.animate([{ height: a.height + 'px' }, { height: b.height + 'px' }], opts); an.onfinish = an.oncancel = () => { e.style.overflow = ''; }; }
    });
  }
  /* Minimise / expand for any card with a header: one consistent control, remembered per device, animated with flip(). */
  const MIN = new Set((() => { try { return JSON.parse(LS.get('co.min', '[]')) || []; } catch (e) { return []; } })());
  function collapser(card, key, label) {
    const head = card && card.querySelector(':scope > .co-card-head, :scope > .na-head'); if (!head) return;
    const min = MIN.has(key); card.classList.toggle('is-min', min);
    let b = head.querySelector(':scope > .min-tog');
    if (!b) {
      b = document.createElement('button'); b.type = 'button'; b.className = 'min-tog'; b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
      b.addEventListener('click', () => { flip(() => { if (MIN.has(key)) MIN.delete(key); else MIN.add(key); LS.set('co.min', JSON.stringify([...MIN])); card.classList.toggle('is-min', MIN.has(key)); sync(); }); });
      head.append(b);
    }
    const sync = () => { const m = MIN.has(key); b.setAttribute('aria-expanded', String(!m)); b.setAttribute('aria-label', (m ? 'Expand ' : 'Minimise ') + label); b.title = m ? 'Expand' : 'Minimise'; };
    sync();
  }
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
      unassigned: open.filter((r) => !r.list.length), review: all.filter((r) => r.shared), delivered: all.filter((r) => r.done && r.ddate === t)
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
    // After 2 pm the unopened morning briefing shrinks to one line, so the afternoon starts with the work.
    el.classList.toggle('compact', k === 'morning' && istMins() >= 14 * 60);
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
        if (isOwner() || !me) {
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
        out.push({ id: 'fd-' + e.when + '-' + e.record + '-' + e.field, icon: /^Team/.test(e.action) ? 'user' : 'edit', tone: '', t: who + ' updated ' + (e.record || e.sheet || 'a record'), s: what.slice(0, 90) + ' · ' + agoText(e.when), go: task ? () => document.dispatchEvent(new CustomEvent('co-open-task', { detail: task.uid })) : () => dash.setParams({ tab: isOwner() ? 'access' : 'tasks' }) });
      });
      // Meetings starting within 15 minutes (connected Google Calendar).
      (CAL.events || []).forEach((ev) => { const m = (new Date(ev.start) - Date.now()) / 60000; if (m <= 15 && m > -5) out.unshift({ id: 'mtg-' + ev.id + '-' + ev.start, icon: 'video', tone: 'lime', t: (m > 0 ? 'Starts ' + untilText(ev.start) + ': ' : 'Now: ') + ev.title, s: fmtRange(ev.start, ev.end) + (ev.people.length ? ' · ' + ev.people.length + ' people' : ''), go: () => { if (ev.meet) window.open(ev.meet, '_blank', 'noopener'); else dash.setParams({ tab: 'today' }); } }); });
      if (isAdmin() && AX.pending) out.unshift({ id: 'access-' + AX.pending + '-' + t, icon: 'user', tone: 'violet', t: AX.pending + (AX.pending === 1 ? ' access request' : ' access requests') + ' waiting', s: 'Approve or reject on the Access page', go: () => dash.setParams({ tab: 'access' }) });
      NB.notes.forEach((n) => {
        if (n.reminder && n.reminder <= nowLocal && n.reminder.slice(0, 10) >= CO.addDays(t, -2) && (n.createdBy === A.user.email || (n.actions || []).some((a) => !a.done && a.email === A.user.email))) out.unshift({ id: 'rem-' + n.id + '-' + n.reminder, icon: 'bell', tone: 'bad', t: 'Reminder: ' + n.title, s: CO.istDateTime(n.reminder + ':00+05:30') + (n.followUps ? ' · ' + n.followUps.slice(0, 60) : ''), go: () => { dash.setParams({ tab: 'notes' }); NB.select(n.id); } });
        (n.actions || []).forEach((a) => { if (!a.done && a.email === A.user.email && (!a.due || a.due <= CO.addDays(t, 1))) out.push({ id: 'act-' + n.id + '-' + a.id + '-' + (a.due || ''), icon: 'check', tone: a.due && a.due < t ? 'bad' : '', t: /^as-/.test(a.id || '') ? (n.createdBy === A.user.email ? 'Your note: ' : (n.createdByName || n.createdBy).split(' ')[0] + ' assigned you: ') + n.title : a.text, s: /^as-/.test(a.id || '') ? 'Tick it off on the note when done' : 'Action item · ' + n.title + (a.due ? ' · due ' + CO.fmtDate(a.due) : ''), go: () => { dash.setParams({ tab: 'notes' }); NB.select(n.id); } }); });
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

  /* ================= Notes: quick stickies =================
     One composer: write, @tag people (the note is shared with them), assign it to teammates (each gets a tick box and a
     bell notification), set a reminder (bell + email). Who can see a note follows from that: only you, the people tagged
     or assigned, or everyone. Your own notes are edited in place; assignees tick theirs off. Same data as before. */
  const NB = (() => {
    const $n = (id) => document.getElementById(id);
    const st = { notes: [], people: [], loaded: false, loading: false, q: '', f: LS.get('co.qnf', 'all'), editing: '', busy: false };
    const me = () => (A.user ? A.user.email : '');
    const mk = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
    const norm = (x) => String(x || '').toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const nameOf2 = (email) => { const p = st.people.find((x) => x.email === email); return p && p.name ? p.name : (A.user && email === A.user.email ? A.user.name || email : email); };
    const first = (n) => String(n || '').split(' ')[0];
    /* People you can tag or assign: everyone with dashboard access, joined to their team-list name. */
    const people = () => {
      const users = st.people.map((p) => ({ name: p.name || '', email: p.email, local: norm(p.email.split('@')[0]) }));
      const used = new Set(), out = [];
      (S.team || []).filter((m) => m.status !== 'Inactive').forEach((m) => {
        const n = norm(m.name), f = n.split(' ')[0];
        const firsts = users.filter((u) => norm(u.name || u.local).split(' ')[0] === f);
        const u = users.find((x) => norm(x.name) === n || x.local === n) || (firsts.length === 1 ? firsts[0] : null);
        if (u && !used.has(u.email)) { used.add(u.email); out.push({ name: m.name, email: u.email }); }
      });
      users.forEach((u) => { if (!used.has(u.email)) out.push({ name: u.name || u.email, email: u.email }); });
      return out.filter((p) => p.email !== me()).sort((a, b) => a.name.localeCompare(b.name));
    };
    async function load(force) {
      if (A.mode !== 'auth' || !A.user || st.loading || (st.loaded && !force)) return;
      st.loading = true;
      try {
        const [n, d] = await Promise.all([callApi({ action: 'notes' }, true), st.people.length && !force ? Promise.resolve({ ok: true, people: st.people }) : callApi({ action: 'directory' }, true)]);
        if (n.ok) { st.notes = n.notes; st.loaded = true; }
        if (d.ok) st.people = d.people;
      } catch (e) { if (!(e instanceof AuthLost)) toast('Notes could not load: ' + e.message, true); }
      st.at = Date.now();
      st.loading = false;
      if (!st.editing) dash.draw('qn-board');
      dash.draw('qn-tabs'); syncControls(); dash.draw('np-list');
    }
    const open = () => { if (!$n('qn-new').firstChild) mountComposer(); if (!st.loaded || Date.now() - (st.at || 0) > 20000) load(st.loaded); };
    // Others' changes show up while Notes is open (every 30 s) and in the background (every 2 min).
    setInterval(() => { if (A.mode === 'auth' && A.user && !st.editing && !st.busy && document.visibilityState === 'visible' && curTab() === 'notes') load(true); }, 30 * 1000);
    setInterval(() => { if (A.mode === 'auth' && A.user && !st.editing && !st.busy && curTab() !== 'notes') load(true); }, 2 * 60 * 1000);

    /* ---- reading a note ---- */
    const isAssign = (a) => /^as-/.test(a.id || '');
    const assignees = (n) => (n.actions || []).filter(isAssign);
    const kindOf = (n) => (n.createdBy === me() ? 'mine' : assignees(n).some((a) => a.email === me()) ? 'assigned' : n.viaAdmin ? 'team' : 'shared');
    const textOf = (n) => [n.title && n.title !== 'Untitled note' ? n.title : '', n.body || ''].filter(Boolean).join('\n');
    const istStamp = (d) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 16);
    const remindText = (r) => { if (!r) return ''; const d = r.slice(0, 10), t = CO.today(); const hm = new Date('2000-01-01T' + r.slice(11, 16)).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); return (d === t ? 'Today' : d === CO.addDays(t, 1) ? 'Tomorrow' : CO.fmtDate(d)) + ', ' + hm; };
    const visText = (n) => {
      if (n.visibility === 'team') return 'Everyone';
      const who = new Set(); (n.mentions || []).forEach((m) => m.email && who.add(m.email)); assignees(n).forEach((a) => a.email && who.add(a.email)); (n.sharedWith || []).forEach((e) => who.add(e));
      who.delete(n.createdBy);
      if (n.visibility !== 'people' || !who.size) return 'Only ' + (n.createdBy === me() ? 'you' : first(nameOf2(n.createdBy))) + ' and Admins';
      const names = [...who].map((e) => (e === me() ? 'you' : first(nameOf2(e))));
      return (n.createdBy === me() ? 'You, ' : first(nameOf2(n.createdBy)) + ', ') + (names.length > 2 ? names.slice(0, 2).join(', ') + ' +' + (names.length - 2) : names.join(' and '));
    };
    const ago = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : CO.fmtDate(new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10)); };

    /* ---- the composer (new note and editing) ---- */
    function editor(n, done) {
      const f = mk('form', 'qn-ed'); f.autocomplete = 'off';
      const ta = mk('textarea', 'qn-ta'); ta.rows = n ? 4 : 2; ta.maxLength = 4000; ta.placeholder = 'Write a note… type @ to tag someone'; ta.setAttribute('aria-label', 'Note'); ta.value = n ? textOf(n) : '';
      const pop = mk('div', 'qn-pop'); pop.hidden = true; pop.setAttribute('role', 'listbox');
      const field = mk('div', 'qn-field'); field.append(ta, pop);
      const S2 = { assign: n ? assignees(n).map((a) => ({ name: a.assignee || nameOf2(a.email), email: a.email, done: a.done, id: a.id, doneBy: a.doneBy, doneAt: a.doneAt })) : [], reminder: n ? n.reminder || '' : '', team: n ? n.visibility === 'team' : false };
      const chips = mk('div', 'qn-chips');
      const row = mk('div', 'qn-row');
      // dropdown helper: a button with a chevron and a small panel
      const dd = (label, icon, build) => {
        const w = mk('div', 'qn-dd'), b = mk('button', 'qn-dd-btn'); b.type = 'button'; b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false');
        b.innerHTML = icon; b.append(mk('span', 'qn-dd-l', label)); const pan = mk('div', 'qn-dd-pan'); pan.hidden = true;
        b.addEventListener('click', () => { const on = pan.hidden; document.querySelectorAll('.qn-dd-pan').forEach((p) => { p.hidden = true; p.previousSibling.setAttribute('aria-expanded', 'false'); }); if (on) { pan.replaceChildren(); build(pan, () => { pan.hidden = true; b.setAttribute('aria-expanded', 'false'); }); pan.hidden = false; b.setAttribute('aria-expanded', 'true'); } });
        w.append(b, pan); w.btn = b; return w;
      };
      const ICON_USER = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M17 8v6M14 11h6"/></svg>';
      const ICON_BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/></svg>';
      const assignDd = dd('Assign', ICON_USER, (pan, close) => {
        const list = people(); if (!list.length) { pan.append(mk('p', 'qn-dd-empty', 'Nobody else has dashboard access yet.')); return; }
        list.forEach((p) => { const l = mk('label', 'qn-opt'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = S2.assign.some((a) => a.email === p.email); cb.addEventListener('change', () => { if (cb.checked) S2.assign.push({ name: p.name, email: p.email, done: false }); else S2.assign = S2.assign.filter((a) => a.email !== p.email); paint(); }); l.append(cb, CO.av(p.name), mk('span', '', p.name)); pan.append(l); });
        const ok = mk('button', 'qn-dd-done', 'Done'); ok.type = 'button'; ok.addEventListener('click', close); pan.append(ok);
      });
      const remindDd = dd('Remind', ICON_BELL, (pan, close) => {
        const now = new Date(), t = CO.today(), at = (day, hm) => day + 'T' + hm;
        const dow = new Date(t + 'T12:00:00Z').getUTCDay(), mon = CO.addDays(t, ((8 - dow) % 7) || 7);
        const opts = [['In 1 hour', istStamp(new Date(now.getTime() + 3600e3))], ['Today, 6 pm', at(t, '18:00')], ['Tomorrow, 10 am', at(CO.addDays(t, 1), '10:00')], ['Monday, 10 am', at(mon, '10:00')]].filter(([, v]) => v > istStamp(now));
        opts.forEach(([l, v]) => { const b = mk('button', 'qn-opt' + (S2.reminder === v ? ' on' : ''), l); b.type = 'button'; b.addEventListener('click', () => { S2.reminder = v; paint(); close(); }); pan.append(b); });
        const cl = mk('label', 'qn-opt qn-custom'); cl.append(mk('span', '', 'Pick a time (IST)')); const inp = mk('input', 'co-input'); inp.type = 'datetime-local'; inp.value = S2.reminder || ''; inp.min = istStamp(now); inp.addEventListener('change', () => { S2.reminder = inp.value; paint(); }); cl.append(inp); pan.append(cl);
        if (S2.reminder) { const x = mk('button', 'qn-opt qn-clear', 'No reminder'); x.type = 'button'; x.addEventListener('click', () => { S2.reminder = ''; paint(); close(); }); pan.append(x); }
      });
      const share = mk('label', 'qn-share'); const scb = document.createElement('input'); scb.type = 'checkbox'; scb.checked = S2.team; scb.addEventListener('change', () => { S2.team = scb.checked; paint(); }); share.append(scb, mk('span', '', 'Everyone can see'));
      const vis = mk('span', 'qn-vis');
      const acts = mk('div', 'qn-acts');
      const save = mk('button', 'co-btn primary qn-save', n ? 'Save' : 'Add note'); save.type = 'submit';
      if (n) {
        const cancel = mk('button', 'co-btn', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', () => done(null));
        const del = mk('button', 'icon-btn qn-del'); del.type = 'button'; del.setAttribute('aria-label', 'Delete note'); del.title = 'Delete note'; del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
        del.addEventListener('click', async () => { if (!confirm('Delete this note? It disappears for everyone it was shared with.')) return; st.busy = true; try { const r = await callApi({ action: 'noteDelete', id: n.id }); if (!r.ok) throw new Error(r.error || 'Not deleted'); st.notes = st.notes.filter((x) => x.id !== n.id); toast('Note deleted'); done(null); } catch (e) { toast(e.message, true); } st.busy = false; });
        acts.append(del, cancel);
      }
      acts.append(save);
      row.append(assignDd, remindDd, share, vis, acts);
      f.append(field, chips, row);
      // who it is tagged with, from the text
      const tagged = () => {
        const txt = ta.value, out = [], seen = new Set(), ps = people();
        ps.forEach((p) => { const full = new RegExp('@' + p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'i'); const f1 = first(p.name); const uniq = ps.filter((x) => first(x.name).toLowerCase() === f1.toLowerCase()).length === 1;
          if ((full.test(txt) || (uniq && new RegExp('@' + f1 + '(?![\\w])', 'i').test(txt))) && !seen.has(p.email)) { seen.add(p.email); out.push({ name: p.name, email: p.email }); } });
        return out;
      };
      function paint() {
        chips.replaceChildren();
        S2.assign.forEach((a) => { const c = mk('span', 'qn-chip as'); c.append(CO.av(a.name), mk('span', '', a.name)); const x = mk('button', 'qn-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remove ' + a.name); x.addEventListener('click', () => { S2.assign = S2.assign.filter((y) => y.email !== a.email); paint(); }); c.append(x); chips.append(c); });
        if (S2.reminder) { const c = mk('span', 'qn-chip rm'); c.innerHTML = ICON_BELL; c.append(mk('span', '', remindText(S2.reminder))); const x = mk('button', 'qn-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remove reminder'); x.addEventListener('click', () => { S2.reminder = ''; paint(); }); c.append(x); chips.append(c); }
        chips.hidden = !chips.childElementCount;
        assignDd.btn.querySelector('.qn-dd-l').textContent = S2.assign.length ? 'Assigned · ' + S2.assign.length : 'Assign';
        remindDd.btn.querySelector('.qn-dd-l').textContent = S2.reminder ? 'Reminder set' : 'Remind';
        const tg = tagged(), who = new Set([...tg.map((p) => p.email), ...S2.assign.map((a) => a.email)]);
        vis.textContent = S2.team ? 'Everyone with access can see this' : who.size ? 'Visible to you, ' + [...who].map((e) => first(nameOf2(e))).slice(0, 3).join(', ') + (who.size > 3 ? ' +' + (who.size - 3) : '') + ' and Admins' : 'Only you and Admins can see this';
        save.disabled = !ta.value.trim();
      }
      // @ autocomplete
      let sel = 0, match = null;
      const closePop = () => { pop.hidden = true; match = null; };
      const showPop = () => {
        const upto = ta.value.slice(0, ta.selectionStart), m = upto.match(/(^|\s)@([\w.\- ]{0,20})$/);
        if (!m) { closePop(); return; }
        const q = norm(m[2]), list = people().filter((p) => !q || norm(p.name).startsWith(q) || norm(p.name).split(' ').some((w) => w.startsWith(q))).slice(0, 6);
        if (!list.length || (m[2].endsWith(' ') && !list.some((p) => norm(p.name).startsWith(q)))) { closePop(); return; }
        match = { start: upto.length - m[2].length - 1, list }; sel = Math.min(sel, list.length - 1);
        pop.replaceChildren(); list.forEach((p, i) => { const o = mk('button', 'qn-pop-o' + (i === sel ? ' on' : '')); o.type = 'button'; o.setAttribute('role', 'option'); o.append(CO.av(p.name), mk('span', '', p.name)); o.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); }); pop.append(o); });
        pop.hidden = false;
      };
      const pick = (i) => { const p = match.list[i], v = ta.value, end = ta.selectionStart; ta.value = v.slice(0, match.start) + '@' + p.name + ' ' + v.slice(end); const c = match.start + p.name.length + 2; ta.setSelectionRange(c, c); closePop(); paint(); ta.focus(); };
      ta.addEventListener('input', () => { sel = 0; showPop(); paint(); ta.style.height = 'auto'; ta.style.height = Math.min(320, ta.scrollHeight + 2) + 'px'; });
      ta.addEventListener('keydown', (e) => {
        if (match && !pop.hidden) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + match.list.length) % match.list.length; showPop(); return; }
          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(sel); return; }
          if (e.key === 'Escape') { closePop(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey && !n) { e.preventDefault(); f.requestSubmit(); }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); f.requestSubmit(); }
        if (e.key === 'Escape' && n) done(null);
      });
      ta.addEventListener('blur', () => setTimeout(closePop, 150));
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); const txt = ta.value.trim(); if (!txt || st.busy) return;
        const lines = txt.split('\n'), title = lines[0].trim().slice(0, 160), body = lines.slice(1).join('\n').trim();
        const mentions = tagged();
        const keep = n ? (n.actions || []).filter((a) => !isAssign(a)) : [];
        const actions = keep.concat(S2.assign.map((a) => ({ id: a.id || ('as-' + a.email.split('@')[0]).slice(0, 40), text: title, assignee: a.name, email: a.email, done: !!a.done, doneBy: a.doneBy || '', doneAt: a.doneAt || '' })));
        const visibility = S2.team ? 'team' : (mentions.length || S2.assign.length || (n && (n.sharedWith || []).length)) ? 'people' : 'private';
        const note = { title, body, mentions, actions, visibility, reminder: S2.reminder, sharedWith: n ? n.sharedWith || [] : [], type: n ? n.type : 'Discussion', date: n ? n.date : CO.today(), brand: n ? n.brand : '', category: n ? n.category : '', followUps: n ? n.followUps : '', pinned: n ? !!n.pinned : false };
        st.busy = true; save.disabled = true; save.textContent = 'Saving…';
        try {
          const r = await callApi(Object.assign({ action: 'noteSave', note }, n ? { id: n.id, updatedAt: n.updatedAt } : {}));
          if (!r.ok) { if (r.error === 'stale') { toast('Someone changed this note meanwhile. Showing the latest version.', true); await load(true); done(null); st.busy = false; return; } throw new Error(r.error || 'Not saved'); }
          const saved = r.note || Object.assign({ id: r.id, createdBy: me(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), canEdit: true }, note);
          st.notes = [saved].concat(st.notes.filter((x) => x.id !== saved.id));
          const shared = new Set([...mentions.map((m) => m.email), ...S2.assign.map((a) => a.email)]);
          toast(n ? 'Note saved' : shared.size ? 'Note added and shared with ' + [...shared].map((x) => first(nameOf2(x))).join(', ') : 'Note added');
          if (!n) { ta.value = ''; S2.assign = []; S2.reminder = ''; S2.team = false; scb.checked = false; ta.style.height = ''; paint(); }
          done(saved);
        } catch (err) { toast('Not saved: ' + err.message, true); }
        st.busy = false; save.textContent = n ? 'Save' : 'Add note'; paint();
      });
      paint();
      f.focusText = () => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); };
      f.setText = (v) => { ta.value = v; ta.dispatchEvent(new Event('input')); };
      return f;
    }
    let composer = null;
    function mountComposer() { const host = $n('qn-new'); composer = editor(null, () => { flip(() => dash.draw('qn-board')); dash.draw('qn-tabs'); dash.draw('np-list'); }); host.replaceChildren(composer); }
    document.addEventListener('click', (e) => { if (!e.target.closest('.qn-dd')) document.querySelectorAll('.qn-dd-pan').forEach((p) => { p.hidden = true; p.previousSibling.setAttribute('aria-expanded', 'false'); }); });

    /* ---- the board ---- */
    const TABS = [['all', 'All'], ['mine', 'Mine'], ['shared', 'Shared with me'], ['assigned', 'Assigned to me'], ['reminders', 'Reminders'], ['team', 'Team notes']];
    const inTab = (n, t) => t === 'all' || (t === 'mine' ? n.createdBy === me() : t === 'shared' ? n.createdBy !== me() && !n.viaAdmin : t === 'assigned' ? assignees(n).some((a) => a.email === me()) : t === 'team' ? n.createdBy !== me() : !!n.reminder);
    const matches = (n) => { const q = norm(st.q); if (!q) return true; return norm([n.title, n.body, nameOf2(n.createdBy), ...(n.mentions || []).map((m) => m.name), ...assignees(n).map((a) => a.assignee)].join(' ')).includes(q); };
    dash.draw('qn-tabs', (el) => {
      el.replaceChildren();
      if (st.f === 'team' && !isAdmin()) st.f = 'all';
      TABS.filter(([k]) => k !== 'team' || isAdmin()).forEach(([k, l]) => {
        const n = st.notes.filter((x) => inTab(x, k)).length, b = mk('button', 'qn-tab' + (st.f === k ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(st.f === k));
        b.append(mk('span', '', l)); if (k !== 'all' && n) b.append(mk('span', 'qn-n', String(n)));
        b.addEventListener('click', () => { st.f = k; LS.set('co.qnf', k); dash.draw('qn-tabs'); flip(() => dash.draw('qn-board')); }); el.append(b);
      });
    });
    function card(n) {
      const c = mk('article', 'qn-note k-' + kindOf(n)); c.dataset.id = n.id;
      if (st.editing === n.id) { c.classList.add('editing'); const ed = editor(n, (saved) => { st.editing = ''; flip(() => dash.draw('qn-board')); dash.draw('qn-tabs'); dash.draw('np-list'); }); c.append(ed); setTimeout(() => ed.focusText(), 30); return c; }
      const t = mk('div', 'qn-text'); const ttl = mk('b', 'qn-title', n.title && n.title !== 'Untitled note' ? n.title : ''); if (ttl.textContent) t.append(ttl);
      if (n.body) { const bd = mk('p', 'qn-body', n.body.length > 600 ? n.body.slice(0, 600) + '…' : n.body); t.append(bd); }
      // highlight @tags
      t.querySelectorAll('b, p').forEach((x) => { const parts = x.textContent.split(/(@[A-Z][\w.]*(?: [A-Z][\w.]*)?)/g); if (parts.length > 1) { x.replaceChildren(...parts.map((s) => (/^@/.test(s) ? mk('span', 'qn-tag', s) : document.createTextNode(s)))); } });
      c.append(t);
      const as = assignees(n), other = (n.actions || []).filter((a) => !isAssign(a));
      if (as.length || other.length) {
        const ul = mk('ul', 'qn-todo');
        as.concat(other).forEach((a) => {
          const li = mk('li', a.done ? 'done' : ''), can = n.createdBy === me() || a.email === me();
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!a.done; cb.disabled = !can; cb.setAttribute('aria-label', (isAssign(a) ? a.assignee : a.text) + (a.done ? ': done' : ': open'));
          cb.addEventListener('click', (e) => e.stopPropagation());
          cb.addEventListener('change', async () => { const was = a.done; a.done = cb.checked; li.classList.toggle('done', a.done); try { const r = await callApi({ action: 'noteAction', id: n.id, actionId: a.id, done: a.done }); if (!r.ok) throw new Error(r.error || 'Not saved'); n.actions = r.actions; dash.draw('np-list'); } catch (e) { a.done = was; cb.checked = was; li.classList.toggle('done', was); toast(e.message, true); } });
          li.append(cb); if (isAssign(a)) { li.append(CO.av(a.assignee || nameOf2(a.email)), mk('span', '', (a.email === me() ? 'You' : a.assignee || nameOf2(a.email)) + (a.done ? ' · done' : ''))); } else li.append(mk('span', '', a.text + (a.assignee ? ' · ' + a.assignee : '')));
          ul.append(li);
        });
        c.append(ul);
      }
      const meta = mk('div', 'qn-meta');
      if (n.reminder) { const due = n.reminder <= istStamp(new Date()); const r = mk('span', 'qn-pill rm' + (due ? ' due' : '')); r.textContent = (due ? 'Reminder ' : '⏰ ') + remindText(n.reminder); meta.append(r); }
      meta.append(mk('span', 'qn-pill vis', visText(n)));
      if (n.viaAdmin) meta.append(mk('span', 'qn-pill adm', 'Visible to you as Admin'));
      c.append(meta);
      const ft = mk('footer', 'qn-foot'); ft.append(CO.av(nameOf2(n.createdBy)), mk('span', '', (n.createdBy === me() ? 'You' : first(nameOf2(n.createdBy))) + ' · ' + ago(n.updatedAt || n.createdAt)));
      if (n.createdBy === me()) { const e2 = mk('button', 'qn-edit', 'Edit'); e2.type = 'button'; ft.append(e2); }
      c.append(ft);
      if (n.createdBy === me() || n.canEdit) { c.tabIndex = 0; c.classList.add('can'); const go = () => { st.editing = n.id; flip(() => dash.draw('qn-board')); }; c.addEventListener('click', (e) => { if (e.target.closest('input, a')) return; go(); }); c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === c) go(); }); }
      return c;
    }
    dash.draw('qn-board', (el) => {
      el.replaceChildren();
      if (!st.loaded) { el.append(mk('p', 'qn-empty', A.mode === 'auth' ? 'Loading notes…' : 'Sign in to use notes.')); return; }
      const list = st.notes.filter((n) => inTab(n, st.f) && matches(n)).sort((a, b) => (b.pinned - a.pinned) || String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
      if (!list.length) { el.append(mk('p', 'qn-empty', st.q ? 'No notes match “' + st.q + '”.' : st.f === 'all' ? 'No notes yet. Write one above; tag someone with @ to share it with them.' : st.f === 'assigned' ? 'Nothing assigned to you.' : st.f === 'reminders' ? 'No reminders set.' : st.f === 'shared' ? 'Nobody has shared a note with you yet.' : st.f === 'team' ? 'No notes from the team yet.' : 'You have not written a note yet.')); return; }
      list.slice(0, 120).forEach((n) => el.append(card(n)));
    });
    let qT = 0; $n('qn-q').addEventListener('input', (e) => { clearTimeout(qT); qT = setTimeout(() => { st.q = e.target.value.trim(); dash.draw('qn-board'); }, 200); });

    /* Start a note from elsewhere (Meetings "Take notes"): opens Notes with the composer filled in. */
    function startNew(kind, preset) {
      dash.setParams({ tab: 'notes' });
      setTimeout(() => { if (!composer) mountComposer(); if (preset) composer.setText(preset); composer.focusText(); }, 120);
    }
    const select = (id) => { dash.setParams({ tab: 'notes' }); setTimeout(() => { const c = document.querySelector('.qn-note[data-id="' + CSS.escape(id) + '"]'); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 1600); } }, 300); };
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
    if (A.mode !== 'auth' || !isOwner()) return;
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
      u.searchParams.set('timeMin', new Date(now - 60 * 60 * 1000).toISOString()); u.searchParams.set('timeMax', new Date(+now + 14 * 864e5).toISOString());
      u.searchParams.set('singleEvents', 'true'); u.searchParams.set('orderBy', 'startTime'); u.searchParams.set('maxResults', '25');
      const res = await fetch(u.toString(), { headers: { Authorization: 'Bearer ' + CAL.token } });
      if (res.status === 401) { CAL.token = ''; sessionStorage.removeItem('co.calToken'); throw new Error('expired'); }
      if (res.status === 403) {
        // Google says which project and gives the link to switch the API on; keep only a Google Cloud link.
        let msg = ''; try { msg = ((await res.json()).error || {}).message || ''; } catch (e2) { /* no body */ }
        const m = msg.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/apis\/api\/calendar-json\.googleapis\.com\/overview\?project=\d+/);
        CAL.off = true; CAL.enableUrl = m ? m[0] : 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com';
        throw new Error(isOwner() ? 'The Google Calendar API is switched off in the Google Cloud project, so meetings cannot load. Switch it on, wait a minute, then press Try again.' : 'Meetings will show here once the admin switches on the Google Calendar API.');
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
    NB.startNew('meeting', ev.title + ' · ' + CO.fmtDate(CO.today()) + '\n' + ev.people.filter((p) => !p.self).slice(0, 8).map((p) => '@' + p.name).join(' ') + '\n');
  }

  dash.draw('cal', (el) => {
    el.replaceChildren();
    const head = document.createElement('div'); head.className = 'co-card-head';
    const hd = document.createElement('div'); const h = document.createElement('h2'); h.className = 'co-h2'; h.textContent = 'Meetings'; const n = document.createElement('p'); n.className = 'co-note'; n.textContent = 'Your Google Calendar, today and the next two days.'; hd.append(h, n); head.append(hd);
    el.append(head); collapser(el, 'cal', 'Meetings');
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
      if (isOwner()) { const a = document.createElement('a'); a.className = 'co-btn primary'; a.href = CAL.enableUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Switch on in Google Cloud'; row.append(a); }
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
    // Today and the next two days by default; later meetings (up to two weeks) behind "Show more".
    const limit = CO.addDays(CO.today(), 2), dayOf = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const near = evs.slice(1).filter((e) => dayOf(e.start) <= limit), later = evs.slice(1).filter((e) => dayOf(e.start) > limit);
    const SHOW = 4, every = near.concat(later), rest = CAL.more ? every : near.slice(0, SHOW), hiddenN = every.length - rest.length;
    const moreBtn = () => { if (!hiddenN && !CAL.more) return; const b = document.createElement('button'); b.type = 'button'; b.className = 'co-link cal-more-btn'; b.textContent = CAL.more ? 'Show fewer' : 'Show ' + hiddenN + ' more meeting' + (hiddenN === 1 ? '' : 's') + (later.length ? ' (next 2 weeks)' : ''); b.setAttribute('aria-expanded', String(!!CAL.more)); b.addEventListener('click', () => { flip(() => { CAL.more = !CAL.more; dash.draw('cal'); }); }); el.append(b); };
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
    if (CAL.more || hiddenN) moreBtn();
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
    ASH.show(perm('fasty'));
    // Admins see how many access requests are waiting as soon as they open the dashboard.
    if (isAdmin()) callApi({ action: 'ver' }).then((b) => { if (b.ok && typeof b.pending === 'number') { AX.pending = b.pending; syncControls(); } }).catch(() => {});
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
      lang: LS.get('co.ashlang', 'en-IN'), style: LS.get('co.ashstyle', 'english'), voiceOn: LS.get('co.ashvoice', '1') !== '0', confirm: null };
    /* Languages: detected from what the person says or types (script, then common words), kept for the conversation
       until they switch; the reply, the voice and the microphone all follow it. */
    const LANGS = [['en-IN', 'English', 'English'], ['hi-IN', 'हिन्दी', 'Hindi'], ['mr-IN', 'मराठी', 'Marathi'], ['bn-IN', 'বাংলা', 'Bengali'], ['ta-IN', 'தமிழ்', 'Tamil'], ['te-IN', 'తెలుగు', 'Telugu'], ['gu-IN', 'ગુજરાતી', 'Gujarati'], ['kn-IN', 'ಕನ್ನಡ', 'Kannada'], ['ml-IN', 'മലയാളം', 'Malayalam'], ['pa-IN', 'ਪੰਜਾਬੀ', 'Punjabi']];
    const HINGLISH = /\b(hai|hain|ho|ka|ke|ki|ko|kitne|kitna|kya|kyun|kyu|kaun|kab|kaise|dikhao|kholo|batao|bata|mera|mere|meri|aaj|kal|mahine|hafte|chalo|karo|kar|do|nahi|nahin|haan|bhi|aur|wala|wali|abhi|sab|kuch|pending|chahiye)\b/gi;
    const MARATHI = /(आहे|आहेत|काय|मला|तुम्ही|किती|कोण|आज|उद्या|झाले|नाही|करा|दाखवा)/;
    function detectLang(t) {
      const x = String(t || '');
      const scripts = [[/[\u0980-\u09FF]/, 'bn-IN'], [/[\u0B80-\u0BFF]/, 'ta-IN'], [/[\u0C00-\u0C7F]/, 'te-IN'], [/[\u0A80-\u0AFF]/, 'gu-IN'], [/[\u0C80-\u0CFF]/, 'kn-IN'], [/[\u0D00-\u0D7F]/, 'ml-IN'], [/[\u0A00-\u0A7F]/, 'pa-IN']];
      for (const [re, code] of scripts) if (re.test(x)) return { lang: code, style: 'native' };
      if (/[\u0900-\u097F]/.test(x)) return { lang: MARATHI.test(x) ? 'mr-IN' : 'hi-IN', style: 'native' };
      const words = x.toLowerCase().match(/[a-z]+/g) || []; if (words.length < 2) return null;
      const hi = (x.match(HINGLISH) || []).length;
      return hi >= 1 && hi / words.length >= 0.15 ? { lang: 'hi-IN', style: 'hinglish' } : { lang: 'en-IN', style: 'english' };
    }
    const replyName = () => (st.style === 'hinglish' ? 'Hinglish (Hindi in Latin script)' : (LANGS.find((l) => l[0] === st.lang) || LANGS[0])[2]);
    const setLang = (lang, style) => { if (lang === st.lang && style === st.style) return; st.lang = lang; st.style = style; LS.set('co.ashlang', lang); LS.set('co.ashstyle', style); if (typeof paintHead === 'function') paintHead(); };
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
        const all = CO.status() === 'ok' ? CO.rows() || [] : [];
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
    const langB = el('select', 'ash-lang'); langB.setAttribute('aria-label', 'Language');
    [['auto-hinglish', 'Hinglish']].concat(LANGS.map((l) => [l[0], l[1]])).forEach(([v, t]) => langB.append(new Option(t, v)));
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
      langB.value = st.style === 'hinglish' ? 'auto-hinglish' : st.lang; langB.title = 'Fasty replies and listens in ' + replyName() + '. It switches automatically when you use another language.';
      input.placeholder = st.style === 'hinglish' ? 'Kuch bhi poocho…' : st.lang === 'hi-IN' ? 'कुछ भी पूछिए…' : 'Ask anything, in any Indian language…';
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
      bubble('bot', part + (A.user && A.user.name ? ', ' + A.user.name.split(' ')[0] : '') + '! I am Fasty. Ask me about tasks, deadlines, the team or reports, or tell me where to go. Speak or type in English, Hindi, Hinglish or any Indian language, and I will reply in the same one.');
    };
    let warmAt = 0; const warm = () => { if (A.mode === 'auth' && Date.now() - warmAt > 90 * 1000) { warmAt = Date.now(); callApi({ action: 'me' }).catch(() => {}); } };
    function open() { warm(); hint.hidden = true; panel.hidden = false; fab.classList.add('on'); paintHead(); greet(); drawSugg(); mood(); setTimeout(() => input.focus(), 60); }
    function close() { panel.hidden = true; fab.classList.remove('on'); stopListening(); stopSpeaking(); }
    fab.addEventListener('click', () => (panel.hidden ? open() : close()));
    closeB.addEventListener('click', close);
    langB.addEventListener('change', () => { const v = langB.value; if (v === 'auto-hinglish') setLang('hi-IN', 'hinglish'); else setLang(v, v === 'en-IN' ? 'english' : 'native'); });
    voiceB.addEventListener('click', () => { st.voiceOn = !st.voiceOn; LS.set('co.ashvoice', st.voiceOn ? '1' : '0'); if (!st.voiceOn) stopSpeaking(); paintHead(); });
    document.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); if (panel.hidden) open(); else close(); }
      else if (e.key === 'Escape' && !panel.hidden && !document.querySelector('dialog[open]')) close();
    });
    foot.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q) { input.value = ''; ask(q, false); } });
    micB.addEventListener('click', () => (st.listening ? stopListening() : listen()));

    /* ---- listening ---- */
    function listen() { warm();
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
    const langOf = (t) => { const d = detectLang(t); return d && d.style === 'native' ? (d.lang === 'hi-IN' && st.lang === 'mr-IN' ? 'mr-IN' : d.lang) : 'en-IN'; };
    let voices = []; const loadVoices = () => { try { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch (e) { voices = []; } };
    if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
    // Same female voice character everywhere: natural speech uses Aoede in every language; the device fallback picks a female voice.
    const FEMALE = /neerja|swara|heera|kalpana|veena|lekha|aditi|raveena|aarohi|tanishaa|pallavi|shruti|dhwani|sapna|sobhana|vaani|female|zira|samantha|ava|allison|susan|serena|karen|moira|tessa|fiona|google uk english female|google हिन्दी|google hindi|google বাংলা|google தமிழ்|google తెలుగు|google ગુજરાતી|google ಕನ್ನಡ|google മലയാളം|google मराठी/i;
    const MALE = /\b(madhur|prabhat|manohar|bashkar|valluvar|mohan|niranjan|gagan|midhun|ravi|hemant|kunal|prateek|aarav|male|david|mark|guy|daniel|alex|fred|rishi)\b/i;
    const chosen = new Map();
    const pickVoice = (lang) => {
      if (chosen.has(lang) && voices.includes(chosen.get(lang))) return chosen.get(lang); // one voice per language for the whole session
      const base = lang.slice(0, 2), score = (v) => (v.lang === lang ? 40 : v.lang.startsWith(base) ? 25 : v.lang.startsWith('en') ? 5 : -100) + (FEMALE.test(v.name) ? 60 : 0) - (MALE.test(v.name) && !FEMALE.test(v.name) ? 90 : 0) + (/natural|online|neural|premium|enhanced/i.test(v.name) ? 20 : 0) + (/google/i.test(v.name) ? 6 : 0);
      const v = voices.slice().sort((a, b) => score(b) - score(a))[0] || null; if (v) chosen.set(lang, v); return v;
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
    /* Voice in parts: the first part plays the moment the answer appears (its audio comes with the answer), the rest is
       fetched in parallel while it plays, so there is no gap. If natural speech is unavailable the device voice starts at once. */
    let vtok = 0;
    const splitVoice = (t) => { const ss = String(t).split(/(?<=[.!?।])\s+/).filter(Boolean), out = []; let cur = ''; ss.forEach((x) => { const cap = out.length ? 420 : 170, j = (cur ? cur + ' ' : '') + x; if (!cur || (out.length ? j.length <= cap : cur.length < 25 && j.length <= cap)) cur = j; else { out.push(cur); cur = x; } }); if (cur) out.push(cur); return out.slice(0, 5); };
    function deviceSpeak(text, lang, my) {
      if (!window.speechSynthesis || my !== vtok) { if (my === vtok) done(); return; }
      speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); const v = pickVoice(lang); if (v) u.voice = v; u.lang = v ? v.lang : lang; u.rate = 1.02; u.pitch = 1.08;
      u.onend = () => { if (my === vtok) done(); }; u.onerror = () => { if (my === vtok) { st.speaking = false; mood(); } }; speechSynthesis.speak(u);
    }
    const playAudio = (item, my) => new Promise((resolve) => {
      if (my !== vtok) return resolve(false);
      const a = new Audio(audioUrl(item.audio, item.mime)); st.audio = a; a.preload = 'auto';
      a.onended = () => resolve(true); a.onerror = () => resolve(false);
      a.play().catch(() => resolve(false));
    });
    async function voicePlay(v) {
      stopSpeaking(true); const my = ++vtok;
      const chunks = (v.chunks || []).filter(Boolean), lang = v.lang || langOf(chunks.join(' '));
      if (!chunks.length) { st.speaking = false; mood(); return; }
      st.speaking = true; mood();
      if (v.off || !st.tts || A.mode !== 'auth') return deviceSpeak(chunks.join(' '), lang, my);
      const fetchVoice = (list) => callApi({ action: 'speak', texts: list, lang }).then((r) => (r.ok && r.items ? r.items : r.ok && r.audio ? [{ audio: r.audio, mime: r.mime }] : [])).catch(() => []);
      const first = v.a0 !== undefined ? Promise.resolve([v.a0]) : fetchVoice([chunks[0]]);
      const rest = chunks.length > 1 ? fetchVoice(chunks.slice(1)) : Promise.resolve([]);
      for (let i = 0; i < chunks.length; i++) {
        const item = i === 0 ? (await first)[0] : (await rest)[i - 1];
        if (my !== vtok) return;
        if (!item || !item.audio) return deviceSpeak(chunks.slice(i).join(' '), lang, my);
        const ok = await playAudio(item, my);
        if (my !== vtok) return;
        if (!ok) return deviceSpeak(chunks.slice(i).join(' '), lang, my);
      }
      st.audio = null; done();
    }
    function speak(text, voice) {
      if (!st.voiceOn || !text) return;
      if (voice && voice.chunks && voice.chunks.length) return voicePlay(voice);
      const t = plain(text).slice(0, 900); return voicePlay({ chunks: splitVoice(t), lang: langOf(t) });
    }
    function stopSpeaking(keep) { vtok++; if (st.audio) { st.audio.pause(); st.audio = null; } try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* ignore */ } if (!keep) { st.speaking = false; mood(); } }

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
        if (s === 'open') rs = rs.filter((r) => r.open); else if (s === 'active') rs = rs.filter((r) => !CO.CLOSED.has(r.stage)); else if (s === 'delivered' || s === 'completed') rs = rs.filter((r) => r.done); else if (s === 'shared' || s === 'pending approval') rs = rs.filter((r) => r.shared); else if (s === 'awaiting brief') rs = rs.filter((r) => r.awaiting); else if (s !== 'any') rs = rs.filter((r) => r.stage.toLowerCase() === s);
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
        const del = rs.filter((r) => r.done && r.ddate);
        return { for: lab.join(', ') || 'everyone', open_tasks: open.length, open_creatives: CO.sumQty(open), overdue: open.filter((r) => r.due === 'overdue').length, due_today: open.filter((r) => r.eta === t).length, due_tomorrow: open.filter((r) => r.eta === CO.addDays(t, 1)).length, no_eta: open.filter((r) => !r.eta).length,
          in_progress: rs.filter((r) => r.stage === 'WIP').length, to_be_planned: rs.filter((r) => r.stage === 'To be planned').length, changes_requested: rs.filter((r) => r.stage === 'Changes requested').length, under_review_by_creative_head: rs.filter((r) => r.review).length, shared_with_client: rs.filter((r) => r.shared).length, of_which_no_update: rs.filter((r) => r.stage === 'No update').length, awaiting_brief: rs.filter((r) => r.awaiting).length, on_hold: rs.filter((r) => r.stage === 'Hold').length,
          unassigned_open: open.filter((r) => !r.list.length).length, delivered_this_month_creatives: CO.sumQty(del.filter((r) => r.month === m)), delivered_same_working_days_last_month: CO.sumQty(del.filter((r) => r.ddate >= pm + '-01' && r.ddate <= pto)), working_days_so_far_this_month: CO.workdays(m + '-01', t), working_days_in_month: CO.workdays(m + '-01', CO.monthEnd(m)), oldest_overdue_days: open.filter((r) => r.due === 'overdue').reduce((x, r) => Math.max(x, CO.diffDays(r.eta, t)), 0) };
      },
      team_progress(a) {
        const P = period(a.period, a.from, a.to), rs = allRows(), t = CO.today();
        const names = new Set((S.team || []).filter((m) => m.status !== 'Inactive').map((m) => m.name)); rs.forEach((r) => { if (r.open) r.list.forEach((n) => names.add(n)); });
        const rows = [...names].map((n) => { const mine = rs.filter((r) => r.list.includes(n)), op = mine.filter((r) => r.open), dl = mine.filter((r) => r.done && r.ddate);
          return { designer: n, open: op.length, overdue: op.filter((r) => r.due === 'overdue').length, due_today: op.filter((r) => r.eta === t).length, under_review_by_creative_head: mine.filter((r) => r.review).length, shared_with_client: mine.filter((r) => r.shared).length, delivered: CO.sumQty(dl.filter((r) => r.ddate >= P.from && r.ddate <= P.to)), delivered_previous_period: CO.sumQty(dl.filter((r) => r.ddate >= P.pfrom && r.ddate <= P.pto)) }; })
          .sort((x, y) => y.open - x.open);
        const un = rs.filter((r) => r.open && !r.list.length).length;
        return { period: P.label + ' (' + P.from + ' to ' + P.to + ')', previous_period: P.pfrom + ' to ' + P.pto, designers: rows, unassigned_open_tasks: un };
      },
      delivery_report(a) {
        const P = period(a.period, a.from, a.to); let rs = allRows().filter((r) => r.done && r.ddate);
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
        if (!pageOk(tab)) return { error: 'not_allowed', detail: 'This person does not have access to ' + PAGE_NAME[tab] + '.' };
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
        if (A.mode === 'auth' && !perm('edit')) return { error: 'not_allowed', detail: 'This person has view-only access. An Editor or the Admin can change tasks.' };
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
    // Headline numbers go with every question, so simple counts need no extra round trip for a tool call.
    const snap = () => {
      try {
        const rs = CO.rows(); if (!rs) return '';
        const t = CO.today(), m = t.slice(0, 7), open = rs.filter((r) => r.open), by = new Map();
        open.forEach((r) => r.list.forEach((d) => { const o = by.get(d) || [0, 0]; o[0]++; if (r.due === 'overdue') o[1]++; by.set(d, o); }));
        const done = rs.filter((r) => r.done && r.month === m);
        return 'open ' + open.length + ', overdue ' + rs.filter((r) => r.due === 'overdue').length + ', due today ' + open.filter((r) => r.eta === t).length + ', due tomorrow ' + open.filter((r) => r.eta === CO.addDays(t, 1)).length +
          ', WIP ' + rs.filter((r) => r.stage === 'WIP').length + ', under review ' + rs.filter((r) => r.review).length + ', shared with client ' + rs.filter((r) => r.shared).length + ', unassigned open ' + open.filter((r) => !r.list.length).length +
          ', creatives completed this month ' + CO.sumQty(done) + '. Open content tasks (briefs/scripts, separate from design) by writer: ' + CT.writers().map((w) => w + ' ' + CT.of(w, rs).open.length).join(', ') + '. Open (overdue) by designer: ' + [...by].sort((a, b) => b[1][0] - a[1][0]).slice(0, 14).map(([d, o]) => d + ' ' + o[0] + (o[1] ? ' (' + o[1] + ')' : '')).join(', ');
      } catch (e) { return ''; }
    };
    const ctx = () => { const p = dash.params(); return { page: PAGE_NAME[p.tab] || 'Overview', filters: [p.src ? CO.cls(p.src) : '', p.designer, p.brand, p.type].filter(Boolean).join(', '), lang: st.lang, reply: replyName(), snap: snap() }; };
    /* Instant answers: clear, simple questions (what is overdue / due today / tomorrow, someone's open work, deliveries this
       period, "open Tasks") are answered from the data already in the browser, with no round trip to the AI. */
    const QUICK_OK = new Set(('what whats s is are the a an how many much show me list which tasks task there any kitne kitna kya hai hain ka ke ki ko mere my mera meri ' +
      'open overdue late due today tomorrow aaj kal delivered deliver deliveries this month week last mahine hafte pichle pending working on kaam go to take ' +
      'kholo dikhao chalo jao le page section tab overview home standup stand up notes note team reports report health access brands please pls batao bata do for of has have abhi now creatives right').split(' '));
    const quick = (q) => {
      const k = norm(q), toks = k.split(/\s+/).filter(Boolean);
      if (!toks.length || toks.length > 9) return null;
      const person = people().find((pp) => k.includes(norm(pp)) || norm(pp).split(' ').some((w) => w.length > 2 && new RegExp('\\b' + w + '\\b').test(k)));
      const pTok = new Set(person ? norm(person).split(' ') : []);
      // Only when every word is understood: anything more specific (a brand, a period, "why", "external"...) goes to the AI.
      if (!toks.every((t) => QUICK_OK.has(t) || pTok.has(t) || [...pTok].some((w) => w.startsWith(t) && t.length > 2))) return null;
      const nav = /\b(open|show|go|take|kholo|dikhao|chalo|jao)\b/.test(k) && /\b(overview|home|stand ?up|tasks?|notes?|team|reports?|health|access|brands?)\b/.test(k);
      const dueQ = /\b(overdue|late|due today|due tomorrow|aaj|kal)\b/.test(k);
      const delQ = /\bdeliver/.test(k);
      const personQ = person && /\b(open|pending|working|kaam|tasks?)\b/.test(k);
      if (!(nav || dueQ || delQ || personQ)) return null;
      return local(q);
    };
    // Keep the conversation short enough to send, cutting only at a question the person asked (never between a tool call and its result).
    // Older tool results are cut short before sending (the model already answered from them): smaller requests, faster replies.
    const slim = () => { let lastQ = -1; st.msgs.forEach((m, i) => { if (m.role === 'user' && m.content.some((c) => c.type === 'text')) lastQ = i; });
      return st.msgs.map((m, i) => i >= lastQ || m.role !== 'user' ? m : { role: m.role, content: m.content.map((c) => c.type === 'tool_result' && c.content.length > 400 ? Object.assign({}, c, { content: c.content.slice(0, 400) + '…' }) : c) }); };
    const trim = () => { while (st.msgs.length > 24) { st.msgs.shift(); while (st.msgs.length && !(st.msgs[0].role === 'user' && st.msgs[0].content.some((c) => c.type === 'text'))) st.msgs.shift(); } };
    async function ask(q, viaVoice) {
      if (st.busy) return;
      st.viaVoice = viaVoice; stopSpeaking(); sugg.replaceChildren();
      { const d = detectLang(q); if (d) setLang(d.lang, d.style); }
      bubble('me', q); st.busy = true; mood(); shown = null;
      const wait = bubble('bot wait'); wait.append(el('span', 'dots', '')); wait.setAttribute('aria-label', 'Fasty is thinking');
      let answer = '', voice = null;
      try {
        const fast = st.ai === false || A.mode !== 'auth' ? null : quick(q);
        if (st.ai === false || A.mode !== 'auth') answer = local(q);
        else if (fast) { answer = fast; st.msgs.push({ role: 'user', content: [{ type: 'text', text: q }] }, { role: 'assistant', content: [{ type: 'text', text: fast }] }); trim(); }
        else {
          if (window.__liveAct) window.__liveAct('click', 'Asked Fasty a question');
          st.msgs.push({ role: 'user', content: [{ type: 'text', text: q }] }); trim();
          for (let hop = 0; hop < 7; hop++) {
            // Never wait forever: after 30 seconds answer in basic mode and say why.
            const res = await Promise.race([callApi({ action: 'assist', messages: slim(), context: ctx(), voice: st.voiceOn && st.tts ? { lang: st.lang } : null }), new Promise((r) => setTimeout(() => r({ ok: false, error: 'busy', slow: true }), 20000))]);
            if (!res.ok && res.error === 'busy') { st.msgs.pop(); answer = local(q) + (res.slow ? ' (Quick answer: the AI service did not reply in 20 seconds, so I used basic mode.)' : ' (Quick answer: the AI service is busy right now, so I used basic mode.)'); break; }
            if (!res.ok) { if (res.error === 'not_configured') { st.ai = false; paintHead(); st.msgs.pop(); answer = local(q); } else answer = res.error || 'Something went wrong. Try again.'; break; }
            if (res.stop_reason === 'refusal') { st.msgs.pop(); answer = 'I can not help with that one. Ask me about tasks, the team or reports.'; break; }
            st.msgs.push({ role: 'assistant', content: res.content });
            const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim(); voice = res.voice || null;
            const calls = res.content.filter((c) => c.type === 'tool_use');
            if (res.stop_reason !== 'tool_use' || !calls.length) { answer = text || 'Done.'; break; }
            const results = [];
            wait.setAttribute('aria-label', 'Fasty is looking it up'); wait.dataset.step = calls.some((c) => c.name === 'navigate') ? 'Opening it…' : 'Looking it up…';
            for (const c of calls) {
              let out; try { out = TOOLS[c.name] ? await TOOLS[c.name](c.input || {}) : { error: 'Unknown tool ' + c.name }; } catch (e) { out = { error: String(e.message || e) }; }
              results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out).slice(0, 8000), is_error: !!(out && out.error && out.error !== 'not_allowed') });
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
      mood(); speak((spoken || shownText).trim(), voice);
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
    // On phones Fasty slides away while the page scrolls down (it would cover content) and comes back on scrolling up or stopping.
    { let lastY = scrollY, idle = 0; addEventListener('scroll', () => { if (innerWidth > 960 || !panel.hidden) return; const y = scrollY; if (y > lastY + 6) { fab.classList.add('away'); hint.hidden = true; } else if (y < lastY - 6) fab.classList.remove('away'); lastY = y; clearTimeout(idle); idle = setTimeout(() => fab.classList.remove('away'), 900); }, { passive: true }); }
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
      const out = [], admin = isOwner(), t = CO.today();
      const add = (level, title, detail, act) => out.push({ level, title, detail, act });
      // 0. "Only their own work" for someone the team list does not know: say why the dashboard is empty.
      if (A.mode === 'auth' && S.ownNoMatch) add('warn', 'You see only tasks assigned to you, and none are', 'Your name' + (A.user && A.user.name ? ' (' + A.user.name + ')' : '') + ' is not on the team list, so no task matches you. Ask an Admin to give you access to all tasks, or to add you to the team list.');
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
        if (skipped || unknown) add('warn', skipped && !unknown ? skipped + ' incomplete rows left out of the counts' : (skipped + unknown) + ' rows left out of the counts', [skipped ? skipped + ' incomplete rows are left out' : '', unknown ? unknown + ' have a status the dashboard does not recognise' : ''].filter(Boolean).join('; ') + '. Fix them in the sheets.', ['Open Data health', () => dash.setParams({ tab: 'health' })]);
        if (noEta > 20 || noDes > 20) add('info', 'Open work missing details', noEta + ' open tasks have no Design ETA and ' + noDes + ' have no designer, so they cannot count as overdue or in anyone\'s workload.', ['Open Data health', () => dash.setParams({ tab: 'health' })]);
      }
      // 4. Calculation self-check: the same numbers worked out two independent ways must agree.
      if (S.status === 'ok') {
        const all = CO.rows(true) || [], fails = [];
        const stageSum = all.reduce((n, r) => n + (r.stage ? 1 : 0), 0); if (stageSum !== all.length) fails.push('every task has a status');
        if (all.some((r) => r.open !== CODATA.OPEN_STAGES.includes(r.stage))) fails.push('open work matches the open statuses');
        if (all.some((r) => r.done && (!r.ddate || r.ddate > t || r.month !== r.ddate.slice(0, 7)))) fails.push('delivery dates are set and not in the future');
        const od1 = all.filter((r) => r.due === 'overdue').length, od2 = all.filter((r) => r.open && r.eta && r.eta < t).length; if (od1 !== od2) fails.push('overdue count (' + od1 + ' vs ' + od2 + ')');
        const m = CO.thisMonth(), d1 = CO.sumQty(all.filter((r) => r.done && r.month === m)), b = TB.sum(all, [m + '-01'], 'month', m + '-01', t).get(m + '-01');
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
      if (real === 1) tx.textContent = list.find((x) => x.level !== 'info').title; // one issue: say what it is
      const when = document.createElement('span'); when.className = 'sys-when'; when.textContent = 'Checked ' + CO.istTime(last.at);
      head.append(dot, tx, when);
      el.append(head);
      if (!list.length) return;
      const open = el.dataset.open === '1' || (el.dataset.open !== '0' && (list.some((x) => x.level === 'bad') || S.ownNoMatch));
      const more = document.createElement('span'); more.className = 'sys-more'; more.textContent = open ? 'Hide' : 'Details'; head.insertBefore(more, when);
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
