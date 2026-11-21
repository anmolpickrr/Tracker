/* Sound (Nov 2026): notification sounds and the Studio radio, both made live in the browser with the Web Audio API
   (no audio files, nothing to license). Everything is OFF until the person says yes in a small "Sounds?" card, and each
   person can change it any time (bell panel > Sounds & music, or the radio in Studio).
   CO_SOUND.play(type)  type: reminder | mention | task | achievement | announcement
   CO_SOUND.music.toggle() / .play() / .pause() / .volume(v)
   CO_SOUND.ask(why)  shows the consent card once
   CO_SOUND.panel(el) draws the settings */
(function () {
  'use strict';
  const KEY = 'co.snd';
  const DEF = { asked: false, notify: false, music: false, vol: 0.55, mvol: 0.4, types: { reminder: true, mention: true, task: true, achievement: true, announcement: true } };
  let P = DEF; try { P = Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); P.types = Object.assign({}, DEF.types, P.types || {}); } catch (e) { P = Object.assign({}, DEF); }
  let saver = null; const listeners = new Set();
  const save = (remote) => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* private mode */ } if (remote !== false && saver) saver(P); listeners.forEach((f) => { try { f(P); } catch (e) { /* ignore */ } }); };
  const TYPES = [['reminder', 'Reminders', 'A soft two-note bell'], ['mention', 'Mentions', 'A quick bright pluck'], ['task', 'Task updates', 'A gentle pop'], ['achievement', 'Achievements', 'A sparkly rising chime'], ['announcement', 'Announcements', 'A warm chord']];

  /* ---------- audio graph ---------- */
  let ctx = null, master = null, sfx = null, bus = null;
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC(); master = ctx.createDynamicsCompressor(); master.threshold.value = -18; master.ratio.value = 3; master.connect(ctx.destination);
      sfx = ctx.createGain(); sfx.connect(master); bus = ctx.createGain(); bus.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    sfx.gain.value = 0.32 * P.vol; bus.gain.value = 0.5 * P.mvol;
    return ctx;
  }
  // browsers only start audio after a click: resume on the next one
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }, { passive: true }));
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function tone(dest, t, f, dur, o) {
    const c = ctx, g = c.createGain(), os = c.createOscillator(); o = o || {};
    os.type = o.type || 'sine'; os.frequency.setValueAtTime(f, t); if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || dur));
    const a = o.attack || 0.005, pk = o.gain == null ? 0.5 : o.gain;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = os; if (o.lp) { const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = o.lp; os.connect(f2); node = f2; }
    node.connect(g); g.connect(dest); os.start(t); os.stop(t + dur + 0.05);
  }
  let noiseBuf = null;
  const noise = () => { if (noiseBuf) return noiseBuf; const n = ctx.sampleRate; noiseBuf = ctx.createBuffer(1, n, n); const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return noiseBuf; };
  function hiss(dest, t, dur, o) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noise();
    f.type = o.type || 'highpass'; f.frequency.value = o.f || 7000; if (o.q) f.Q.value = o.q;
    g.gain.setValueAtTime(o.gain || 0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  /* ---------- notification sounds: short, soft, each type its own ---------- */
  const SFX = {
    reminder: (t) => { tone(sfx, t, hz(88), 0.9, { gain: 0.35 }); tone(sfx, t, hz(100), 0.6, { gain: 0.06 }); tone(sfx, t + 0.22, hz(83), 1.1, { gain: 0.32 }); tone(sfx, t + 0.22, hz(95), 0.7, { gain: 0.05 }); },
    mention: (t) => { tone(sfx, t, hz(79), 0.22, { type: 'triangle', gain: 0.35, lp: 4000 }); tone(sfx, t + 0.09, hz(86), 0.35, { type: 'triangle', gain: 0.35, lp: 4000 }); },
    task: (t) => { tone(sfx, t, 880, 0.14, { to: 440, glide: 0.1, gain: 0.4 }); hiss(sfx, t, 0.03, { f: 5000, gain: 0.04 }); },
    achievement: (t) => { [72, 76, 79, 84, 88].forEach((m, i) => tone(sfx, t + i * 0.07, hz(m), 0.5, { type: 'triangle', gain: 0.28, lp: 5000 })); [96, 100, 103].forEach((m, i) => tone(sfx, t + 0.35 + i * 0.05, hz(m), 0.35, { gain: 0.05 })); },
    announcement: (t) => { [60, 64, 67, 71].forEach((m, i) => tone(sfx, t + i * 0.03, hz(m), 1.3, { type: 'triangle', gain: 0.16, attack: 0.08, lp: 1800 })); tone(sfx, t + 0.4, hz(83), 0.8, { gain: 0.12 }); }
  };
  let lastAt = 0;
  function play(type, force) {
    if (!force && (!P.notify || !P.types[type])) return false;
    if (!force && Date.now() - lastAt < 900) return false; // never a burst of sounds
    if (!audio()) return false; lastAt = Date.now();
    (SFX[type] || SFX.task)(ctx.currentTime + 0.02); return true;
  }

  /* ---------- the Studio radio: an endless lo-fi instrumental, made as it plays ---------- */
  const PROG = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]; // Fmaj7 Em7 Dm7 Cmaj7
  const BPM = 82, SPB = 60 / BPM;
  const M = { on: false, timer: 0, next: 0, step: 0, bar: 0, crackle: null };
  function schedule() {
    while (M.next < ctx.currentTime + 0.25) {
      const t = M.next, s = M.step % 16, bar = Math.floor(M.step / 16), ch = PROG[bar % 4], drums = bar % 8 < 6;
      const swing = s % 2 ? SPB * 0.08 : 0, at = t + swing;
      if (s === 0 || s === 6 || s === 10) ch.forEach((m, i) => tone(bus, at + i * 0.012, hz(m + 12), s === 0 ? 1.9 : 0.9, { type: 'triangle', gain: s === 0 ? 0.09 : 0.06, attack: 0.02, lp: 1600 }));
      if (s === 0 || s === 8) tone(bus, at, hz(ch[0] - 12), 0.8, { gain: 0.22, lp: 400 });
      if (s === 11) tone(bus, at, hz(ch[2] - 12), 0.35, { gain: 0.14, lp: 400 });
      if (drums) {
        if (s === 0 || s === 7 || s === 10) tone(bus, at, 120, 0.28, { to: 42, glide: 0.18, gain: 0.5 });
        if (s === 4 || s === 12) { hiss(bus, at, 0.16, { type: 'bandpass', f: 1800, q: 0.7, gain: 0.12 }); tone(bus, at, 190, 0.08, { gain: 0.08 }); }
        if (s % 2 === 0) hiss(bus, at, 0.04, { f: 8000, gain: s % 4 === 2 ? 0.05 : 0.03 });
      }
      if (s % 4 === 2 && Math.random() < 0.35) { const n = ch[Math.floor(Math.random() * 4)] + 24; tone(bus, at, hz(n), 0.7, { gain: 0.05 }); tone(bus, at, hz(n + 12), 0.4, { gain: 0.012 }); }
      M.next += SPB / 4; M.step++;
    }
  }
  function crackle() {
    const len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.012 + (Math.random() < 0.0004 ? (Math.random() - 0.5) * 0.6 : 0);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(); s.buffer = b; s.loop = true; f.type = 'lowpass'; f.frequency.value = 3500; s.connect(f); f.connect(bus); s.start(); return s;
  }
  const music = {
    get playing() { return M.on; },
    play() { if (!P.music || M.on || !audio()) return false; M.on = true; M.step = 0; M.next = ctx.currentTime + 0.1; bus.gain.cancelScheduledValues(ctx.currentTime); bus.gain.setValueAtTime(0.0001, ctx.currentTime); bus.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.5 * P.mvol), ctx.currentTime + 1.5); M.timer = setInterval(schedule, 40); M.crackle = crackle(); listeners.forEach((f) => f(P)); return true; },
    pause() { if (!M.on) return; M.on = false; clearInterval(M.timer); const t = ctx.currentTime; bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.exponentialRampToValueAtTime(0.0001, t + 0.6); const c = M.crackle; setTimeout(() => { try { c && c.stop(); } catch (e) { /* stopped */ } }, 700); listeners.forEach((f) => f(P)); },
    toggle() { if (M.on) music.pause(); else if (!P.music) ask('music').then((ok) => { if (ok) music.play(); }); else music.play(); },
    volume(v) { P.mvol = Math.max(0, Math.min(1, v)); if (ctx && M.on) bus.gain.setTargetAtTime(Math.max(0.0001, 0.5 * P.mvol), ctx.currentTime, 0.1); save(); }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && M.on) { music.pause(); M.resume = true; } else if (!document.hidden && M.resume) { M.resume = false; music.play(); } });

  /* ---------- asking first ---------- */
  let asking = null;
  function ask(why) {
    if (asking) return asking;
    asking = new Promise((done) => {
      const card = document.createElement('div'); card.className = 'snd-ask'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Sounds on the dashboard');
      card.innerHTML = '<div class="snd-ask-ico" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="snd-ask-tx"><b>Turn on sounds?</b><span>' + (why === 'music' ? 'The Studio radio plays a soft, endless instrumental while you look around. It never plays on its own.' : 'A soft sound when a reminder, mention, task update, award or announcement arrives. Nothing plays until you say yes.') + '</span>' +
        '<label class="sw"><input type="checkbox" data-k="notify"' + (why !== 'music' ? ' checked' : '') + '><span class="sw-ui"></span><span>Notification sounds</span></label>' +
        '<label class="sw"><input type="checkbox" data-k="music"' + (why === 'music' ? ' checked' : '') + '><span class="sw-ui"></span><span>Studio radio (background music)</span></label>' +
        '<div class="snd-ask-act"><button type="button" class="co-btn ghost" data-a="no">Not now</button><button type="button" class="co-btn primary" data-a="yes">Save</button></div><small>Change this any time: bell > Sounds &amp; music.</small></div>';
      document.body.append(card); requestAnimationFrame(() => card.classList.add('in'));
      const fin = (yes) => {
        P.asked = true;
        if (yes) { P.notify = card.querySelector('[data-k="notify"]').checked; P.music = card.querySelector('[data-k="music"]').checked; if (P.notify || P.music) { audio(); if (P.notify) play('mention', true); } }
        save(); card.classList.remove('in'); setTimeout(() => card.remove(), 300); asking = null; done(yes && (why === 'music' ? P.music : P.notify));
      };
      card.querySelector('[data-a="yes"]').addEventListener('click', () => fin(true));
      card.querySelector('[data-a="no"]').addEventListener('click', () => fin(false));
      setTimeout(() => card.querySelector('[data-a="yes"]').focus({ preventScroll: true }), 50);
    });
    return asking;
  }

  /* ---------- settings (bell panel and Studio) ---------- */
  function panel(el) {
    el.replaceChildren();
    const mk = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
    const sw = (label, on, fn, sub) => { const l = mk('label', 'sw'); const i = document.createElement('input'); i.type = 'checkbox'; i.checked = on; i.addEventListener('change', () => fn(i.checked)); l.append(i, mk('span', 'sw-ui'), mk('span', '', label)); if (sub) l.append(mk('small', 'snd-sub', sub)); return l; };
    const slider = (label, v, fn) => { const l = mk('label', 'snd-vol'); l.append(mk('span', '', label)); const r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = 100; r.value = Math.round(v * 100); r.addEventListener('input', () => fn(r.value / 100)); r.setAttribute('aria-label', label); l.append(r); return l; };
    el.append(mk('h3', 'snd-h', 'Sounds & music'));
    el.append(sw('Notification sounds', P.notify, (v) => { P.notify = v; P.asked = true; save(); if (v) play('mention', true); panel(el); }));
    if (P.notify) {
      el.append(slider('Volume', P.vol, (v) => { P.vol = v; if (sfx) sfx.gain.value = 0.32 * v; save(); }));
      const g = mk('div', 'snd-types');
      TYPES.forEach(([k, t, d]) => { const row = mk('div', 'snd-type'); row.append(sw(t, P.types[k], (v) => { P.types[k] = v; save(); })); const b = mk('button', 'co-link', 'Play'); b.type = 'button'; b.title = d; b.addEventListener('click', () => play(k, true)); row.append(b); g.append(row); });
      el.append(g);
    }
    el.append(sw('Studio radio (background music)', P.music, (v) => { P.music = v; P.asked = true; if (!v) music.pause(); save(); panel(el); }, 'Plays only on the Studio page, only when you press play.'));
  }
  window.CO_SOUND = { play, ask, music, panel, prefs: () => P, set(o, remote) { P = Object.assign({}, P, o); P.types = Object.assign({}, DEF.types, P.types || {}); save(remote); }, onSave(fn) { saver = fn; }, on(fn) { listeners.add(fn); return () => listeners.delete(fn); }, TYPES };
})();
