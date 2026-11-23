/* Hall of Fame (Nov 2026, v3): a small animated character beside the clock and a compact pop-up to browse every
   teammate and their achievements. Characters come from a library of original personas (inspired by the general
   flavour of 2000–2020 cartoons, never copies), each drawn for three professions as glossy 3D-style art
   (assets/chars/, made free with Pollinations.ai and cut out). Motion is CSS: each person picks a move.
   Started by app.js after studio.js (window.CO_HOFINIT(api)); uses Studio's data (awards, cheers, profiles). */
window.CO_HOFINIT = function (api) {
  'use strict';
  const { A, dash, CO, post, toast, isAdmin, myDesigner, EF, renderAll } = api;
  const SD = () => window.CO_studio || {};
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const btn = (t, c, fn) => { const b = el('button', c, t); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; };
  const first = (n) => String(n || '').split(' ')[0];
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- the personas ---------- */
  const PERSONAS = [
    ['hoodiekid', 'Hoodie Kid', 'Comfy, cool, always shipping', 'groove'],
    ['grumpy', 'Grumpy Genius', 'Unimpressed until it is perfect', 'nod'],
    ['nerd', 'Big Specs', 'Notices every pixel', 'shake'],
    ['beanie', 'Beanie Boss', 'Sleepy look, sharp work', 'strut'],
    ['capkid', 'Coffee Cap', 'Runs on caffeine and ideas', 'bounce'],
    ['bluehood', 'Track Star', 'Fast, friendly, rosy cheeks', 'zoom'],
    ['orangepuff', 'Puffer Pro', 'Smug for a reason', 'strut'],
    ['streetgirl', 'Street Style', 'Effortlessly on trend', 'groove'],
    ['frog', 'Groovy Kid', 'Peace, love and deadlines', 'jump'],
    ['gorilla', 'Baby Gorilla', 'Soft heart, big muscles', 'stomp'],
    ['bunny', 'Snuggle Bunny', 'Cute but focused', 'bounce'],
    ['bear', 'Fuzzy Bear', 'Winks at every brief', 'wiggle'],
    ['penguin', 'Pip Penguin', 'Happy flapper', 'wiggle'],
    ['duckling', 'Smart Duck', 'Glasses on, quacks ideas', 'nod'],
    ['panda', 'Panda Pal', 'Kicks deadlines', 'powerup'],
    ['dragon', 'Little Dragon', 'Small but fiery', 'flip'],
    ['squirrel', 'Sporty Squirrel', 'Quick on its feet', 'shuffle'],
    ['blob', 'Lilac Blob', 'Pure good vibes', 'float'],
    ['thumbsguy', 'Thumbs Up', 'Always says yes', 'bounce'],
    ['dj', 'DJ Chill', 'Vibing to the timeline', 'nod']
  ];
  const PROFS = [['designer', 'Designer'], ['video', 'Video editor'], ['writer', 'Copywriter']];
  const MOVES = [['bounce', 'Bounce'], ['wiggle', 'Wiggle'], ['jump', 'Jump for joy'], ['groove', 'Groove'], ['shuffle', 'Side shuffle'], ['flip', 'Backflip'], ['spin', 'Turnaround'], ['shake', 'Happy shake'], ['float', 'Float'], ['stomp', 'Power stomp'], ['strut', 'Strut'], ['nod', 'Nod along'], ['zoom', 'Zoom'], ['powerup', 'Power up']];
  const P = (k) => PERSONAS.find((x) => x[0] === k) || PERSONAS[0];
  const profOfRole = (role) => (/video|editor|motion|film|reel|animat/i.test(role || '') ? 'video' : /copy|writer|content|script/i.test(role || '') ? 'writer' : 'designer');
  const hash = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const ART = 'assets/chars/';
  const artUrl = (c) => ART + c.persona + '-' + c.prof + '.webp';
  const faceUrl = (c) => ART + (PERSONAS.some((x) => x[0] === c.persona) ? c.persona : (charOf ? 'hoodiekid' : c.persona)) + '-' + c.prof + '-face.webp';
  // everyone has a character: their own pick, or one chosen for them until they pick
  function charOf(name) {
    const p = SD().profOf ? SD().profOf(name) : null;
    // characters from the earlier set move to their closest new one
    const OLD = { gadget: 'nerd', rascal: 'hoodiekid', villager: 'bluehood', ninja: 'beanie', snacky: 'bear', brainy: 'grumpy', spiky: 'orangepuff', astro: 'blob', bot: 'blob', octo: 'blob', cat: 'dj', mad: 'nerd', panda: 'panda', cop: 'capkid', star: 'streetgirl', racer: 'squirrel', monk: 'dragon', pirate: 'thumbsguy', supergirl: 'streetgirl' };
    if (p && p.char && p.char.persona) { const c = Object.assign({ chosen: true }, p.char); if (!PERSONAS.some((x) => x[0] === c.persona)) c.persona = OLD[c.persona] || PERSONAS[0][0]; return c; }
    const role = EF.role(name) || '';
    const k = PERSONAS[hash(name) % PERSONAS.length];
    return { persona: k[0], prof: profOfRole(role), move: k[3], chosen: false };
  }
  // a character, animated
  function figure(c, opts) {
    const o = opts || {}, w = el('span', 'pf mv-' + (c.move || 'bounce') + (o.still ? ' still' : '') + (o.cls ? ' ' + o.cls : ''));
    const im = new Image(); im.src = artUrl(c); im.alt = o.label || ''; im.decoding = 'async'; im.draggable = false; im.className = 'pf-img';
    im.onerror = () => { w.classList.add('missing'); };
    const tilt = el('span', 'pf-tilt'); tilt.append(im); w.append(el('i', 'pf-shadow'), tilt);
    // 3D feel: the character turns toward your pointer and hops when you arrive
    if (!o.still) {
      w.addEventListener('pointermove', (e) => { const r = w.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; w.style.setProperty('--ry', (x * 30).toFixed(1) + 'deg'); w.style.setProperty('--rx', (-y * 16).toFixed(1) + 'deg'); });
      w.addEventListener('pointerleave', () => { w.style.setProperty('--ry', '0deg'); w.style.setProperty('--rx', '0deg'); });
      w.addEventListener('pointerenter', () => { if (reduce()) return; w.classList.remove('hop'); void w.offsetWidth; w.classList.add('hop'); setTimeout(() => w.classList.remove('hop'), 750); });
    }
    if (o.crown) { const cr = el('span', 'pf-crown'); cr.innerHTML = '<svg viewBox="0 0 32 22" aria-hidden="true"><path d="M2 20h28l-2-14-7 6-5-10-5 10-7-6z" fill="#f5c542" stroke="#b8860b" stroke-width="1.2" stroke-linejoin="round"/><circle cx="16" cy="3" r="2.4" fill="#ff5a26"/><circle cx="4" cy="6" r="2" fill="#685bc7"/><circle cx="28" cy="6" r="2" fill="#2fb37a"/></svg>'; w.append(cr); }
    if (o.sparkle) { const sp = el('span', 'pf-sp'); sp.style.setProperty('--hc', o.sparkle); for (let k = 0; k < 5; k++) sp.append(el('i')); w.append(sp); }
    return w;
  }

  /* ---------- who is celebrated ---------- */
  const tagOf = (k) => (SD().tagOf ? SD().tagOf(k) : ['Award', '#ddff00', '#1e1e1e', '']);
  function spotlights() { const ch = SD().channels ? SD().channels() : { list: [] }; return ch.list || []; }
  function members() {
    const S2 = SD(), st = S2.state || {}, people = S2.people ? S2.people() : [], t = CO.today();
    const wk = S2.weekStats && S2.mondayOf ? S2.weekStats(S2.mondayOf(t), t) : { people: [] };
    const last = S2.stars ? S2.stars() : { list: [], podium: [] };
    const lastWk = S2.weekStats && S2.mondayOf ? S2.weekStats(CO.addDays(S2.mondayOf(t), -7), CO.addDays(S2.mondayOf(t), -1)) : { people: [] };
    const out = people.map((n) => {
      const awards = (st.awards || []).filter((a) => a.who === n).sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const stars = [];
      const tw = wk.people.find((x) => x.name === n), lw = lastWk.people.find((x) => x.name === n);
      return { name: n, role: String(EF.role(n) || '').replace(/\s*\(not shown\)\s*/i, ''), awards, stars, week: tw ? tw.qty : 0, last: lw ? lw.qty : 0, rank: awards.length ? 0 : stars.length ? 1 : 2 };
    });
    return out.filter((m) => m.awards.length).sort((a, b) => a.rank - b.rank || (b.awards[0] ? String(b.awards[0].at) : '').localeCompare(a.awards[0] ? String(a.awards[0].at) : '') || b.week - a.week || a.name.localeCompare(b.name));
    return out;
  }

  /* ---------- the widget ---------- */
  const W = { i: 0, el: null, timer: 0, key: '', pop: null, at: 0 };
  function wItems() {
    const L = spotlights(); if (L.length) return L;
    const me = myDesigner() || (A.user && A.user.name) || 'You';
    return [{ key: 'hi', kind: 'hi', title: 'Hall of Fame', who: me, tag: 'star' }];
  }
  function wPaint(anim) {
    if (!W.el) return;
    const L = wItems(); if (W.i >= L.length) W.i = 0; const c = L[W.i], tg = tagOf(c.tag), ch = charOf(c.who);
    const color = c.kind === 'award' ? tg[1] : '#ddff00';
    const key = c.key + '|' + JSON.stringify(ch);
    W.el.style.setProperty('--hc', color); W.el.classList.toggle('is-award', c.kind === 'award');
    W.el.setAttribute('aria-label', 'Hall of Fame: ' + (c.kind === 'hi' ? 'see everyone' : c.title + ', ' + c.who) + '. Click to browse the team.');
    if (key !== W.key) {
      W.key = key;
      if (c.kind === 'hi') { W.fig.innerHTML = '<svg class="hof-trophy" viewBox="0 0 48 48" aria-hidden="true"><path d="M16 8h16v10a8 8 0 0 1-16 0z" fill="#f5c542" stroke="#b8860b" stroke-width="1.5"/><path d="M16 11h-6a6 6 0 0 0 7 7M32 11h6a6 6 0 0 1-7 7" fill="none" stroke="#b8860b" stroke-width="2"/><path d="M24 26v6M17 40h14l-2-8H19z" fill="#f5c542" stroke="#b8860b" stroke-width="1.5"/></svg>'; }
      else { const f = figure(ch, { label: c.who, crown: c.kind === 'award' && c.tag === 'best-performer', cls: 'pf-mini' + (c.kind === 'award' ? ' cheer' : '') }); W.fig.replaceChildren(f); }
      if (anim && !reduce()) { W.el.classList.remove('swap'); void W.el.offsetWidth; W.el.classList.add('swap'); }
    }
    W.tag.textContent = c.kind === 'hi' ? 'Hall of Fame' : c.title; W.name.textContent = c.kind === 'hi' ? 'No one featured' : c.who;
    W.dots.replaceChildren(); if (L.length > 1) for (let k = 0; k < Math.min(L.length, 6); k++) W.dots.append(el('i', k === W.i % 6 ? 'on' : ''));
  }
  function wNext(d) { const n = wItems().length; if (n < 2) return; W.i = (W.i + (d || 1) + n) % n; wPaint(true); }
  dash.draw('hof', (box) => {
    if (A.mode !== 'auth' || !A.user) { box.replaceChildren(); W.el = null; W.key = ''; return; }
    const st = SD().state; if (st && !st.loaded && st.load) st.load();
    if (!W.el) {
      W.el = el('button', 'hof-w'); W.el.type = 'button';
      W.fig = el('span', 'hof-fig');
      const tx = el('span', 'hof-tx'); W.tag = el('small', 'hof-tag'); W.name = el('b', 'hof-name'); W.dots = el('span', 'hof-dots'); tx.append(W.tag, W.name, W.dots);
      W.el.append(W.fig, tx);
      W.el.addEventListener('click', (e) => { e.stopPropagation(); popToggle(); });
      clearInterval(W.timer); W.timer = setInterval(() => { if (document.hidden || reduce() || W.pop || (W.el && W.el.matches(':hover'))) return; wNext(1); }, 6500);
    }
    if (W.el.parentElement !== box) box.replaceChildren(W.el);
    wPaint(false);
    if (W.pop) popPaint(false);
  });

  /* ---------- the pop-up: every teammate, one card at a time ---------- */
  function popToggle(startName) {
    if (W.pop) { popClose(); return; }
    W.pop = el('div', 'hof2'); W.pop.setAttribute('role', 'dialog'); W.pop.setAttribute('aria-label', 'Hall of Fame: the team and their achievements');
    document.body.append(W.pop);
    const L = wItems(), c = L[W.i]; W.start = startName || (c && c.kind !== 'hi' ? c.who : myDesigner());
    popPaint(true); requestAnimationFrame(() => W.pop && W.pop.classList.add('in'));
    setTimeout(() => { const t = W.pop && W.pop.querySelector('.hof2-track'); if (t) t.focus({ preventScroll: true }); }, 60);
  }
  function popClose() { if (W.pop) { const p = W.pop; p.classList.remove('in'); setTimeout(() => p.remove(), 200); } W.pop = null; }
  document.addEventListener('click', (e) => { if (W.pop && !W.pop.contains(e.target) && !e.target.closest('.hof-w') && !e.target.closest('dialog')) popClose(); });
  document.addEventListener('keydown', (e) => { if (!W.pop) return; if (e.key === 'Escape') popClose(); else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.target.closest('input,textarea')) { e.preventDefault(); go(e.key === 'ArrowRight' ? 1 : -1); } });
  window.addEventListener('resize', () => { if (W.pop) place(); });
  function place() { const r = W.el.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 24); W.pop.style.width = w + 'px'; W.pop.style.top = (r.bottom + 8) + 'px'; W.pop.style.maxHeight = (window.innerHeight - r.bottom - 20) + 'px'; W.pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px'; }
  let curIdx = 0;
  function go(d) { const t = W.pop && W.pop.querySelector('.hof2-track'); if (!t) return; const n = t.children.length; curIdx = Math.max(0, Math.min(n - 1, curIdx + d)); t.children[curIdx].scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' }); mark(); }
  function mark() { const t = W.pop && W.pop.querySelector('.hof2-track'); if (!t) return; [...t.children].forEach((c, i) => c.classList.toggle('on', i === curIdx)); const ctr = W.pop.querySelector('.hof2-ctr'); if (ctr) { ctr.replaceChildren(); [...t.children].forEach((_, i) => { const d = el('i', i === curIdx ? 'on' : ''); ctr.append(d); }); ctr.setAttribute('aria-label', (curIdx + 1) + ' of ' + t.children.length); } const pv = W.pop.querySelector('.hof2-prev'), nx = W.pop.querySelector('.hof2-next'); if (pv) pv.disabled = curIdx === 0; if (nx) nx.disabled = curIdx >= t.children.length - 1; }
  function popPaint(first0) {
    const pop = W.pop; if (!pop) return; place();
    const keepScroll = !first0 && pop.querySelector('.hof2-track') ? curIdx : null;
    pop.replaceChildren();
    const S2 = SD(), t = CO.today(), mon = S2.mondayOf ? S2.mondayOf(t) : t;
    const head = el('div', 'hof2-h'); const ht = el('div'); ht.append(el('b', '', 'Hall of Fame'));
    const x = btn('', 'hof2-x', popClose); x.setAttribute('aria-label', 'Close'); x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    head.append(ht, x); pop.append(head);
    const list = members();
    ht.append(el('small', '', list.length ? list.length + ' of 3 featured' + (list.length > 1 ? ' · swipe or use the arrows' : '') : 'Nobody featured right now'));
    if (!list.length) { const e = el('div', 'hof2-empty'); e.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M16 8h16v10a8 8 0 0 1-16 0z" fill="#f5c542" stroke="#b8860b" stroke-width="1.5"/><path d="M16 11h-6a6 6 0 0 0 7 7M32 11h6a6 6 0 0 1-7 7" fill="none" stroke="#b8860b" stroke-width="2"/><path d="M24 26v6M17 40h14l-2-8H19z" fill="#f5c542" stroke="#b8860b" stroke-width="1.5"/></svg>'; e.append(el('b', '', 'No one featured right now'), el('small', '', S2.state && S2.state.canAward ? 'Pick up to 3 people to celebrate.' : 'The Creative Head picks who is featured here.')); pop.append(e); }
    const wrap = el('div', 'hof2-wrap'), track = el('div', 'hof2-track'); track.tabIndex = 0; track.setAttribute('aria-label', 'Team members');
    list.forEach((m) => {
      const ch = charOf(m.name), aw = m.awards[0], tg = aw ? tagOf(aw.tag) : null, color = aw ? tg[1] : m.stars.length ? '#ddff00' : '#c9b6ff';
      const card = el('article', 'hof2-card'); card.style.setProperty('--hc', color); card.setAttribute('aria-label', m.name);
      const stage = el('div', 'hof2-stage');
      stage.append(figure(ch, { label: m.name, crown: !!m.awards.find((a) => a.tag === 'best-performer'), sparkle: aw || m.stars.length ? color : '' }));
      stage.addEventListener('click', () => { const f = stage.querySelector('.pf'); const mv = MOVES[(MOVES.findIndex((v) => f.classList.contains('mv-' + v[0])) + 1) % MOVES.length][0]; f.className = f.className.replace(/mv-\w+/, 'mv-' + mv); });
      const body = el('div', 'hof2-b');
      const nm = el('b', 'hof2-name', m.name); const per = P(ch.persona); const sub = el('small', 'hof2-sub', (m.role || 'Team') + ' · ' + per[1]);
      body.append(nm, sub);
      const badges = el('div', 'hof2-badges');
      m.awards.slice(0, 3).forEach((a) => { const t2 = tagOf(a.tag), b = el('span', 'hof2-badge', a.title); b.style.setProperty('--bc', t2[1]); b.title = a.note || ''; badges.append(b); });
      m.stars.slice(0, 2).forEach((s) => { const b = el('span', 'hof2-badge star', s.title); b.style.setProperty('--bc', '#ddff00'); b.title = s.line; badges.append(b); });
      if (!badges.childNodes.length) badges.append(el('span', 'hof2-quiet', 'No badges yet this week'));
      body.append(badges);
      if (aw && aw.note) { const q = el('figure', 'hof2-quote'); q.style.setProperty('--qc', tagOf(aw.tag)[1]); const mk = el('span', 'hof2-qm', '“'); mk.setAttribute('aria-hidden', 'true'); const bq = el('blockquote', '', aw.note); const cap = el('figcaption', '', aw.at ? 'Awarded ' + CO.fmtDate(String(aw.at).slice(0, 10)) : ''); q.append(mk, bq, cap); const rb = reactBar('rx:' + aw.id + ':m'); q.append(rb); q.addEventListener('dblclick', (e) => { e.preventDefault(); rb.react('❤️', true, e); }); body.append(q); }
      const stats = el('div', 'hof2-stats');
      [[m.week, 'this week'], [m.last, 'last week'], [m.awards.length, m.awards.length === 1 ? 'award' : 'awards']].forEach(([v, l]) => { const s2 = el('span'); s2.append(el('b', '', String(v)), el('small', '', l)); stats.append(s2); });
      body.append(stats);
      const row = el('div', 'hof2-row');
      if (S2.cheerBtn) row.append(S2.cheerBtn('pw:' + m.name + ':' + mon, true));
      if (S2.state && S2.state.canAward) {
        const live = (S2.state.awards || []).length;
        if (aw) row.append(btn('Remove', 'co-btn sm ghost', async () => { if (!confirm('Remove ' + m.name + ' from the Hall of Fame?')) return; try { await post({ action: 'awardDelete', id: aw.id }); S2.state.awards = S2.state.awards.filter((y) => y.id !== aw.id); W.key = ''; renderAll(); toast('Removed'); } catch (e) { toast(e.message, true); } }));
        else if (live < 3) row.append(btn('Feature in Hall of Fame', 'co-btn sm primary', () => { popClose(); S2.award({ who: m.name }); }));
      }
      if (aw) { const L2 = S2.awLinks ? S2.awLinks(aw) : [aw.link].filter(Boolean); if (L2.length) { const sc = el('div', 'hof2-shows'); L2.forEach((u, k) => { const t = el('div', 'hof2-show'); const a = el('a', 'hof2-show-a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; a.append(el('span', 'hof2-show-ic', linkIcon(u)), el('b', '', L2.length > 1 ? 'Creative ' + (k + 1) : 'The creative'), el('small', '', host(u) + ' ↗')); t.append(a, reactBar('rx:' + aw.id + ':c' + (k + 1))); sc.append(t); }); body.append(sc); } }
      if (aw && A.user && A.user.owner && S2.award) row.append(btn('Edit', 'co-btn sm ghost hof2-edit', () => { popClose(); S2.award(aw); }));
      body.append(row);
      card.append(stage, body); track.append(card);
    });
    const pv = btn('', 'hof2-arr hof2-prev', () => go(-1)); pv.setAttribute('aria-label', 'Previous teammate'); pv.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
    const nx = btn('', 'hof2-arr hof2-next', () => go(1)); nx.setAttribute('aria-label', 'Next teammate'); nx.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    wrap.append(track, pv, nx); pop.append(wrap);
    let st0 = 0; track.addEventListener('scroll', () => { clearTimeout(st0); st0 = setTimeout(() => { const w = track.clientWidth; curIdx = Math.round(track.scrollLeft / w); mark(); }, 60); }, { passive: true });
    const foot = el('div', 'hof2-f');
    const ctr = el('span', 'hof2-ctr', ''); if (list.length < 2) ctr.hidden = true; foot.append(ctr);
    const mine = charOf(myDesigner() || (A.user && A.user.name));
    if (S2.state && S2.state.canAward && list.length < 3) foot.append(btn('+ Feature', 'co-btn sm', () => { popClose(); S2.award(); }));
    { const pb = btn('♫', 'co-btn sm hof2-plb', () => { popClose(); playlist(); }); pb.setAttribute('aria-label', 'Team playlist'); pb.title = 'Team playlist: suggest trending songs'; foot.append(pb); }
    foot.append(btn(mine.chosen ? 'My character' : 'Pick my character', 'co-btn sm primary', () => { popClose(); pick(); }));
    
    pop.append(foot);
    const start = keepScroll != null ? keepScroll : Math.max(0, list.findIndex((m) => m.name === W.start));
    curIdx = start; requestAnimationFrame(() => { track.scrollLeft = start * track.clientWidth; mark(); });
  }

  /* ---------- choose your character ---------- */
  let K = null;
  function pick() {
    const me = myDesigner() || (A.user && A.user.name) || '', cur = charOf(me), prof0 = SD().myProf && SD().myProf();
    K = { c: { persona: cur.persona, prof: cur.prof, move: cur.move || P(cur.persona)[3] }, tagline: prof0 && prof0.tagline || '' };
    let d = document.getElementById('hof-pick');
    if (!d) { d = el('dialog', 'co-dialog hof-pick'); d.id = 'hof-pick'; d.setAttribute('aria-label', 'Choose your character'); document.body.append(d); }
    paintPick(); if (!d.open) d.showModal();
  }
  function paintPick() {
    const d = document.getElementById('hof-pick'); if (!d || !K) return;
    d.replaceChildren();
    const head = el('div', 'hp-h'); const ht = el('div'); ht.append(el('h2', '', 'Choose your character'), el('p', 'co-note', 'Original characters for our team. Pick one, your craft and your move.'));
    const x = btn('', 'hof2-x', () => d.close()); x.setAttribute('aria-label', 'Close'); x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    head.append(ht, x);
    const body = el('div', 'hp-b');
    const pv = el('div', 'hp-pv'); const stage = el('div', 'hof2-stage big'); stage.style.setProperty('--hc', '#ddff00'); stage.append(figure(K.c, { label: 'Your character', sparkle: '#ddff00' }));
    const per = P(K.c.persona); pv.append(stage, el('b', 'hp-name', per[1]), el('small', 'hp-vibe', per[2]));
    const tl = el('input', 'co-input'); tl.placeholder = 'Your tagline (e.g. "Kerning is my cardio")'; tl.maxLength = 80; tl.value = K.tagline; tl.setAttribute('aria-label', 'Tagline'); tl.addEventListener('input', () => { K.tagline = tl.value; }); pv.append(tl);
    const ctl = el('div', 'hp-ctl');
    const seg = el('div', 'pm-seg'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', 'Your craft');
    PROFS.forEach(([v, t]) => { const b = btn(t, 'pm-opt' + (K.c.prof === v ? ' on' : ''), () => { K.c.prof = v; paintPick(); }); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(K.c.prof === v)); seg.append(b); });
    ctl.append(el('h4', '', 'Your craft'), seg, el('h4', '', 'Character'));
    const grid = el('div', 'hp-grid');
    PERSONAS.forEach(([k, n]) => { const b = btn('', 'hp-opt' + (K.c.persona === k ? ' on' : ''), () => { K.c.persona = k; K.c.move = P(k)[3]; paintPick(); }); b.setAttribute('aria-pressed', String(K.c.persona === k)); b.append(figure({ persona: k, prof: K.c.prof, move: P(k)[3] }, { label: '', still: true }), el('small', '', n)); grid.append(b); });
    ctl.append(grid, el('h4', '', 'Your move'));
    const mv = el('div', 'hp-moves');
    MOVES.forEach(([v, t]) => { const b = btn(t, 'stu-chip' + (K.c.move === v ? ' on' : ''), () => { K.c.move = v; paintPick(); }); b.setAttribute('aria-pressed', String(K.c.move === v)); mv.append(b); });
    ctl.append(mv);
    body.append(pv, ctl);
    const foot = el('div', 'hp-f');
    foot.append(el('small', 'co-note', 'Original characters, art made free with Pollinations.ai.'), btn('Cancel', 'co-btn ghost', () => d.close()));
    const save = btn('Save my character', 'co-btn primary', async () => {
      save.disabled = true; save.textContent = 'Saving…';
      try {
        const r = await post({ action: 'profileSave', who: myDesigner() || A.user.name || '', char: Object.assign({ v: 3 }, K.c), tagline: K.tagline || '', image: 'remove' });
        const st = SD().state; if (st) { const i = st.profiles.findIndex((y) => y.email === A.user.email); const np = Object.assign({ email: A.user.email }, r.profile); if (i >= 0) st.profiles[i] = np; else st.profiles.push(np); }
        if (SD().burst) SD().burst(save, 30); if (window.CO_SOUND) window.CO_SOUND.play('achievement');
        toast('Say hi to ' + P(K.c.persona)[1] + '!'); d.close(); W.key = ''; renderAll();
      } catch (e) { save.disabled = false; save.textContent = 'Save my character'; toast('Could not save: ' + e.message, true); }
    });
    foot.append(save);
    d.append(head, body, foot);
  }



  /* ---------- emoji reactions (on award messages and creatives) ----------
     Stored with cheers: one key per target and emoji ("rx:<award>:<m|c1|c2>:<emoji>"), toggled per person. */
  // a person's name from their email (team names first), for "who reacted" and "who suggested"
  const nameOf = (email) => { const loc = String(email || '').split('@')[0]; const f = loc.split(/[._-]/)[0].toLowerCase(); const t = (SD().people ? SD().people() : []).find((n) => n.toLowerCase().split(' ')[0] === f); return t || loc.split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' '); };
  const EMO = ['❤️', '🔥', '😂', '😍', '👏', '🎉', '💯', '🙌'];
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').replace(/^(drive|docs)\.google\.com$/, 'Google Drive'); } catch (e) { return 'link'; } };
  const linkIcon = (u) => /figma/i.test(u) ? '◆' : /youtu|vimeo|\.mp4/i.test(u) ? '▶' : /drive|docs\.google/i.test(u) ? '▲' : /canva/i.test(u) ? '●' : '↗';
  let pickerOpen = null;
  function reactBar(base) {
    const S2 = SD(), C = () => (S2.state && S2.state.cheers) || {};
    const bar = el('div', 'rx'); bar.dataset.k = base;
    const pills = el('div', 'rx-pills'), add = btn('', 'rx-add'); add.setAttribute('aria-label', 'Add a reaction'); add.setAttribute('aria-haspopup', 'true');
    add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/></svg><i>+</i>';
    const paint = (bump) => {
      pills.replaceChildren();
      const ppl = [];
      EMO.forEach((e) => { const c = C()[base + ':' + e]; if (c && c.n) (c.who || []).forEach((w) => { if (!ppl.some((x) => x.w === w)) ppl.push({ w, e }); }); if (c && c.mine && A.user && !(c.who || []).includes(String(A.user.email).toLowerCase()) && !ppl.some((x) => x.w === 'me')) ppl.push({ w: 'me', e }); });
      who.replaceChildren(); who.hidden = !ppl.length;
      if (ppl.length) { const me = A.user && String(A.user.email).toLowerCase(); ppl.slice(0, 3).forEach((x, i) => { const n = el('b', 'rx-who-n' + (bump && (x.w === me || x.w === 'me') ? ' hl' : ''), x.w === me || x.w === 'me' ? 'You' : nameOf(x.w)); if (i) who.append(i === Math.min(ppl.length, 3) - 1 && ppl.length <= 3 ? ' and ' : ', '); who.append(n); }); who.append(ppl.length > 3 ? ' +' + (ppl.length - 3) + ' reacted' : ' reacted'); }
      EMO.forEach((e) => { const c = C()[base + ':' + e]; if (!c || !c.n) return; const p = btn('', 'rx-pill' + (c.mine ? ' on' : '') + (bump === e ? ' bump' : '')); p.append(el('span', 'rx-e', e), el('b', '', String(c.n))); p.setAttribute('aria-pressed', String(!!c.mine)); p.setAttribute('aria-label', e + ' ' + c.n + (c.mine ? ', you reacted' : '')); p.title = c.mine ? 'You reacted. Tap to undo.' : 'Tap to react ' + e; p.addEventListener('click', (ev) => bar.react(e, false, ev)); pills.append(p); });
    };
    bar.react = async (e, onlyOn, ev) => {
      const k = base + ':' + e, all = C(), cur = all[k] || { n: 0, mine: false, who: [] };
      if (onlyOn && cur.mine) { fly(e, ev, bar); return; }
      const on = !cur.mine; all[k] = Object.assign({}, cur, { mine: on, n: Math.max(0, cur.n + (on ? 1 : -1)) });
      if (S2.state) S2.state.cheers = all;
      paint(on ? e : ''); if (on) { fly(e, ev, bar); try { if (navigator.vibrate) navigator.vibrate(12); } catch (x) { /* ignore */ } }
      try { await post({ action: 'cheer', key: k }); } catch (err) { all[k] = cur; paint(); toast('Reaction not saved: ' + err.message, true); }
    };
    add.addEventListener('click', (ev) => { ev.stopPropagation(); openPicker(add, bar); });
    const who = el('div', 'rx-who'); who.hidden = true;
    bar.append(pills, add, who); paint(); return bar;
  }
  function openPicker(anchor, bar) {
    if (pickerOpen) { const was = pickerOpen.bar; closePicker(); if (was === bar) return; }
    const pk = el('div', 'rx-pick'); pk.setAttribute('role', 'menu'); pk.setAttribute('aria-label', 'React');
    EMO.forEach((e, i) => { const b = btn(e, 'rx-opt'); b.style.setProperty('--i', i); b.setAttribute('role', 'menuitem'); b.setAttribute('aria-label', 'React ' + e); b.addEventListener('click', (ev) => { ev.stopPropagation(); bar.react(e, false, ev); closePicker(); }); pk.append(b); });
    document.body.append(pk);
    const r = anchor.getBoundingClientRect(), w = pk.offsetWidth, h = pk.offsetHeight;
    pk.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    pk.style.top = (r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8) + 'px';
    requestAnimationFrame(() => pk.classList.add('in'));
    const off = (ev) => { if (!pk.contains(ev.target)) closePicker(); }, key = (ev) => { if (ev.key === 'Escape') closePicker(); };
    setTimeout(() => { document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key); }, 0);
    pickerOpen = { pk, bar, off, key }; const f = pk.querySelector('.rx-opt'); if (f) f.focus({ preventScroll: true });
  }
  function closePicker() { if (!pickerOpen) return; const { pk, off, key } = pickerOpen; document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', key); pk.classList.remove('in'); setTimeout(() => pk.remove(), 180); pickerOpen = null; }
  // the emoji floats up from where you tapped (a few copies for a burst)
  function fly(e, ev, near) {
    if (reduce()) return;
    const r = near.getBoundingClientRect(), x = ev && ev.clientX ? ev.clientX : r.left + 20, y = ev && ev.clientY ? ev.clientY : r.top;
    for (let i = 0; i < 5; i++) { const f = el('span', 'rx-fly', e); f.style.left = x + 'px'; f.style.top = y + 'px'; f.style.setProperty('--dx', ((Math.random() - 0.5) * 80).toFixed(0) + 'px'); f.style.setProperty('--d', (i * 60) + 'ms'); f.style.setProperty('--s', (i ? 0.6 + Math.random() * 0.5 : 1.5).toFixed(2)); document.body.append(f); setTimeout(() => f.remove(), 1300 + i * 60); }
  }


  // Clean songs only: explicit, vulgar or adult words in English, Hindi and Punjabi (transliterated) are refused.
  const BAD = /\b(f+u+c*k+\w*|sh[i1]t\w*|b[i1]tch\w*|sexy?|sexual|nud(e|ity)|porn\w*|d[i1]ck|puss(y|ies)|asshole|bastard|slut|whore|horny|explicit|nsfw|18\+|xxx|boobs?|naked|kiss me all over|chut\w*|chu+t[i1]y\w*|madarc\w*|bh?en ?ch\w*|bc|mc|bsdk|gaa?nd\w*|lu+nd|randi|harami|kamin[ae]|saal[ia]|daaru|daru|sharaab?|peg|nasha|bottle|tharki|jawani|choli)\b/i;
  const dirty = (t) => BAD.test(String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, ''));
  // 5-second previews: YouTube links play their first 5 seconds in a small player; Spotify links open Spotify's own preview player.
  const ytId = (u) => { const m = String(u).match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([\w-]{11})/); return m ? m[1] : ''; };
  const spId = (u) => { const m = String(u).match(/open\.spotify\.com\/(?:intl-\w+\/)?track\/(\w+)/); return m ? m[1] : ''; };
  let playing = null;
  function stopPreview() { if (!playing) return; clearTimeout(playing.t); playing.box.remove(); playing.b.classList.remove('on'); playing.b.setAttribute('aria-label', 'Preview ' + playing.m.song); playing = null; }
  function previewBtn(m, li) {
    const yt = ytId(m.link), sp = spId(m.link);
    const b = btn('', 'pl-prev'); b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><i class="pl-ring"></i>';
    if (!yt && !sp) { b.disabled = true; b.title = 'Add a YouTube or Spotify link to preview'; b.setAttribute('aria-label', 'No preview for ' + m.song); return b; }
    b.setAttribute('aria-label', 'Preview ' + m.song); b.title = yt ? 'Play the first 5 seconds' : 'Spotify preview';
    b.addEventListener('click', () => {
      const same = playing && playing.m.id === m.id; stopPreview(); if (same) return;
      const box = el('li', 'pl-player'); const f = document.createElement('iframe'); f.title = 'Preview: ' + m.song; f.allow = 'autoplay; encrypted-media'; f.loading = 'eager'; f.referrerPolicy = 'strict-origin-when-cross-origin';
      f.src = yt ? 'https://www.youtube-nocookie.com/embed/' + yt + '?autoplay=1&start=0&end=5&controls=0&modestbranding=1&rel=0&playsinline=1' : 'https://open.spotify.com/embed/track/' + sp + '?utm_source=generator&theme=0';
      if (sp) f.height = '80';
      box.append(f); li.after(box); b.classList.add('on'); b.setAttribute('aria-label', 'Stop preview');
      playing = { m, b, box, t: yt ? setTimeout(stopPreview, 5600) : setTimeout(stopPreview, 30000) };
    });
    return b;
  }

  /* ---------- team playlist: anyone suggests trending songs (any language), others like them ---------- */
  const PL = { list: null, langs: ['Hindi', 'Punjabi', 'English', 'Tamil', 'Telugu', 'Bengali', 'Marathi', 'Haryanvi', 'Bhojpuri', 'Gujarati', 'Malayalam', 'Kannada', 'K-pop', 'Lo-fi', 'Instrumental', 'Other'], f: '', err: '' };
  const linkKind = (u) => /youtu/i.test(u) ? 'YouTube' : /spotify/i.test(u) ? 'Spotify' : /music\.apple/i.test(u) ? 'Apple Music' : /jiosaavn|saavn/i.test(u) ? 'JioSaavn' : /gaana/i.test(u) ? 'Gaana' : /wynk/i.test(u) ? 'Wynk' : 'Listen';
  async function plLoad() { try { const r = await post({ action: 'music' }); PL.list = r.list || []; if (r.langs) PL.langs = r.langs; PL.err = ''; } catch (e) { PL.list = PL.list || []; PL.err = /unknown/i.test(e.message) ? 'The playlist needs the latest web app. It switches on after the next automatic update.' : e.message; } }
  async function playlist() {
    let d = document.getElementById('hof-pl'); if (!d) { d = el('dialog', 'co-dialog pl-dlg'); d.id = 'hof-pl'; d.setAttribute('aria-labelledby', 'pl-t'); document.body.append(d); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); }
    if (!d.dataset.wired) { d.dataset.wired = '1'; d.addEventListener('close', stopPreview); }
    const paint = () => {
      stopPreview(); d.replaceChildren();
      const h = el('div', 'pl-h'); const ht = el('div'); const t = el('h2', '', 'Team playlist'); t.id = 'pl-t'; ht.append(t, el('p', 'co-note', 'Clean, trending songs the team is into, in any language. Tap ▶ for a 5-second preview (YouTube links); full songs open on YouTube, Spotify and others under their own licences.'));
      const x = btn('', 'hof2-x', () => d.close()); x.setAttribute('aria-label', 'Close'); x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'; h.append(ht, x);
      // suggest
      const form = el('form', 'pl-form'); form.noValidate = true;
      const song = el('input', 'co-input'); song.placeholder = 'Song'; song.maxLength = 80; song.required = true; song.setAttribute('aria-label', 'Song');
      const art = el('input', 'co-input'); art.placeholder = 'Artist'; art.maxLength = 60; art.setAttribute('aria-label', 'Artist');
      const lang = el('select', 'co-select'); lang.setAttribute('aria-label', 'Language or genre'); PL.langs.forEach((l) => lang.append(new Option(l, l))); lang.value = 'Hindi';
      const link = el('input', 'co-input'); link.type = 'url'; link.placeholder = 'Link (YouTube, Spotify…), optional'; link.setAttribute('aria-label', 'Link');
      const add = el('button', 'co-btn primary', 'Suggest'); add.type = 'submit';
      form.append(song, art, lang, link, add);
      form.addEventListener('submit', async (e) => { e.preventDefault(); if (!song.value.trim()) { song.focus(); return; } if (link.value.trim() && !/^https:\/\/\S+\.\S+/i.test(link.value.trim())) { toast('Paste a full link that starts with https://', true); link.focus(); return; } add.disabled = true;
        const bad = dirty(song.value + ' ' + art.value); if (bad) { toast('Please suggest clean songs only: no explicit, vulgar or adult content.', true); song.focus(); return; }
        try { const rr = await post({ action: 'musicAdd', song: song.value, artist: art.value, lang: lang.value, link: link.value.trim() }); PL.justAdded = rr && rr.id; toast('Added to the team playlist'); await plLoad(); paint(); } catch (err) { add.disabled = false; toast(/unknown/i.test(err.message) ? 'The playlist switches on after the next web app update.' : err.message, true); } });
      // language filter
      const langsUsed = [...new Set((PL.list || []).map((m) => m.lang))];
      const fl = el('div', 'pl-chips'); [''].concat(PL.langs.filter((l) => langsUsed.includes(l))).forEach((l) => { const b = btn(l || 'All', 'pl-chip' + (PL.f === l ? ' on' : ''), () => { PL.f = l; paint(); }); b.setAttribute('aria-pressed', String(PL.f === l)); fl.append(b); });
      // list: most liked first, then newest
      const ul = el('ol', 'pl-list');
      const L = (PL.list || []).filter((m) => !dirty(m.song + ' ' + m.artist)).filter((m) => !PL.f || m.lang === PL.f).sort((a, b) => b.likes - a.likes || String(b.at).localeCompare(String(a.at)));
      L.forEach((m, i) => {
        const li = el('li', 'pl-row'); li.append(el('span', 'pl-n', String(i + 1)));
        const tx = el('div', 'pl-tx'); const meta = el('small', '', [m.artist, m.lang].filter(Boolean).join(' · ')); const by = el('span', 'pl-by' + (m.id === PL.justAdded ? ' hl' : '')); const bav = CO.av(m.by || '?'); by.append(bav, el('b', '', m.mine ? 'You' : first(m.by))); tx.append(el('b', '', m.song), meta, by); li.append(tx);
        li.append(previewBtn(m, li));
        if (m.link) { const a = el('a', 'pl-play', linkKind(m.link)); a.href = m.link; a.target = '_blank'; a.rel = 'noopener'; li.append(a); }
        const lk = btn('', 'pl-like' + (m.liked ? ' on' : ''), async () => { m.liked = !m.liked; m.likes += m.liked ? 1 : -1; paint(); try { await post({ action: 'cheer', key: 'mu:' + m.id }); } catch (e) { m.liked = !m.liked; m.likes += m.liked ? 1 : -1; paint(); toast(e.message, true); } });
        lk.setAttribute('aria-pressed', String(m.liked)); lk.setAttribute('aria-label', (m.liked ? 'Unlike ' : 'Like ') + m.song); lk.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>'; lk.append(el('span', '', String(m.likes))); li.append(lk);
        if (m.canDel) { const del = btn('', 'pl-del', async () => { if (!confirm('Remove "' + m.song + '" from the playlist?')) return; try { await post({ action: 'musicDel', id: m.id }); PL.list = PL.list.filter((y) => y.id !== m.id); paint(); } catch (e) { toast(e.message, true); } }); del.setAttribute('aria-label', 'Remove ' + m.song); del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'; li.append(del); }
        ul.append(li);
      });
      const body = el('div', 'pl-b'); body.append(form);
      if (PL.err) body.append(el('p', 'pl-empty', PL.err));
      else if (PL.list == null) body.append(el('p', 'pl-empty', 'Loading…'));
      else if (!L.length) body.append(el('p', 'pl-empty', PL.f ? 'No ' + PL.f + ' songs yet. Suggest one above.' : 'No songs yet. Be the first to suggest one.'));
      else { if (fl.childNodes.length > 2) body.append(fl); body.append(ul); }
      d.append(h, body);
    };
    paint(); if (!d.open) d.showModal(); await plLoad(); if (d.open) paint();
  }
  window.CO_HOF = { playlist, pick, open: popToggle, faceUrl, artUrl, charOf, PERSONAS, MOVES };
};
