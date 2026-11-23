/* Studio (Nov 2026): the team's creative corner. Everyone makes a character (built here, or from a photo with Gemini)
   that appears as their avatar across the dashboard. The Studio page celebrates the work: a retro TV "Hall of Fame"
   that flips through this week's spotlights (Admins' awards first, then last week's stars, worked out from the
   sheets), a podium, the awards wall with cheers, the crew and a reel of fresh deliveries. A compact strip of it
   sits at the top of the Overview. Started by app.js with its helpers (window.CO_STUDIO(api)). */
var CO_STU_VER = (document.currentScript && (document.currentScript.src.match(/[?&]v=(\w+)/) || [])[1]) || '';
window.CO_STUDIO = function (api) {
  'use strict';
  const { A, S, dash, CO, post, toast, LS, isAdmin, pageOk, myDesigner, EF, renderAll } = api;
  const CH = window.CO_CHAR;
  const ST = { profiles: [], awards: [], cheers: {}, canAward: false, loaded: false, busy: false, at: 0, imgs: new Map(), ch: 0, timer: 0 };
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const btn = (t, c, fn) => { const b = el('button', c, t); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; };
  const first = (n) => String(n || '').split(' ')[0];
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SND = window.CO_SOUND;
  if (SND) {
    let tm = 0; SND.onSave((p) => { clearTimeout(tm); tm = setTimeout(() => { if (A.mode === 'auth' && A.user) post({ action: 'soundPrefs', prefs: p }).catch(() => { /* saved on this device */ }); }, 800); });
    SND.on(() => { dash.draw('studio-radio'); });
    // ask once, a little after the dashboard has loaded, never on top of a window someone is working in
    const askLater = setInterval(() => { if (!ST.prefsSynced || !A.user) return; clearInterval(askLater); if (SND.prefs().asked) return; setTimeout(function tryAsk() { if (document.querySelector('dialog[open]') || document.hidden) { setTimeout(tryAsk, 15000); return; } SND.ask('notify'); }, 12000); }, 2000);
  }
  // Studio radio: play/pause, volume, mute
  dash.draw('studio-radio', (box) => {
    if (!SND) { box.replaceChildren(); return; }
    box.replaceChildren(); const p = SND.prefs(), on = SND.music.playing;
    const b = btn('', 'stu-radio-btn' + (on ? ' on' : ''), () => SND.music.toggle()); b.setAttribute('aria-label', on ? 'Pause the Studio radio' : 'Play the Studio radio');
    b.innerHTML = on ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM13 5h3v14h-3z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>';
    const eq = el('span', 'stu-eq' + (on ? ' on' : '')); for (let i = 0; i < 4; i++) eq.append(el('i'));
    const tx = el('span', 'stu-radio-tx'); tx.append(el('b', '', 'Studio radio'), el('small', '', on ? 'Lo-fi, made live' : p.music ? 'Paused' : 'Off · press play'));
    const mute = btn('', 'stu-radio-mute', () => SND.music.volume(p.mvol > 0 ? 0 : 0.4)); mute.setAttribute('aria-label', p.mvol > 0 ? 'Mute' : 'Unmute');
    mute.innerHTML = p.mvol > 0 ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/></svg>';
    const vol = el('input', 'stu-radio-vol'); vol.type = 'range'; vol.min = 0; vol.max = 100; vol.value = Math.round(p.mvol * 100); vol.setAttribute('aria-label', 'Music volume'); vol.addEventListener('input', () => SND.music.volume(vol.value / 100));
    box.append(b, eq, tx, mute, vol);
  });
  // leaving Studio pauses the radio
  setInterval(() => { const pg = document.getElementById('studio'); if (SND && SND.music.playing && pg && pg.hidden) SND.music.pause(); }, 1000);

  /* ---------- awards: the presets and their colours ---------- */
  const TAGS = {
    'best-performer': ['Best Performer', '#ddff00', '#1e1e1e', 'For outstanding work all round'],
    'best-creative': ['Best Creative', '#685bc7', '#ffffff', 'For the creative everyone is talking about'],
    'top-contributor': ['Top Contributor', '#ff5a26', '#1e1e1e', 'For carrying the most work'],
    'rising-star': ['Rising Star', '#e86aa6', '#1e1e1e', 'For growing fast'],
    'client-favourite': ['Client Favourite', '#8fd3ff', '#1e1e1e', 'For work the client loved'],
    'speed-star': ['Speed Star', '#f5c542', '#1e1e1e', 'For quick, clean turnarounds'],
    'team-player': ['Team Player', '#2fb37a', '#1e1e1e', 'For always helping others'],
    'idea-machine': ['Idea Machine', '#c9b6ff', '#1e1e1e', 'For the best ideas'],
    custom: ['Your own award', '#f0eee9', '#1e1e1e', 'Name it yourself']
  };
  const tagOf = (k) => TAGS[k] || TAGS.custom;

  /* ---------- 3D (loaded only when someone opens Studio or the builder) ---------- */
  let D3 = null, d3p = null;
  // 3D needs a real graphics chip: software rendering (no GPU) is far too slow, so those screens keep the 2D characters
  const gl = (() => { try { const c = document.createElement('canvas'), x = window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')); if (!x) return false; const i = x.getExtension('WEBGL_debug_renderer_info'), r = i ? String(x.getParameter(i.UNMASKED_RENDERER_WEBGL)) : ''; const lose = x.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); return window.CO_FORCE3D || !/swiftshader|llvmpipe|software|basic render/i.test(r); } catch (e) { return false; } })();
  const want3d = () => {
    if (d3p) return d3p;
    d3p = (async () => { if (!gl || window.CO_NO3D) return null; try { await import('./char3d.js' + (CO_STU_VER ? '?v=' + CO_STU_VER : '')); D3 = window.CO_3D || null; if (D3) { SNAPS.clear(); renderAll(); } return D3; } catch (e) { console.warn('3D characters are off:', e && e.message); return null; } })();
    return d3p;
  };
  ST.want3d = want3d;
  const lowPower = () => window.innerWidth < 900 || (navigator.hardwareConcurrency || 8) <= 4 || reduce();
  const SNAPS = new Map();
  const snapOf = (cfg, size) => { if (!D3 || !cfg) return null; const k = JSON.stringify(cfg) + (size || 160); if (!SNAPS.has(k)) { if (SNAPS.size > 200) SNAPS.clear(); try { SNAPS.set(k, D3.snap(cfg, size || 160)); } catch (e) { SNAPS.set(k, null); } } return SNAPS.get(k); };
  const MASCOT = { style: 'vinyl', skin: '#ffe0c7', hair: 'bald', hairColor: '#b9b6b0', eyes: 'sparkle', mouth: 'grin', head: 'cap', outfit: 'hoodie', outfitColor: '#685bc7', pants: '#2b3a55', bg: '#ddff00', gear: ['trophy'], move: 'wave' };

  /* ---------- profiles and faces ---------- */
  const profOf = (name) => { if (!name) return null; const n = String(name).toLowerCase(); return ST.profiles.find((p) => p.who && p.who.toLowerCase() === n) || ST.profiles.find((p) => p.email === n) || null; };
  const myProf = () => (A.user ? ST.profiles.find((p) => p.email === A.user.email) || null : null);
  function imgData(id) {
    if (!id) return null; if (ST.imgs.has(id)) return ST.imgs.get(id);
    let v = null; try { v = localStorage.getItem('co.cimg.' + id); } catch (e) { v = null; }
    if (v) { ST.imgs.set(id, v); return v; }
    ST.imgs.set(id, null);
    post({ action: 'charImage', id }).then((b) => { ST.imgs.set(id, b.data); try { localStorage.setItem('co.cimg.' + id, b.data); } catch (e) { /* storage full */ } renderAll(); }).catch(() => { /* shown as built */ });
    return null;
  }
  // A small face for avatars everywhere (null: initials as before)
  const face = (name) => { const p = profOf(name); if (!p) return null; if (p.char && p.char.persona && window.CO_HOF) return window.CO_HOF.faceUrl(p.char); if (p.img) { const d = imgData(p.img); if (d) return d; } if (p.snap) { const d = imgData(p.snap); if (d) return d; } if (p.char && D3) { const u = snapOf(p.char, 128); if (u) return u; } return p.char ? CH.url(p.char, 'head') : null; };
  window.CO_FACE = face;
  // The full figure, as an element
  function figure(p, opts) {
    const o = opts || {}, w = el('div', 'stu-fig' + (o.cls ? ' ' + o.cls : ''));
    if (p && p.img && imgData(p.img)) { const im = new Image(); im.src = imgData(p.img); im.alt = o.label || ''; im.decoding = 'async'; w.classList.add('photo'); w.append(im); }
    else if (p && p.char && (p.snap ? imgData(p.snap) : D3)) { const u = p.snap && imgData(p.snap) ? imgData(p.snap) : snapOf(p.char, 220); const im = new Image(); im.src = u; im.alt = o.label || ''; im.decoding = 'async'; w.classList.add('photo', 'snap'); w.append(im); }
    else if (p && p.char) w.innerHTML = CH.svg(p.char, { anim: !!o.anim && !reduce(), label: o.label });
    else {
      // no character yet: a bright initials card (never a made-up face)
      const cols = [['#ddff00', '#1e1e1e'], ['#685bc7', '#fff'], ['#ff5a26', '#1e1e1e'], ['#c9b6ff', '#1e1e1e'], ['#8fd3ff', '#1e1e1e'], ['#f5c542', '#1e1e1e']];
      let h = 0; for (const ch of String(o.label || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const c = cols[h % cols.length];
      w.classList.add('ghost'); w.style.setProperty('--gc', c[0]); w.style.setProperty('--gi', c[1]);
      w.append(el('b', 'stu-ghost-i', String(o.label || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()));
    }
    return w;
  }

  /* ---------- loading ---------- */
  ST.load = async (force) => {
    if (A.mode !== 'auth' || !A.user || ST.busy || (!force && ST.at && Date.now() - ST.at < (ST.loaded ? 300000 : 60000))) return;
    ST.busy = true;
    try {
      const b = await post({ action: 'studio' }); ST.profiles = b.profiles || []; ST.awards = b.awards || []; ST.cheers = b.cheers || {}; ST.canAward = !!b.canAward; ST.loaded = true; ST.at = Date.now(); ST.err = '';
      // sound choices follow the person to every device (what they chose on the server wins)
      if (SND && b.myPrefs && b.myPrefs.asked && !ST.prefsSynced) SND.set(b.myPrefs, false);
      ST.prefsSynced = true;
    }
    catch (e) { ST.err = e.message; ST.at = Date.now(); if (/unknown_action/.test(e.message)) { ST.loaded = true; ST.old = true; } } // an older web app: the widget shows your own character until it updates
    ST.busy = false; renderAll();
  };
  setInterval(() => { if (A.mode === 'auth' && A.user && document.visibilityState === 'visible') ST.load(); }, 4000);

  /* ---------- the week, from the sheets ---------- */
  const mondayOf = (iso) => { let d = iso; while (new Date(d + 'T00:00:00Z').getUTCDay() !== 1) d = CO.addDays(d, -1); return d; };
  function weekStats(from, to) {
    const rows = (CO.rows() || []).filter((r) => r.done && r.ddate && r.ddate >= from && r.ddate <= to && r.stage !== 'Rejected');
    const by = new Map();
    rows.forEach((r) => r.list.forEach((n) => { if (EF.hidden(n)) return; const x = by.get(n) || { name: n, tasks: 0, qty: 0, video: 0, statics: 0, days: new Set(), brands: new Set() }; x.tasks++; x.qty += r.qty || 1; if (CO.VIDEO.test(r.type || '')) x.video += r.qty || 1; else x.statics += r.qty || 1; x.days.add(r.ddate); x.brands.add(r.brand); by.set(n, x); }));
    return { rows, people: [...by.values()] };
  }
  function stars() {
    const t = CO.today(), m = mondayOf(t), from = CO.addDays(m, -7), to = CO.addDays(m, -1), w = weekStats(from, to), P = w.people;
    const top = (k) => { const s = P.slice().sort((a, b) => b[k] - a[k] || b.qty - a.qty); return s[0] && s[0][k] > 0 ? s[0] : null; };
    const out = [];
    const add = (k, title, x, line) => { if (x) out.push({ key: 'wk:' + from + ':' + k, kind: 'star', title, who: x.name, line, tag: k }); };
    add('qty', 'Top shipper', top('qty'), (p) => p.qty + ' creatives delivered');
    add('video', 'Video star', top('video'), (p) => p.video + ' videos delivered');
    add('statics', 'Design machine', top('statics'), (p) => p.statics + ' statics and designs');
    const streak = P.slice().sort((a, b) => b.days.size - a.days.size || b.qty - a.qty)[0]; if (streak && streak.days.size >= 3) add('days', 'Every-day shipper', streak, (p) => 'Delivered on ' + p.days.size + ' days');
    const wide = P.slice().sort((a, b) => b.brands.size - a.brands.size || b.qty - a.qty)[0]; if (wide && wide.brands.size >= 3) add('brands', 'Many-brand hero', wide, (p) => p.brands.size + ' brands served');
    out.forEach((s) => { const p = P.find((x) => x.name === s.who); s.line = s.line(p); });
    const podium = P.slice().sort((a, b) => b.qty - a.qty || b.tasks - a.tasks).slice(0, 3);
    return { from, to, list: out, podium, total: w.rows.reduce((a, r) => a + (r.qty || 1), 0), tasks: w.rows.length };
  }
  const span = (a, b) => CO.fmtDate(a) + ' – ' + CO.fmtDate(b);

  /* ---------- cheers ---------- */
  function cheerBtn(key, small) {
    const c = ST.cheers[key] || { n: 0, mine: false }, b = btn('', 'stu-cheer' + (c.mine ? ' on' : '') + (small ? ' sm' : ''));
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11l4.5-7a1.6 1.6 0 0 1 2.8 1.5L12.5 9H18a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 16.8 20H9a2 2 0 0 1-2-2z"/><path d="M3 11h4v9H3z"/></svg>';
    const n = el('b', '', c.n ? String(c.n) : ''); b.append(n, el('span', 'stu-cheer-t', c.mine ? 'Cheered' : 'Cheer'));
    b.setAttribute('aria-pressed', String(!!c.mine)); b.title = c.mine ? 'You cheered this. Click to undo.' : 'Cheer for this';
    b.addEventListener('click', async (e) => {
      e.stopPropagation(); const cur = ST.cheers[key] || { n: 0, mine: false, who: [] }, on = !cur.mine;
      ST.cheers[key] = Object.assign({}, cur, { mine: on, n: Math.max(0, cur.n + (on ? 1 : -1)) });
      if (on) { burst(b); if (SND) SND.play('achievement'); } dash.draw('studio'); dash.draw('studio-strip');
      try { await post({ action: 'cheer', key }); } catch (err) { ST.cheers[key] = cur; toast('Could not cheer: ' + err.message, true); dash.draw('studio'); }
    });
    return b;
  }
  // a little confetti burst from an element
  function burst(from, n) {
    if (reduce()) return; const r = from.getBoundingClientRect(), cols = ['#ddff00', '#685bc7', '#ff5a26', '#e86aa6', '#8fd3ff', '#f5c542'];
    for (let i = 0; i < (n || 18); i++) {
      const s = el('i', 'stu-conf'); s.style.left = (r.left + r.width / 2) + 'px'; s.style.top = (r.top + r.height / 2) + 'px'; s.style.background = cols[i % cols.length];
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 80; s.style.setProperty('--dx', Math.cos(a) * d + 'px'); s.style.setProperty('--dy', (Math.sin(a) * d - 40) + 'px'); s.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
      document.body.append(s); setTimeout(() => s.remove(), 1100);
    }
  }

  /* ---------- the channels on the TV ---------- */
  function channels() {
    const st = stars(), list = [];
    const ok = new Set(people()); ST.awards.filter((a) => ok.has(a.who)).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 3).forEach((a) => list.push({ key: 'aw:' + a.id, kind: 'award', title: a.title, who: a.who, line: a.note || tagOf(a.tag)[3], tag: a.tag, link: a.link }));
    // only the people the Creative Head picks are featured (no automatic weekly stars)
    return { list, st };
  }
  function tvScreen(ch, i, n) {
    const scr = el('div', 'stu-scr');
    if (!ch) { scr.append(el('p', 'stu-scr-empty', 'Hall of Fame'), el('small', 'stu-scr-sub', 'Awards and last week\'s stars show here.')); return scr; }
    const t = tagOf(ch.tag), p = profOf(ch.who);
    const fig = figure(p, { anim: true, label: ch.who, cls: 'on-tv' });
    const tx = el('div', 'stu-scr-tx');
    const chip = el('span', 'stu-tag', ch.kind === 'award' ? ch.title : ch.title); chip.style.setProperty('--tag', ch.kind === 'award' ? t[1] : '#ddff00'); chip.style.setProperty('--tag-ink', ch.kind === 'award' ? t[2] : '#1e1e1e');
    tx.append(chip, el('b', 'stu-scr-name', ch.who), el('span', 'stu-scr-line', ch.line || ''));
    const row = el('div', 'stu-scr-act'); row.append(cheerBtn(ch.key)); if (ch.link) { const a = el('a', 'stu-link', 'See the creative'); a.href = ch.link; a.target = '_blank'; a.rel = 'noopener'; row.append(a); } tx.append(row);
    scr.append(fig, tx, el('span', 'stu-ch', 'CH ' + String(i + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0')));
    return scr;
  }
  function tv(compact) {
    const { list } = channels(), n = list.length; if (ST.ch >= n) ST.ch = 0;
    const box = el('div', 'stu-tv' + (compact ? ' compact' : ''));
    const shell = el('div', 'stu-shell'), bezel = el('div', 'stu-bezel'), glass = el('div', 'stu-glass');
    glass.append(tvScreen(list[ST.ch], ST.ch, n), el('i', 'stu-scan'));
    bezel.append(glass); shell.append(bezel);
    const panel = el('div', 'stu-panel');
    const knob = (dir, label) => { const k = btn('', 'stu-knob ' + dir, () => { if (!n) return; ST.ch = (ST.ch + (dir === 'next' ? 1 : n - 1)) % n; ST.flip = true; updateTV(); restart(); }); k.setAttribute('aria-label', label); return k; };
    const vents = el('span', 'stu-vents'); for (let i = 0; i < 4; i++) vents.append(el('i'));
    panel.append(vents, el('span', 'stu-led' + (n ? ' on' : '')), knob('prev', 'Previous spotlight'), knob('next', 'Next spotlight'));
    shell.append(panel); box.append(shell);
    if (ST.flip) { glass.classList.add('flip'); ST.flip = false; }
    return box;
  }
  // the spotlight on the 3D desk (kept between redraws; only its figure and screen change)
  function spotCard() {
    const { list } = channels(), n = list.length; if (ST.ch >= n) ST.ch = 0; const c = list[ST.ch];
    if (!c) return { key: 'none', card: null, cfg: null };
    const p = profOf(c.who), tg = tagOf(c.tag), cfg = p && p.char ? Object.assign({}, p.char) : Object.assign({}, MASCOT);
    const card = { i: ST.ch, n, title: c.title, who: c.who, line: c.line, color: c.kind === 'award' ? tg[1] : '#1e1e1e', ink: c.kind === 'award' ? tg[2] : '#ddff00', fx: [{ tag: c.kind === 'award' ? c.tag : 'star' }], move: (p && p.char && p.char.move) || (c.kind === 'award' ? 'victory' : 'disco') };
    return { key: c.key + JSON.stringify(cfg) + (c.line || ''), card, cfg };
  }
  function updateTV(force) {
    if (ST.stage) { const sc = spotCard(); if (force || sc.key !== ST.spotKey) { ST.spotKey = sc.key; ST.stage.spot(sc.card, sc.cfg); } }
    else { const old = document.querySelector('.stu-stage .stu-tv'); if (old) old.replaceWith(tv(false)); else dash.draw('studio'); }
    dash.draw('studio-strip'); dash.draw('hof');
  }
  function restart() { clearInterval(ST.timer); ST.timer = setInterval(() => { if (document.visibilityState !== 'visible' || reduce()) return; const n = channels().list.length; if (n < 2) return; if (document.querySelector('.stu-tv:hover, .stu-3dstage:hover')) return; ST.ch = (ST.ch + 1) % n; ST.flip = true; updateTV(); }, 8000); }
  restart();

  /* ---------- Studio page ---------- */
  const people = () => (S.team || []).filter((m) => m.status !== 'Inactive' && !EF.hidden(m.name) && !/creative head/i.test(m.role || '') && !/^anmol\b/i.test(m.name)).map((m) => m.name).sort((a, b) => a.localeCompare(b));
  dash.draw('studio', (box) => {
    if (A.mode !== 'auth' || !A.user) { box.replaceChildren(); return; }
    want3d();
    if (!ST.loaded) { box.replaceChildren(el('p', 'co-note', ST.err ? 'Could not load the Studio: ' + ST.err : 'Opening the Studio…')); ST.load(); return; }
    if (CO.notReady(box, 'box')) return;
    box.replaceChildren();
    const { st } = channels(), t = CO.today(), wk = weekStats(mondayOf(t), t);
    // hero: grid paper, the TV, sticky notes with the week in numbers, a few props
    const hero = el('section', 'stu-hero');
    const notes = [
      ['ctrl + s', wk.rows.reduce((a, r) => a + (r.qty || 1), 0) + ' creatives shipped this week', '#f5e663', -6],
      ['ctrl + z', (CO.rows() || []).filter((r) => r.open && r.due === 'overdue').length + ' late tasks to rescue', '#685bc7', 5],
      ['last week', st.total + ' creatives · ' + st.tasks + ' tasks', '#e86aa6', 4],
      ['crew', ST.profiles.filter((p) => p.char || p.img).length + ' of ' + people().length + ' made their character', '#8fd3ff', -4]
    ];
    const heroL = el('div', 'stu-hero-tx');
    const h = el('h2', 'stu-title'); h.innerHTML = '<span>Hall of</span> <em>fame</em>';
    heroL.append(h, el('p', 'stu-lead', 'Awards from the Creative Head and last week\'s stars, straight from the sheets. Turn the knobs to switch channel; cheer for anyone.'));
    const acts = el('div', 'stu-hero-acts');
    acts.append(btn(myProf() && (myProf().char || myProf().img) ? 'Edit my character' : 'Make my character', 'co-btn primary', openBuilder));
    if (ST.canAward) acts.append(btn('Give an award', 'co-btn', () => openAward()));
    heroL.append(acts);
    const radio = el('div', 'stu-radio'); radio.dataset.draw = 'studio-radio'; heroL.append(radio); setTimeout(() => dash.draw('studio-radio'), 0);
    const stage = el('div', 'stu-stage');
    want3d();
    if (D3) {
      if (!ST.stageEl) {
        ST.stageEl = el('div', 'stu-3dstage'); ST.stageEl.setAttribute('role', 'img'); ST.stageEl.setAttribute('aria-label', 'Hall of Fame: a 3D desk with a retro computer showing the spotlight, and the person dancing beside it. Click the knobs to change channel, or the person to change their move.');
        ST.stage = D3.stage(ST.stageEl, { onKnob: (dir) => { const n = channels().list.length; if (!n) return; ST.ch = (ST.ch + (dir === 'next' ? 1 : n - 1)) % n; updateTV(); restart(); if (SND) SND.play('task'); }, onMove: () => {} });
        ST.spotKey = '';
      }
      stage.classList.add('is-3d'); stage.append(ST.stageEl);
      const kn = el('div', 'stu-3dknobs'); kn.append(btn('Previous', 'co-btn sm', () => { const n = channels().list.length; if (!n) return; ST.ch = (ST.ch + n - 1) % n; updateTV(); restart(); }), btn('Next spotlight', 'co-btn sm', () => { const n = channels().list.length; if (!n) return; ST.ch = (ST.ch + 1) % n; updateTV(); restart(); }), cheerBtn((channels().list[ST.ch] || {}).key || 'none', true));
      stage.append(kn);
      if (ST.stage) { const sc = spotCard(); if (sc.key !== ST.spotKey) { ST.spotKey = sc.key; ST.stage.spot(sc.card, sc.cfg); } }
    } else stage.append(tv(false));
    notes.forEach(([k, v, c, r], i) => { const n = el('div', 'stu-note n' + i); n.style.setProperty('--nc', c); n.style.setProperty('--rot', r + 'deg'); n.append(el('small', '', k), el('b', '', v)); stage.append(n); });
    const cal = el('div', 'stu-cal'); const d = new Date(); cal.append(el('small', '', d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' })), el('b', '', d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' }))); stage.append(cal, el('i', 'stu-mug'));
    hero.append(heroL, stage); box.append(hero);

    // podium: last week by creatives
    const pod = el('section', 'stu-sec stu-podium-sec');
    const ph = el('div', 'stu-sec-h'); ph.append(el('h3', '', 'Last week\'s podium'), el('p', 'co-note', span(st.from, st.to) + ' · by creatives delivered (a shared task counts for each person).')); pod.append(ph);
    if (!st.podium.length) pod.append(el('p', 'stu-empty', 'Nothing was delivered last week yet.'));
    else {
      const pd = el('div', 'stu-podium'); const order = [1, 0, 2];
      order.forEach((i) => { const x = st.podium[i]; if (!x) return; const c = el('div', 'stu-pod p' + (i + 1)); c.append(figure(profOf(x.name), { anim: i === 0, label: x.name })); const blk = el('div', 'stu-blk'); blk.append(el('span', 'stu-rank', String(i + 1)), el('b', '', first(x.name)), el('small', '', x.qty + ' creatives · ' + x.tasks + ' tasks')); c.append(blk); pd.append(c); });
      pod.append(pd);
    }
    // awards wall
    const aw = el('section', 'stu-sec');
    const ah = el('div', 'stu-sec-h'); ah.append(el('h3', '', 'Awards'), el('p', 'co-note', ST.awards.length ? 'Given by the Creative Head. Cheer to say well done.' : 'No awards on the wall yet.')); aw.append(ah);
    const wall = el('div', 'stu-wall');
    if (ST.canAward) { const add = btn('', 'stu-swatch add', () => openAward()); add.append(el('span', 'stu-plus', '+'), el('b', '', 'Give an award'), el('small', '', 'Pick a person and a tag')); wall.append(add); }
    ST.awards.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).forEach((a, i) => {
      const tg = tagOf(a.tag), c = el('article', 'stu-swatch'); c.style.setProperty('--tag', tg[1]); c.style.setProperty('--tag-ink', tg[2]);
      const top = el('div', 'stu-sw-top'); top.append(el('small', 'stu-sw-brand', 'AWARD'), figure(profOf(a.who), { label: a.who, cls: 'mini' }));
      const code = el('span', 'stu-sw-code', 'CO ' + String(a.at || '').slice(2, 10).replace(/-/g, '') + '-' + String(i + 1).padStart(2, '0'));
      const bot = el('div', 'stu-sw-bot'); bot.append(code, el('b', 'stu-sw-title', a.title), el('span', 'stu-sw-who', a.who));
      if (a.note) bot.append(el('p', 'stu-sw-note', a.note));
      const row = el('div', 'stu-sw-act'); row.append(cheerBtn('aw:' + a.id, true));
      if (a.link) { const l = el('a', 'stu-link', 'Creative'); l.href = a.link; l.target = '_blank'; l.rel = 'noopener'; row.append(l); }
      if (ST.canAward) { row.append(btn('Edit', 'co-link', () => openAward(a))); }
      bot.append(row); c.append(top, bot); wall.append(c);
    });
    aw.append(wall);
    const two = el('div', 'stu-two'); two.append(pod, aw); box.append(two);

    // the crew
    const crew = el('section', 'stu-sec');
    const chh = el('div', 'stu-sec-h'); chh.append(el('h3', '', 'The crew'), el('p', 'co-note', 'Everyone\'s character. Hover to say hi; yours has an Edit button.')); crew.append(chh);
    const grid = el('div', 'stu-crew'), me = myDesigner();
    const wkBy = new Map(wk.people.map((x) => [x.name, x]));
    people().forEach((n) => {
      const p = profOf(n), mine = n === me, c = el('article', 'stu-mate' + (mine ? ' me' : ''));
      if (D3 && p && p.char && !p.img && !lowPower()) {
        if (!ST.crew) ST.crew = D3.crew(document.getElementById('studio') || box, () => { const t = document.querySelector('.top'); return t ? Math.max(0, t.getBoundingClientRect().bottom) : 0; });
        ST.slots = ST.slots || new Map();
        const fxl = ST.awards.filter((a) => a.who === n).map((a) => ({ tag: a.tag })), key = JSON.stringify(p.char) + JSON.stringify(fxl);
        let sl = ST.slots.get(n); if (!sl || sl.key !== key || !sl.el.isConnected && sl.gone) { const sel = el('div', 'stu-fig stu-3dslot'); sel.setAttribute('role', 'img'); sel.setAttribute('aria-label', n + '\'s character. Hover to see their move, click for another.'); ST.crew.add(sel, p.char, { fx: fxl }); sl = { el: sel, key }; ST.slots.set(n, sl); }
        c.append(sl.el);
      } else c.append(figure(p, { anim: true, label: n }));
      const tx = el('div', 'stu-mate-tx'); tx.append(el('b', '', n), el('small', '', String(EF.role(n) || '').replace(/\s*\(not shown\)\s*/i, '') || 'Team'));
      if (p && p.tagline) tx.append(el('q', 'stu-tagline', p.tagline));
      const x = wkBy.get(n), meta = el('div', 'stu-mate-meta'); meta.append(el('span', '', x ? x.qty + ' this week' : 'Warming up'));
      const badges = ST.awards.filter((a) => a.who === n); badges.slice(0, 3).forEach((a) => { const tg = tagOf(a.tag), s = el('span', 'stu-badge', a.title); s.style.setProperty('--tag', tg[1]); s.style.setProperty('--tag-ink', tg[2]); meta.append(s); });
      tx.append(meta); c.append(tx);
      if (mine) c.append(btn(p && (p.char || p.img) ? 'Edit' : 'Make yours', 'co-btn sm primary stu-mate-edit', openBuilder));
      else if (!p) c.append(el('span', 'stu-mate-wait', 'Character coming soon'));
      grid.append(c);
    });
    crew.append(grid); box.append(crew);

    // fresh off the press: deliveries in the last 7 days
    const fresh = (CO.rows() || []).filter((r) => r.done && r.ddate && r.ddate >= CO.addDays(t, -7) && r.ddate <= t).sort((a, b) => b.ddate.localeCompare(a.ddate)).slice(0, 24);
    if (fresh.length) {
      const fr = el('section', 'stu-sec stu-fresh');
      const fh = el('div', 'stu-sec-h'); fh.append(el('h3', '', 'Fresh off the press'), el('p', 'co-note', 'Delivered in the last 7 days. Hover to pause.')); fr.append(fh);
      const lane = el('div', 'stu-lane'), track = el('div', 'stu-track');
      const card = (r) => { const c = el(r.link ? 'a' : 'div', 'stu-print'); if (r.link) { c.href = r.link; c.target = '_blank'; c.rel = 'noopener'; } const k = el('span', 'stu-print-k', r.type || 'Creative'); c.append(k, el('b', '', r.brand), el('span', 'stu-print-t', CO.topicText(r).slice(0, 60))); const w = el('span', 'stu-print-w'); (r.list || []).slice(0, 2).forEach((n) => w.append(CO.av(n))); w.append(el('small', '', (r.list || []).map(first).join(' + ') + ' · ' + (r.ddate === t ? 'today' : CO.fmtDate(r.ddate)))); c.append(w); return c; };
      fresh.forEach((r) => track.append(card(r))); fresh.forEach((r) => { const c = card(r); c.setAttribute('aria-hidden', 'true'); c.tabIndex = -1; track.append(c); });
      track.style.setProperty('--dur', Math.max(30, fresh.length * 5) + 's');
      lane.append(track); fr.append(lane); box.append(fr);
    }
  });

  /* ---------- Hall of Fame widget (top bar, next to the clock) ----------
     A tiny animated character, no box around it: whoever is being celebrated (awards first, then last week's stars),
     rotating every few seconds. Click it for the details, a cheer, your own character and (Admins) awards. */
  const HOF = { i: 0, el: null, fig: null, tx: null, view: null, key: '', timer: 0, pop: null };
  function hofList() {
    const { list } = channels(); if (list.length) return list;
    const me = myDesigner() || (A.user && A.user.name) || 'You', p = myProf();
    return [{ key: 'hi', kind: 'hi', title: p && (p.char || p.img) ? 'Hall of Fame' : 'Make your character', who: me, line: p && (p.char || p.img) ? 'Awards and weekly stars show up here.' : 'Click to build your 3D character.', tag: 'star' }];
  }
  function hofItem() { const L = hofList(); if (HOF.i >= L.length) HOF.i = 0; return { c: L[HOF.i], n: L.length }; }
  function hofPaint(anim) {
    if (!HOF.el) return;
    const { c, n } = hofItem(), p = profOf(c.who) || (c.kind === 'hi' ? myProf() : null), tg = tagOf(c.tag);
    const color = c.kind === 'award' ? tg[1] : '#ddff00', move = (p && p.char && p.char.move) || (c.kind === 'award' ? 'victory' : c.kind === 'hi' ? 'wave' : 'disco');
    const cfg = p && p.char ? p.char : MASCOT, fxl = c.kind === 'award' ? [{ tag: c.tag }] : [];
    const key = c.key + '|' + JSON.stringify(cfg) + (p && p.img ? p.img : '') + (D3 ? '3d' : '');
    HOF.el.style.setProperty('--hc', color); HOF.el.classList.toggle('is-award', c.kind === 'award');
    HOF.el.setAttribute('aria-label', 'Hall of Fame: ' + (c.kind === 'hi' ? c.title : c.title + ', ' + c.who) + '. Click for details.');
    if (key !== HOF.key) {
      HOF.key = key;
      if (anim && !reduce()) { HOF.el.classList.remove('swap'); void HOF.el.offsetWidth; HOF.el.classList.add('swap'); }
      const photo = p && p.img && imgData(p.img);
      if (D3 && !photo) { if (!HOF.view) { HOF.fig.replaceChildren(); HOF.view = D3.view(HOF.fig, cfg, { mini: true, move, fx: fxl }); } else HOF.view.show(cfg, move, fxl); }
      else { if (HOF.view) { HOF.view.dispose(); HOF.view = null; } HOF.fig.replaceChildren(); if (photo) { const im = new Image(); im.src = photo; im.alt = ''; HOF.fig.append(im); HOF.fig.classList.add('pic'); } else { HOF.fig.classList.remove('pic'); const snapPic = p && p.snap && imgData(p.snap); if (snapPic) { const im = new Image(); im.src = snapPic; im.alt = ''; HOF.fig.append(im); HOF.fig.classList.add('pic'); } else HOF.fig.innerHTML = CH.svg(Object.assign({}, cfg, { gear: [] }), { anim: !reduce(), noBg: true, label: c.who }); } }
    }
    HOF.tag.textContent = c.title; HOF.name.textContent = c.kind === 'hi' ? first(c.who) === 'You' ? 'You' : first(c.who) : c.who;
    HOF.dots.replaceChildren(); if (n > 1) for (let k = 0; k < Math.min(n, 6); k++) HOF.dots.append(el('i', k === HOF.i % 6 ? 'on' : ''));
    if (HOF.pop && HOF.pop.isConnected) hofPopPaint();
  }
  function hofNext(d) { const n = hofList().length; if (n < 2) return; HOF.i = (HOF.i + (d || 1) + n) % n; hofPaint(true); }
  dash.draw('hof', (box) => {
    if (A.mode !== 'auth' || !A.user) { box.replaceChildren(); HOF.el = null; if (HOF.view) { HOF.view.dispose(); HOF.view = null; } HOF.key = ''; return; }
    if (!ST.loaded) ST.load();
    if (!HOF.el) {
      HOF.el = el('button', 'hof-w'); HOF.el.type = 'button';
      HOF.fig = el('span', 'hof-fig'); const sp = el('span', 'hof-sp'); for (let k = 0; k < 4; k++) sp.append(el('i'));
      const tx = el('span', 'hof-tx'); HOF.tag = el('small', 'hof-tag'); HOF.name = el('b', 'hof-name'); HOF.dots = el('span', 'hof-dots'); tx.append(HOF.tag, HOF.name, HOF.dots);
      HOF.el.append(sp, HOF.fig, tx);
      HOF.el.addEventListener('click', (e) => { e.stopPropagation(); hofPopToggle(); });
      HOF.el.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > 10) { e.preventDefault(); hofNext(e.deltaY > 0 ? 1 : -1); } }, { passive: false });
      clearInterval(HOF.timer); HOF.timer = setInterval(() => { if (document.hidden || reduce() || (HOF.pop && HOF.pop.isConnected) || (HOF.el && HOF.el.matches(':hover'))) return; hofNext(1); }, 6500);
      // the 3D figure loads quietly a few seconds after the dashboard opens
    }
    if (HOF.el.parentElement !== box) box.replaceChildren(HOF.el);
    hofPaint(false);
  });
  // details: a small popover under the widget
  function hofPopToggle() { if (HOF.pop && HOF.pop.isConnected) { hofPopClose(); return; } HOF.pop = el('div', 'hof-pop'); HOF.pop.setAttribute('role', 'dialog'); HOF.pop.setAttribute('aria-label', 'Hall of Fame'); document.body.append(HOF.pop); hofPopPaint(); requestAnimationFrame(() => HOF.pop && HOF.pop.classList.add('in')); }
  function hofPopClose() { if (HOF.popView) { HOF.popView.dispose(); HOF.popView = null; } if (HOF.pop) HOF.pop.remove(); HOF.pop = null; }
  document.addEventListener('click', (e) => { if (HOF.pop && !HOF.pop.contains(e.target) && !e.target.closest('.hof-w') && !e.target.closest('dialog')) hofPopClose(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && HOF.pop) hofPopClose(); });
  function hofPopPaint() {
    const pop = HOF.pop; if (!pop) return;
    const r = HOF.el.getBoundingClientRect(); pop.style.top = (r.bottom + 10) + 'px'; pop.style.left = Math.max(12, Math.min(window.innerWidth - 332, r.left + r.width / 2 - 160)) + 'px';
    const { c, n } = hofItem(), p = profOf(c.who) || (c.kind === 'hi' ? myProf() : null), tg = tagOf(c.tag), cfg = p && p.char ? p.char : MASCOT, move = (p && p.char && p.char.move) || (c.kind === 'award' ? 'victory' : 'wave');
    if (!HOF.popFig) HOF.popFig = el('div', 'hof-pop-fig');
    pop.replaceChildren();
    const photo = p && p.img && imgData(p.img);
    if (D3 && !photo) { if (!HOF.popView || !HOF.popFig.isConnected) { if (HOF.popView) HOF.popView.dispose(); HOF.popFig.replaceChildren(); HOF.popView = null; } }
    pop.append(HOF.popFig);
    if (D3 && !photo) { if (!HOF.popView) HOF.popView = D3.view(HOF.popFig, cfg, { move, fx: c.kind === 'award' ? [{ tag: c.tag }] : [], props: true }); else HOF.popView.show(cfg, move, c.kind === 'award' ? [{ tag: c.tag }] : []); }
    else { if (HOF.popView) { HOF.popView.dispose(); HOF.popView = null; } HOF.popFig.replaceChildren(figure(p || { char: MASCOT }, { anim: true, label: c.who })); }
    const tx = el('div', 'hof-pop-tx');
    const chip = el('span', 'stu-tag', c.title); chip.style.setProperty('--tag', c.kind === 'award' ? tg[1] : '#ddff00'); chip.style.setProperty('--tag-ink', c.kind === 'award' ? tg[2] : '#1e1e1e');
    tx.append(chip, el('b', 'hof-pop-name', c.kind === 'hi' ? (p && (p.char || p.img) ? 'Nothing to celebrate yet' : 'Make your character') : c.who), el('p', 'hof-pop-line', c.line || ''));
    const row = el('div', 'hof-pop-row');
    if (c.kind !== 'hi') row.append(cheerBtn(c.key, true));
    if (c.link) { const a = el('a', 'stu-link', 'See the creative'); a.href = c.link; a.target = '_blank'; a.rel = 'noopener'; row.append(a); }
    if (n > 1) { const nav = el('span', 'hof-pop-nav'); const pv = btn('‹', 'hof-arrow', () => hofNext(-1)); pv.setAttribute('aria-label', 'Previous'); const nx = btn('›', 'hof-arrow', () => hofNext(1)); nx.setAttribute('aria-label', 'Next'); nav.append(pv, el('small', '', (HOF.i + 1) + ' of ' + n), nx); row.append(nav); }
    tx.append(row);
    const foot = el('div', 'hof-pop-foot');
    const mine = myProf();
    foot.append(btn(mine && (mine.char || mine.img) ? 'Edit my character' : 'Make my character', 'co-btn sm primary', () => { hofPopClose(); openBuilder(); }));
    if (ST.canAward) foot.append(btn('Give an award', 'co-btn sm', () => { hofPopClose(); openAward(); }));
    foot.append(btn('Hall of Fame', 'co-btn sm ghost', () => { hofPopClose(); dash.setParams({ tab: 'studio' }); }));
    if (ST.old) foot.append(el('p', 'co-note hof-old', 'The web app is updating; awards appear in a few minutes.'));
    pop.append(tx, foot);
  }
  window.addEventListener('resize', () => { if (HOF.pop) hofPopPaint(); });

  /* ---------- Overview strip ---------- */
  dash.draw('studio-strip', (box) => {
    const off = (v) => { box.classList.toggle('off', v); if (v) box.replaceChildren(); return v; };
    if (off(!(A.mode === 'auth' && A.user && pageOk('studio')))) return;
    if (!ST.loaded) { ST.load(); off(true); return; }
    if (CO.status && CO.status() !== 'ok') return;
    off(false); box.replaceChildren();
    const { list } = channels();
    const tx = el('div', 'stu-strip-tx'); tx.append(el('small', '', 'Studio · Hall of Fame'), el('b', '', list.length ? list.length + (list.length === 1 ? ' spotlight' : ' spotlights') + ' this week' : 'Make your character'), el('span', 'co-note', list.length ? 'Awards and last week\'s stars. Cheer for your team.' : 'Build your clay character and see the crew.'));
    const faces = el('div', 'stu-strip-faces');
    list.slice(0, 5).forEach((c) => { const f = el('span', 'stu-strip-face'); f.append(figure(profOf(c.who), { label: c.who, cls: 'mini' })); const tg = tagOf(c.tag); const s = el('small', 'stu-badge', c.title); s.style.setProperty('--tag', c.kind === 'award' ? tg[1] : '#ddff00'); s.style.setProperty('--tag-ink', c.kind === 'award' ? tg[2] : '#1e1e1e'); f.append(s); f.title = c.who + ': ' + c.title; faces.append(f); });
    const go = btn('Open Studio', 'co-btn primary', () => dash.setParams({ tab: 'studio' }));
    box.append(tv(true), tx, faces, go);
  });

  /* ---------- character builder ---------- */
  const STYLES = [['clay', 'Clay', 'Soft and matte, like stop-motion'], ['vinyl', 'Vinyl toy', 'Glossy designer-toy shine'], ['plush', 'Plush', 'Soft, fuzzy and huggable'], ['toon', 'Toon', 'Bold outlines, Saturday-morning cartoon'], ['blocky', 'Blocky', 'Chunky voxel-game shapes'], ['bean', 'Bean', 'Round party-game bean']];
  const PANTS = ['#2b3a55', '#1e1e1e', '#3a6fb0', '#d9d1c2', '#6b4423', '#2fb37a', '#685bc7', '#ff5a26'];
  const SHOES = ['#f0eee9', '#1e1e1e', '#ff5a26', '#ddff00', '#685bc7', '#e86aa6', '#8fd3ff', '#f5c542'];
  const BT = [['look', 'Look'], ['face', 'Face'], ['hair', 'Hair'], ['style', 'Outfit'], ['gear', 'Gear'], ['moves', 'Moves'], ['scene', 'Colours'], ['photo', 'From a photo']];
  let B = null;
  function openBuilder() {
    const p = myProf(), role = EF.role(myDesigner() || '') || '';
    const base = p && p.char ? p.char : CH.random(role);
    B = { char: Object.assign({ style: 'clay', move: 'wave', pants: '#2b3a55', shoes: '#f0eee9', gloves: 'none' }, CH.norm(base), base.style ? { style: base.style } : {}, base.move ? { move: base.move } : {}), image: p && p.img ? imgData(p.img) : null, imgId: p && p.img || '', useImg: !!(p && p.img), tab: 'look', tagline: p ? p.tagline : '', role, photoBusy: false, made: null };
    ['pants', 'shoes', 'gloves'].forEach((k) => { if (base[k]) B.char[k] = base[k]; });
    let d = document.getElementById('stu-builder');
    if (!d) { d = el('dialog', 'co-dialog stu-dlg'); d.id = 'stu-builder'; d.setAttribute('aria-label', 'Make your character'); document.body.append(d); d.addEventListener('close', () => { if (B && B.view) B.view.dispose(); B = null; d.replaceChildren(); }); }
    d.replaceChildren(); paintBuilder(); d.showModal();
    want3d().then(() => { if (B) { B.tab = B.tab || 'look'; paintPreview(); paintControls(); } });
  }
  function paintBuilder() {
    const d = document.getElementById('stu-builder'); if (!d || !B) return;
    const head = el('div', 'stu-dlg-h'); head.append(el('h2', '', 'Make your character')); const x = btn('', 'stu-x', () => d.close()); x.setAttribute('aria-label', 'Close'); x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'; head.append(x);
    const body = el('div', 'stu-dlg-b');
    const pv = el('div', 'stu-pv');
    B.figHost = el('div', 'stu-fig big'); B.actHost = el('div', 'stu-pv-act');
    const tl = el('input', 'co-input stu-tl'); tl.placeholder = 'Your tagline (e.g. "Kerning is my cardio")'; tl.maxLength = 80; tl.value = B.tagline || ''; tl.setAttribute('aria-label', 'Tagline'); tl.addEventListener('input', () => { if (B) B.tagline = tl.value; });
    B.hint = el('p', 'co-note stu-pv-hint', '');
    pv.append(B.figHost, B.hint, B.actHost, tl);
    B.ctlHost = el('div', 'stu-ctl');
    body.append(pv, B.ctlHost);
    const foot = el('div', 'stu-dlg-f');
    const save = btn('Save my character', 'co-btn primary', async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Saving…';
      try {
        const payload = { action: 'profileSave', who: myDesigner() || A.user.name || '', char: B.char, tagline: B.tagline || '' };
        if (B.useImg && B.made) payload.image = B.made; else if (!B.useImg && B.imgId) payload.image = 'remove';
        if (D3) { try { payload.snap = D3.snap(B.char, 256); } catch (er) { /* the 2D picture is used */ } }
        const r = await post(payload);
        const i = ST.profiles.findIndex((y) => y.email === A.user.email); const np = Object.assign({ email: A.user.email }, r.profile);
        const keep = (id, data) => { if (id && data) { ST.imgs.set(id, data); try { localStorage.setItem('co.cimg.' + id, data); } catch (er) { /* full */ } } };
        if (B.useImg && B.made) keep(np.img, B.made); if (payload.snap) keep(np.snap, payload.snap);
        if (i >= 0) ST.profiles[i] = np; else ST.profiles.push(np);
        if (ST.slots) ST.slots.delete(myDesigner()); ST.spotKey = '';
        burst(b, 28); if (SND) SND.play('achievement'); toast('Character saved. Say hi to the new you!'); document.getElementById('stu-builder').close(); renderAll();
      } catch (err) { b.disabled = false; b.textContent = 'Save my character'; toast('Could not save: ' + err.message, true); }
    });
    foot.append(el('span', 'co-note', 'Your character is your avatar everywhere on the dashboard.'), btn('Cancel', 'co-btn ghost', () => d.close()), save);
    d.append(head, body, foot);
    paintPreview(); paintControls();
  }
  function paintPreview() {
    if (!B || !B.figHost) return;
    const host = B.figHost, photo = B.useImg && B.image;
    host.classList.toggle('photo', !!photo); host.classList.toggle('is-3d', !photo && !!D3);
    if (photo) { if (B.view) { B.view.dispose(); B.view = null; } host.replaceChildren(); const im = new Image(); im.src = B.image; im.alt = 'Your character'; host.append(im); }
    else if (D3) { if (!B.view) { host.replaceChildren(); host.style.background = B.char.bg; B.view = D3.view(host, B.char, { move: B.char.move || 'wave', close: false, fx: ST.awards.filter((a) => a.who === myDesigner()).map((a) => ({ tag: a.tag })) }); } else { B.view.set(B.char); host.style.background = B.char.bg; } }
    else { host.innerHTML = CH.svg(B.char, { anim: !reduce(), label: 'Your character' }); }
    B.hint.textContent = photo ? 'Made from your photo.' : D3 ? 'Drag to spin. ' + ((window.CO_3D.MOVES.find((m) => m[0] === B.char.move) || [])[1] || 'Wave') + ' is your signature move.' : '';
    B.actHost.replaceChildren(btn('Surprise me', 'co-btn', (e) => { const keep = { style: B.char.style, move: B.char.move }; B.char = Object.assign(CH.random(B.role), keep, { pants: PANTS[Math.floor(Math.random() * PANTS.length)], shoes: SHOES[Math.floor(Math.random() * SHOES.length)] }); B.useImg = false; burst(e.currentTarget, 10); paintPreview(); paintControls(); }));
    if (B.image) B.actHost.append(btn(B.useImg ? 'Use the built one' : 'Use my photo one', 'co-btn ghost', () => { B.useImg = !B.useImg; paintPreview(); paintControls(); }));
  }
  function paintControls() {
    if (!B || !B.ctlHost) return;
    const ctl = B.ctlHost; ctl.replaceChildren();
    const tabs = el('div', 'pm-seg stu-tabs'); tabs.setAttribute('role', 'tablist');
    BT.filter(([k]) => D3 || (k !== 'look' && k !== 'moves')).forEach(([k, t]) => { const b = btn(t, 'pm-opt' + (B.tab === k ? ' on' : ''), () => { B.tab = k; paintControls(); }); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(B.tab === k)); tabs.append(b); });
    if (!D3 && (B.tab === 'look' || B.tab === 'moves')) B.tab = 'face';
    const pane = el('div', 'stu-pane');
    const set = (k, v) => { B.char[k] = v; B.useImg = false; paintPreview(); paintControls(); };
    const thumb = (cfg, crop) => (D3 ? snapOf(Object.assign({}, cfg, { gear: [] }), 112) : CH.url(Object.assign({}, cfg, { gear: crop === 'head' ? [] : cfg.gear }), crop || 'head'));
    const group = (title, key, list, crop) => {
      const g = el('div', 'stu-grp'); g.append(el('h4', '', title)); const w = el('div', 'stu-opts');
      list.forEach(([v, t]) => { const b = btn('', 'stu-opt' + (B.char[key] === v ? ' on' : ''), () => set(key, v)); const im = new Image(); im.src = thumb(Object.assign({}, B.char, { [key]: v }), crop); im.alt = ''; im.loading = 'lazy'; b.append(im, el('small', '', t)); b.setAttribute('aria-pressed', String(B.char[key] === v)); w.append(b); });
      g.append(w); return g;
    };
    const swatches = (title, key, list) => {
      const g = el('div', 'stu-grp'); g.append(el('h4', '', title)); const w = el('div', 'stu-sws');
      list.forEach((c) => { const b = btn('', 'stu-sw' + (B.char[key] === c ? ' on' : ''), () => set(key, c)); b.style.background = c; b.setAttribute('aria-label', title + ' ' + c); b.setAttribute('aria-pressed', String(B.char[key] === c)); w.append(b); });
      g.append(w); return g;
    };
    const O = CH.OPT;
    if (B.tab === 'look') {
      const g = el('div', 'stu-grp'); g.append(el('h4', '', 'Style'), el('p', 'co-note', 'Original looks inspired by the cartoons and toys of 2000–2020. Everything else (face, hair, outfit, gear) works in every style.'));
      const w = el('div', 'stu-looks');
      STYLES.forEach(([v, t, dsc]) => { const b = btn('', 'stu-look' + (B.char.style === v ? ' on' : ''), () => set('style', v)); const im = new Image(); im.src = thumb(Object.assign({}, B.char, { style: v })); im.alt = ''; b.append(im, el('b', '', t), el('small', '', dsc)); b.setAttribute('aria-pressed', String(B.char.style === v)); w.append(b); });
      g.append(w); pane.append(g);
    }
    if (B.tab === 'face') pane.append(swatches('Skin', 'skin', O.skin), group('Eyes', 'eyes', O.eyes), group('Mouth', 'mouth', O.mouth), group('Brows', 'brows', O.brows), group('Beard & more', 'face', O.face));
    if (B.tab === 'hair') pane.append(group('Hairstyle', 'hair', O.hair), swatches('Hair colour', 'hairColor', O.hairColor));
    if (B.tab === 'style') {
      pane.append(group('Outfit', 'outfit', O.outfit, 'full'), swatches('Outfit colour', 'outfitColor', O.outfitColor));
      if (D3) { pane.append(swatches('Trousers', 'pants', PANTS), swatches('Shoes', 'shoes', SHOES)); const g = el('div', 'stu-grp'); g.append(el('h4', '', 'Hands')); const w = el('div', 'stu-chips'); [['none', 'Bare hands'], ['white', 'Cartoon gloves']].forEach(([v, t]) => { const b = btn(t, 'stu-chip' + (B.char.gloves === v ? ' on' : ''), () => set('gloves', v)); b.setAttribute('aria-pressed', String(B.char.gloves === v)); w.append(b); }); g.append(w); pane.append(g); }
      pane.append(group('Glasses', 'glasses', O.glasses), group('On your head', 'head', O.head));
    }
    if (B.tab === 'gear') {
      const g = el('div', 'stu-grp'), sug = CH.gearFor(B.role);
      g.append(el('h4', '', 'Tools of the trade (up to 4)'), el('p', 'co-note', (B.role ? 'Suggested for ' + B.role + ' first (★). ' : '') + 'They float around your character; earphones, a pencil and a backpack are worn.'));
      const w = el('div', 'stu-chips');
      O.gear.slice().sort((a2, b2) => (sug.includes(b2[0]) ? 1 : 0) - (sug.includes(a2[0]) ? 1 : 0)).forEach(([v, t]) => {
        const on = B.char.gear.includes(v), b = btn((sug.includes(v) ? '★ ' : '') + t, 'stu-chip' + (on ? ' on' : ''), () => { const gl2 = B.char.gear.filter((y) => y !== v); if (!on) { gl2.push(v); while (gl2.length > 4) gl2.shift(); } set('gear', gl2); });
        b.setAttribute('aria-pressed', String(on)); w.append(b);
      });
      g.append(w); pane.append(g);
    }
    if (B.tab === 'moves' && D3) {
      const g = el('div', 'stu-grp'); g.append(el('h4', '', 'Your signature move'), el('p', 'co-note', 'Played when someone hovers over you in Studio, and when you are in the spotlight. Click to preview.'));
      const w = el('div', 'stu-chips stu-moves');
      window.CO_3D.MOVES.forEach(([v, t]) => { const b = btn(t, 'stu-chip' + (B.char.move === v ? ' on' : ''), () => { B.char.move = v; if (B.view) B.view.play(v); paintControls(); B.hint.textContent = 'Drag to spin. ' + t + ' is your signature move.'; }); b.setAttribute('aria-pressed', String(B.char.move === v)); w.append(b); });
      g.append(w); pane.append(g);
    }
    if (B.tab === 'scene') pane.append(swatches('Background', 'bg', O.bg));
    if (B.tab === 'photo') pane.append(photoPane());
    ctl.append(tabs, pane);
  }
  function photoPane() {
    const g = el('div', 'stu-grp stu-photo');
    g.append(el('h4', '', 'Turn a photo into your character'), el('p', 'co-note', 'Upload a clear, front-facing photo. Gemini (Google) turns it into a clay character that still looks like you, with the outfit, colours and gear you picked. The photo is only sent to make the picture and is not kept. Up to 8 a day.'));
    const drop = el('label', 'stu-drop'); const inp = el('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp'; inp.hidden = true;
    drop.append(inp, el('b', '', B.photoBusy ? 'Making your character… (about 15 seconds)' : 'Choose a photo'), el('small', '', 'JPEG or PNG'));
    if (B.photoBusy) drop.classList.add('busy');
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      B.photoBusy = true; paintControls();
      try {
        const photo = await shrink(f, 768, 'image/jpeg', 0.86);
        const desc = { outfit: (CH.OPT.outfit.find((x) => x[0] === B.char.outfit) || [])[1] + ' in ' + colourName(B.char.outfitColor), gear: B.char.gear.map((x) => (CH.OPT.gear.find((y) => y[0] === x) || [])[1]).join(', '), role: B.role, bg: colourName(B.char.bg) };
        const r = await post({ action: 'charMake', photo, desc });
        const made = await shrinkUrl('data:' + r.mime + ';base64,' + r.data, 384);
        if (!B) return; B.made = made; B.image = made; B.useImg = true; B.photoBusy = false; toast('Here you are! ' + (r.left >= 0 ? r.left + ' more today.' : '')); paintPreview(); paintControls();
      } catch (e) { if (B) { B.photoBusy = false; paintControls(); } toast(e.message, true); }
    });
    g.append(drop);
    if (B.made) { const im = new Image(); im.src = B.made; im.className = 'stu-made'; im.alt = 'Made from your photo'; g.append(im); }
    return g;
  }
  const NAMES = { '#ddff00': 'lime yellow', '#ff5a26': 'bright orange', '#685bc7': 'violet', '#f0eee9': 'off-white', '#1e1e1e': 'charcoal', '#3a7bd5': 'blue', '#2fb37a': 'green', '#f5c542': 'sunny yellow', '#e86aa6': 'pink', '#8fd3ff': 'sky blue', '#c9b6ff': 'lilac', '#ffb38a': 'peach', '#ffd3c2': 'soft peach', '#e8f7a6': 'pale lime' };
  const colourName = (c) => NAMES[String(c).toLowerCase()] || 'lime yellow';
  // pictures are made smaller in the browser before they are sent or kept
  const loadImg = (src) => new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('That file is not a picture we can read.')); im.src = src; });
  async function shrink(file, max, type, q) { const url = URL.createObjectURL(file); try { return draw(await loadImg(url), max, type, q); } finally { URL.revokeObjectURL(url); } }
  async function shrinkUrl(src, max) { const im = await loadImg(src); const w = draw(im, max, 'image/webp', 0.85); return w.startsWith('data:image/webp') ? w : draw(im, max, 'image/jpeg', 0.88); }
  function draw(im, max, type, q) { const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c.toDataURL(type, q); }

  /* ---------- award composer (Admins) ---------- */
  // An award's creatives: the Link column may hold both (space-separated, works with any web app version) plus Link 2.
  const awLinks = (a) => [...new Set(String((a && a.link) || '').split(/\s+/).concat(String((a && a.link2) || '').split(/\s+/)).filter((u) => /^https:\/\//i.test(u)))].slice(0, 2);
  function openAward(a) {
    let d = document.getElementById('stu-award'); if (!d) { d = el('dialog', 'co-dialog stu-dlg stu-aw'); d.id = 'stu-award'; document.body.append(d); }
    const preset = a && !a.id ? a : null; if (preset) a = null;
    const W = { id: a ? a.id : '', who: a ? a.who : preset ? preset.who : '', tag: a ? a.tag : 'best-performer', title: a ? a.title : TAGS['best-performer'][0], note: a ? a.note : '', link: a ? awLinks(a)[0] || '' : '', link2: a ? awLinks(a)[1] || '' : '', until: a ? a.until : CO.addDays(CO.today(), 7) };
    const paint = () => {
      d.replaceChildren();
      const head = el('div', 'stu-dlg-h'); head.append(el('h2', '', a ? 'Edit award' : 'Feature in the Hall of Fame')); const x = btn('', 'stu-x', () => d.close()); x.setAttribute('aria-label', 'Close'); x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'; head.append(x);
      const f = el('div', 'stu-aw-b');
      // Live preview: the award as people will see it, with the person's own character.
      const tg = tagOf(W.tag), prev = el('div', 'aw-pv'); prev.style.setProperty('--tag', tg[1]); prev.style.setProperty('--tag-ink', tg[2]);
      const stage = el('div', 'aw-pv-stage');
      const badge = el('span', 'aw-pv-badge'); badge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/></svg>'; badge.append('Hall of Fame');
      stage.append(badge);
      if (W.who && window.CO_HOF) { const im = new Image(); im.className = 'aw-pv-art'; im.alt = ''; im.decoding = 'async'; im.src = window.CO_HOF.artUrl(window.CO_HOF.charOf(W.who)); im.onerror = () => { im.replaceWith(Object.assign(CO.av(W.who), { className: 'av aw-pv-av' })); }; stage.append(im); }
      else stage.append(el('span', 'aw-pv-empty', W.who ? first(W.who) : 'Pick someone'));
      const body = el('div', 'aw-pv-b');
      const ttl = el('b', 'aw-pv-title', W.title || 'Award'), nm = el('span', 'aw-pv-who', W.who || 'Pick someone'), why = el('p', 'aw-pv-why' + (W.note ? '' : ' ph'), W.note || 'Why they earned it shows here.');
      const meta = el('small', 'aw-pv-meta', W.until ? 'Featured until ' + CO.fmtDate(W.until) : 'Featured until you remove it');
      body.append(ttl, nm, why); { const n = [W.link, W.link2].filter(Boolean).length; if (n) body.append(el('span', 'aw-pv-link', n === 2 ? '2 creatives attached' : 'Creative attached')); } body.append(meta);
      prev.append(stage, body);
      const form = el('div', 'stu-aw-form');
      const lab = (t, c) => { const l = el('label', 'co-field'); l.append(t, c); return l; };
      const who = el('select', 'co-select'); who.append(new Option('Pick a person', '')); people().forEach((n) => who.append(new Option(n, n))); who.value = W.who; who.addEventListener('change', () => { W.who = who.value; paint(); });
      const tags = el('div', 'stu-chips'); Object.entries(TAGS).forEach(([k, v]) => { const b = btn(v[0], 'stu-chip tagc' + (W.tag === k ? ' on' : ''), () => { W.tag = k; if (k !== 'custom') W.title = v[0]; else if (Object.values(TAGS).some((t) => t[0] === W.title)) W.title = ''; paint(); }); b.style.setProperty('--tag', v[1]); b.style.setProperty('--tag-ink', v[2]); b.setAttribute('aria-pressed', String(W.tag === k)); tags.append(b); });
      const title = el('input', 'co-input'); title.maxLength = 40; title.value = W.title; title.placeholder = 'Award name'; title.addEventListener('input', () => { W.title = title.value; prev.querySelector('.aw-pv-title').textContent = W.title || 'Award'; });
      const note = el('textarea', 'co-input'); note.rows = 2; note.maxLength = 240; note.value = W.note; note.placeholder = 'Why? (shown on the award)'; note.addEventListener('input', () => { W.note = note.value; const w = prev.querySelector('.aw-pv-why'); w.textContent = W.note || 'Why they earned it shows here.'; w.classList.toggle('ph', !W.note); });
      const link = el('input', 'co-input'); link.type = 'url'; link.value = W.link; link.placeholder = 'Link to the creative (optional, https://…)'; link.addEventListener('input', () => { W.link = link.value.trim(); });
      const link2 = el('input', 'co-input'); link2.type = 'url'; link2.value = W.link2; link2.placeholder = 'Second creative (optional, https://…)'; link2.setAttribute('aria-label', 'Second creative'); link2.addEventListener('input', () => { W.link2 = link2.value.trim(); });
      const links = el('div', 'aw-links'); links.append(link, link2);
      const until = el('div', 'pm-seg'); [['7', '1 week'], ['30', '1 month'], ['', 'Until I remove it']].forEach(([v, t]) => { const val = v ? CO.addDays(CO.today(), +v) : ''; const on = v ? W.until && Math.abs(CO.diffDays(CO.today(), W.until) - +v) <= 1 : !W.until; const b = btn(t, 'pm-opt' + (on ? ' on' : ''), () => { W.until = val; paint(); }); until.append(b); });
      form.append(lab('Who', who), el('h4', '', 'Award'), tags, lab('Name', title), lab('Why', note), lab('Creatives (up to 2)', links), el('h4', '', 'Show it for'), until);
      f.append(prev, form);
      const foot = el('div', 'stu-dlg-f');
      if (a) foot.append(btn('Remove award', 'co-btn ghost danger', async () => { if (!confirm('Remove this award from the wall?')) return; try { await post({ action: 'awardDelete', id: a.id }); ST.awards = ST.awards.filter((y) => y.id !== a.id); d.close(); toast('Award removed'); renderAll(); } catch (e) { toast(e.message, true); } }));
      const save = btn(a ? 'Save' : 'Feature them', 'co-btn primary', async (e) => {
        if (!W.who || !W.title.trim()) { toast('Pick a person and name the award.', true); return; }
        if ([W.link, W.link2].some((u) => u && !/^https:\/\/\S+\.\S+/i.test(u))) { toast('Creative links must start with https://', true); return; }
        const b = e.currentTarget; b.disabled = true;
        try { const r = await post(Object.assign({ action: 'awardSave' }, W, { link: [W.link, W.link2].filter(Boolean).join(' '), link2: W.link2 })); const rec = Object.assign({}, W, { id: r.id, at: a ? a.at : new Date().toISOString() }); ST.awards = ST.awards.filter((y) => y.id !== r.id).concat([rec]); burst(b, 40); d.close(); toast(a ? 'Award saved' : W.title + ' for ' + first(W.who) + '! Everyone can see it now.'); ST.ch = 0; renderAll(); }
        catch (err) { b.disabled = false; toast(err.message, true); }
      });
      foot.append(btn('Cancel', 'co-btn ghost', () => d.close()), save);
      d.append(head, f, foot);
    };
    paint(); d.showModal();
  }
  // the person card at the bottom of the sidebar opens the builder
  document.addEventListener('click', (e) => { const c = e.target.closest('[data-draw="me-card"]'); if (c && A.user) window.CO_studio.open(); });
  window.CO_studio = { awLinks, open: () => (window.CO_HOF ? window.CO_HOF.pick() : openBuilder()), build: openBuilder, award: openAward, state: ST, stars, tv: () => updateTV(true), card: () => spotCard(), channels, cheerBtn, profOf, myProf, tagOf, TAGS, weekStats, mondayOf, burst, people, imgData };
  return ST;
};
