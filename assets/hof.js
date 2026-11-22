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
      const stars = last.list.filter((s) => s.who === n);
      const tw = wk.people.find((x) => x.name === n), lw = lastWk.people.find((x) => x.name === n);
      return { name: n, role: String(EF.role(n) || '').replace(/\s*\(not shown\)\s*/i, ''), awards, stars, week: tw ? tw.qty : 0, last: lw ? lw.qty : 0, rank: awards.length ? 0 : stars.length ? 1 : 2 };
    });
    out.sort((a, b) => a.rank - b.rank || (b.awards[0] ? String(b.awards[0].at) : '').localeCompare(a.awards[0] ? String(a.awards[0].at) : '') || b.week - a.week || a.name.localeCompare(b.name));
    return out;
  }

  /* ---------- the widget ---------- */
  const W = { i: 0, el: null, timer: 0, key: '', pop: null, at: 0 };
  function wItems() {
    const L = spotlights(); if (L.length) return L;
    const me = myDesigner() || (A.user && A.user.name) || 'You';
    const ms = members().filter((m) => m.week > 0).slice(0, 4).map((m) => ({ key: 'wk:' + m.name, kind: 'week', title: m.week + ' creatives this week', who: m.name, tag: 'star' }));
    return ms.length ? ms : [{ key: 'hi', kind: 'hi', title: 'Hall of Fame', who: me, tag: 'star' }];
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
      const f = figure(ch, { label: c.who, crown: c.kind === 'award' && c.tag === 'best-performer', cls: 'pf-mini' + (c.kind === 'award' ? ' cheer' : '') });
      W.fig.replaceChildren(f);
      if (anim && !reduce()) { W.el.classList.remove('swap'); void W.el.offsetWidth; W.el.classList.add('swap'); }
    }
    W.tag.textContent = c.kind === 'hi' ? 'Hall of Fame' : c.title; W.name.textContent = c.kind === 'hi' ? 'Meet the team' : c.who;
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
  function place() { const r = W.el.getBoundingClientRect(), w = Math.min(380, window.innerWidth - 24); W.pop.style.width = w + 'px'; W.pop.style.top = (r.bottom + 8) + 'px'; W.pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px'; }
  let curIdx = 0;
  function go(d) { const t = W.pop && W.pop.querySelector('.hof2-track'); if (!t) return; const n = t.children.length; curIdx = Math.max(0, Math.min(n - 1, curIdx + d)); t.children[curIdx].scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' }); mark(); }
  function mark() { const t = W.pop && W.pop.querySelector('.hof2-track'); if (!t) return; [...t.children].forEach((c, i) => c.classList.toggle('on', i === curIdx)); const ctr = W.pop.querySelector('.hof2-ctr'); if (ctr) ctr.textContent = (curIdx + 1) + ' / ' + t.children.length; const pv = W.pop.querySelector('.hof2-prev'), nx = W.pop.querySelector('.hof2-next'); if (pv) pv.disabled = curIdx === 0; if (nx) nx.disabled = curIdx >= t.children.length - 1; }
  function popPaint(first0) {
    const pop = W.pop; if (!pop) return; place();
    const keepScroll = !first0 && pop.querySelector('.hof2-track') ? curIdx : null;
    pop.replaceChildren();
    const S2 = SD(), t = CO.today(), mon = S2.mondayOf ? S2.mondayOf(t) : t;
    const head = el('div', 'hof2-h'); const ht = el('div'); ht.append(el('b', '', 'Hall of Fame'), el('small', '', 'Week of ' + CO.fmtDate(mon) + ' · swipe or use the arrows'));
    const x = btn('', 'hof2-x', popClose); x.setAttribute('aria-label', 'Close'); x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    head.append(ht, x); pop.append(head);
    const list = members();
    const wrap = el('div', 'hof2-wrap'), track = el('div', 'hof2-track'); track.tabIndex = 0; track.setAttribute('aria-label', 'Team members');
    list.forEach((m) => {
      const ch = charOf(m.name), aw = m.awards[0], tg = aw ? tagOf(aw.tag) : null, color = aw ? tg[1] : m.stars.length ? '#ddff00' : '#c9b6ff';
      const card = el('article', 'hof2-card'); card.style.setProperty('--hc', color); card.setAttribute('aria-label', m.name);
      const stage = el('div', 'hof2-stage');
      stage.append(figure(ch, { label: m.name, crown: !!m.awards.find((a) => a.tag === 'best-performer'), sparkle: aw || m.stars.length ? color : '' }));
      stage.addEventListener('click', () => { const f = stage.querySelector('.pf'); const mv = MOVES[(MOVES.findIndex((v) => f.classList.contains('mv-' + v[0])) + 1) % MOVES.length][0]; f.className = f.className.replace(/mv-\w+/, 'mv-' + mv); });
      stage.title = 'Click to see another move';
      const body = el('div', 'hof2-b');
      const nm = el('b', 'hof2-name', m.name); const per = P(ch.persona); const sub = el('small', 'hof2-sub', (m.role || 'Team') + ' · ' + per[1] + (ch.chosen ? '' : ' (until they pick one)'));
      body.append(nm, sub);
      const badges = el('div', 'hof2-badges');
      m.awards.slice(0, 3).forEach((a) => { const t2 = tagOf(a.tag), b = el('span', 'hof2-badge', a.title); b.style.setProperty('--bc', t2[1]); b.title = a.note || ''; badges.append(b); });
      m.stars.slice(0, 2).forEach((s) => { const b = el('span', 'hof2-badge star', s.title); b.style.setProperty('--bc', '#ddff00'); b.title = s.line; badges.append(b); });
      if (!badges.childNodes.length) badges.append(el('span', 'hof2-quiet', 'No badges yet this week'));
      body.append(badges);
      if (aw && aw.note) body.append(el('p', 'hof2-note', '“' + aw.note + '”'));
      const stats = el('div', 'hof2-stats');
      [[m.week, 'this week'], [m.last, 'last week'], [m.awards.length, m.awards.length === 1 ? 'award' : 'awards']].forEach(([v, l]) => { const s2 = el('span'); s2.append(el('b', '', String(v)), el('small', '', l)); stats.append(s2); });
      body.append(stats);
      const row = el('div', 'hof2-row');
      if (S2.cheerBtn) row.append(S2.cheerBtn('pw:' + m.name + ':' + mon, true));
      if (aw && aw.link) { const a = el('a', 'stu-link', 'See the creative'); a.href = aw.link; a.target = '_blank'; a.rel = 'noopener'; row.append(a); }
      body.append(row);
      card.append(stage, body); track.append(card);
    });
    const pv = btn('', 'hof2-arr hof2-prev', () => go(-1)); pv.setAttribute('aria-label', 'Previous teammate'); pv.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
    const nx = btn('', 'hof2-arr hof2-next', () => go(1)); nx.setAttribute('aria-label', 'Next teammate'); nx.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    wrap.append(track, pv, nx); pop.append(wrap);
    let st0 = 0; track.addEventListener('scroll', () => { clearTimeout(st0); st0 = setTimeout(() => { const w = track.clientWidth; curIdx = Math.round(track.scrollLeft / w); mark(); }, 60); }, { passive: true });
    const foot = el('div', 'hof2-f');
    const ctr = el('span', 'hof2-ctr', ''); foot.append(ctr);
    const mine = charOf(myDesigner() || (A.user && A.user.name));
    foot.append(btn(mine.chosen ? 'Change my character' : 'Choose my character', 'co-btn sm primary', () => { popClose(); pick(); }));
    if (S2.state && S2.state.canAward) foot.append(btn('Give an award', 'co-btn sm', () => { popClose(); S2.award(); }));
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

  window.CO_HOF = { pick, open: popToggle, faceUrl, artUrl, charOf, PERSONAS, MOVES };
};
