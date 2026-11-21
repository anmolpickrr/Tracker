/* 3D characters (Nov 2026): every teammate as a full-body 3D figure, built from rounded shapes in the browser with
   three.js (MIT), all original. Six looks (clay, vinyl toy, plush, toon, blocky, bean), 19 moves (from a wave and
   a peace sign to the floss, the robot, bhangra and a moonwalk), the tools of their craft floating around them, and
   celebrations for awards. Loaded only when needed (Studio, the character builder).
   API (window.CO_3D after import): view(el, cfg, opts) → { set(cfg), play(move), fx(list), dispose() },
   stage(el, opts) → the Hall of Fame desk scene, crew(slots) → many small live figures on one canvas,
   snap(cfg) → a PNG/WebP data URL of the head and shoulders, MOVES. */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';

const TAU = Math.PI * 2;
const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const C = (c) => new THREE.Color(c);
const lighten = (c, t) => C(c).lerp(C('#ffffff'), t);
const darken = (c, t) => C(c).lerp(C('#000000'), t);

/* ---------- geometry (cached) ---------- */
const GEO = new Map();
const geo = (key, make) => { if (!GEO.has(key)) GEO.set(key, make()); return GEO.get(key); };
function roundedBox(w, h, d, r, s) {
  return geo('rb' + [w, h, d, r, s], () => {
    const g = new THREE.BoxGeometry(w, h, d, s || 6, s || 6, s || 6), p = g.attributes.position, v = new THREE.Vector3(), q = new THREE.Vector3();
    const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); q.set(Math.max(-ix, Math.min(ix, v.x)), Math.max(-iy, Math.min(iy, v.y)), Math.max(-iz, Math.min(iz, v.z)));
      v.sub(q); if (v.lengthSq() > 0) v.normalize().multiplyScalar(r); q.add(v); p.setXYZ(i, q.x, q.y, q.z);
    }
    g.computeVertexNormals(); return g;
  });
}
const sphere = (r, ws, hs, ps, pl, ts, tl) => geo('sp' + [r, ws, hs, ps, pl, ts, tl], () => new THREE.SphereGeometry(r, ws || 32, hs || 20, ps || 0, pl == null ? TAU : pl, ts || 0, tl == null ? Math.PI : tl));
const capsule = (r, l) => geo('ca' + r + ',' + l, () => new THREE.CapsuleGeometry(r, l, 8, 18));
const cyl = (rt, rb, h, s, open) => geo('cy' + [rt, rb, h, s, open], () => new THREE.CylinderGeometry(rt, rb, h, s || 24, 1, !!open));
const torus = (r, t, arc, rs, ts) => geo('to' + [r, t, arc, rs, ts], () => new THREE.TorusGeometry(r, t, rs || 10, ts || 28, arc == null ? TAU : arc));
const cone = (r, h) => geo('co' + r + ',' + h, () => new THREE.ConeGeometry(r, h, 16));

/* ---------- materials per look ---------- */
let GRAD = null;
const gradMap = () => { if (GRAD) return GRAD; const d = new Uint8Array([90, 170, 255]); GRAD = new THREE.DataTexture(d, 3, 1, THREE.RedFormat); GRAD.minFilter = GRAD.magFilter = THREE.NearestFilter; GRAD.needsUpdate = true; return GRAD; };
const MATS = new Map();
function mat(color, style, kind) {
  const key = style + '|' + color + '|' + (kind || '');
  if (MATS.has(key)) return MATS.get(key);
  let m;
  if (kind === 'glass') m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, metalness: 0, transmission: 0.6, transparent: true, opacity: 0.35, clearcoat: 1 });
  else if (kind === 'gloss') m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
  else if (kind === 'emit') m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 });
  else if (kind === 'flat') m = new THREE.MeshBasicMaterial({ color });
  else if (kind === 'metal') m = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.85 });
  else if (style === 'toon') m = new THREE.MeshToonMaterial({ color, gradientMap: gradMap() });
  else if (style === 'vinyl' || style === 'bean') m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.2 });
  else if (style === 'plush') m = new THREE.MeshPhysicalMaterial({ color, roughness: 1, sheen: 1, sheenRoughness: 0.45, sheenColor: lighten(color, 0.5) });
  else m = new THREE.MeshStandardMaterial({ color, roughness: style === 'blocky' ? 0.6 : 0.78 });
  MATS.set(key, m); return m;
}
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x1e1e1e, side: THREE.BackSide });
function M(g, m, x, y, z, parent, o) {
  const mesh = new THREE.Mesh(g, m); mesh.position.set(x || 0, y || 0, z || 0); mesh.castShadow = true; mesh.receiveShadow = false;
  if (o) { if (o.s) mesh.scale.set(o.s[0], o.s[1], o.s[2]); if (o.r) mesh.rotation.set(o.r[0], o.r[1], o.r[2]); }
  if (parent) parent.add(mesh); return mesh;
}
const G = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); if (parent) parent.add(g); return g; };

/* ---------- the figure ---------- */
const DEF = { style: 'clay', skin: '#e9b48a', hair: 'short', hairColor: '#3b2a20', eyes: 'dot', brows: 'soft', mouth: 'smile', face: 'none', glasses: 'none', head: 'none', outfit: 'hoodie', outfitColor: '#685bc7', pants: '#2b3a55', shoes: '#f0eee9', gloves: 'none', bg: '#ddff00', gear: ['laptop'], move: 'wave' };
export function norm(c) { const o = Object.assign({}, DEF, c || {}); if (!Array.isArray(o.gear)) o.gear = []; o.gear = o.gear.slice(0, 4); return o; }

function build(cfg0) {
  const c = norm(cfg0), st = c.style, S = (col, k) => mat(col, st, k);
  const skin = S(c.skin), hairM = S(c.hairColor), cloth = S(c.outfitColor), pants = S(c.outfit === 'overalls' ? '#3a6fb0' : c.pants), ink = mat('#1e1e1e', st, 'gloss'), white = S('#ffffff');
  const hand = c.gloves === 'white' ? S('#f7f5f0') : skin;
  const blocky = st === 'blocky', bean = st === 'bean';
  const root = new THREE.Group(), J = {};
  J.root = root;
  const hipsY = bean ? 0.5 : 0.72;
  J.hips = G(root, 0, hipsY, 0);
  J.spine = G(J.hips, 0, 0.02, 0);
  // torso
  if (blocky) M(roundedBox(0.74, 0.74, 0.5, 0.1), cloth, 0, 0.36, 0, J.spine);
  else if (bean) M(capsule(0.48, 0.5), cloth, 0, 0.5, 0, J.spine, { s: [1, 1, 0.9] });
  else M(capsule(0.36, 0.3), cloth, 0, 0.34, 0, J.spine, { s: [1, 1, 0.82] });
  J.chest = G(J.spine, 0, bean ? 0.62 : 0.56, 0);
  // outfit details
  const oc = c.outfitColor, det = S(lighten(oc, 0.35).getStyle()), dk = S(darken(oc, 0.2).getStyle());
  if (c.outfit === 'hoodie') { M(torus(0.24, 0.11), cloth, 0, 0.12, -0.12, J.chest, { r: [1.2, 0, 0] }); M(cyl(0.012, 0.012, 0.22), det, -0.08, -0.05, 0.31, J.chest); M(cyl(0.012, 0.012, 0.22), det, 0.08, -0.05, 0.31, J.chest); M(roundedBox(0.36, 0.14, 0.06, 0.03), dk, 0, -0.38, 0.28, J.chest); }
  if (c.outfit === 'tee') M(torus(0.13, 0.03), dk, 0, 0.13, 0.02, J.chest, { r: [Math.PI / 2, 0, 0] });
  if (c.outfit === 'shirt') { M(roundedBox(0.16, 0.08, 0.04, 0.02), det, -0.08, 0.1, 0.24, J.chest, { r: [0, 0, 0.5] }); M(roundedBox(0.16, 0.08, 0.04, 0.02), det, 0.08, 0.1, 0.24, J.chest, { r: [0, 0, -0.5] }); [-0.05, -0.18, -0.31].forEach((y) => M(sphere(0.022, 10, 8), det, 0, y, 0.3, J.chest)); }
  if (c.outfit === 'jacket') { M(roundedBox(0.2, 0.5, 0.06, 0.03), S(C(oc).getHSL({}).l > 0.5 ? '#1e1e1e' : '#f0eee9'), 0, -0.18, 0.27, J.chest); M(roundedBox(0.1, 0.36, 0.05, 0.02), dk, -0.13, -0.08, 0.29, J.chest, { r: [0, 0, 0.25] }); M(roundedBox(0.1, 0.36, 0.05, 0.02), dk, 0.13, -0.08, 0.29, J.chest, { r: [0, 0, -0.25] }); }
  if (c.outfit === 'sweater') { M(torus(0.15, 0.045), dk, 0, 0.12, 0.02, J.chest, { r: [Math.PI / 2, 0, 0] }); M(torus(0.34, 0.04), dk, 0, -0.5, 0, J.chest, { r: [Math.PI / 2, 0, 0], s: [1, 0.82, 1] }); }
  if (c.outfit === 'turtleneck') M(cyl(0.15, 0.17, 0.16), cloth, 0, 0.16, 0, J.chest);
  if (c.outfit === 'overalls') { M(roundedBox(0.4, 0.3, 0.06, 0.04), pants, 0, -0.32, 0.27, J.chest); M(roundedBox(0.06, 0.34, 0.04, 0.02), pants, -0.15, -0.1, 0.27, J.chest); M(roundedBox(0.06, 0.34, 0.04, 0.02), pants, 0.15, -0.1, 0.27, J.chest); M(sphere(0.025, 10, 8), S('#ffd36b', 'metal'), -0.15, -0.2, 0.3, J.chest); M(sphere(0.025, 10, 8), S('#ffd36b', 'metal'), 0.15, -0.2, 0.3, J.chest); }
  if (c.gear.includes('bag')) { M(roundedBox(0.44, 0.5, 0.22, 0.1), S('#e8673a'), 0, -0.22, -0.36, J.chest); M(roundedBox(0.3, 0.16, 0.06, 0.05), S('#d15528'), 0, -0.32, -0.49, J.chest); M(torus(0.27, 0.03, Math.PI), S('#c44d22'), -0.22, -0.1, -0.05, J.chest, { r: [0, Math.PI / 2, 0], s: [1, 1.3, 1] }); M(torus(0.27, 0.03, Math.PI), S('#c44d22'), 0.22, -0.1, -0.05, J.chest, { r: [0, Math.PI / 2, 0], s: [1, 1.3, 1] }); }
  // neck and head
  J.neck = G(J.chest, 0, bean ? 0.02 : 0.14, 0);
  if (!bean) M(cyl(0.1, 0.11, 0.14), skin, 0, 0.02, 0, J.neck);
  J.head = G(J.neck, 0, bean ? 0.42 : 0.56, 0);
  const H = J.head, hr = 0.55;
  if (blocky) M(roundedBox(1.04, 0.98, 0.94, 0.14), skin, 0, 0, 0, H); else M(sphere(hr, 48, 32), skin, 0, 0, 0, H, { s: [1, 0.95, 0.92] });
  const fz = blocky ? 0.475 : 0.47; // face front
  // ears
  [-1, 1].forEach((sx) => M(sphere(0.1, 16, 12), skin, sx * (blocky ? 0.52 : 0.53), 0, -0.02, H, { s: [0.55, 1, 0.8] }));
  // eyes (blink by scaling the group)
  J.eyes = G(H, 0, 0.03, fz);
  const eye = (x, kind) => {
    const g = G(J.eyes, x, 0, 0);
    if (kind === 'happy' || kind === 'sleepy') { M(torus(0.07, 0.018, Math.PI, 8, 16), ink, 0, kind === 'happy' ? -0.03 : 0.02, 0.01, g, { r: [0, 0, kind === 'happy' ? 0 : Math.PI] }); g.userData.still = true; return; }
    if (kind === 'round' || kind === 'anime') {
      const big = kind === 'anime'; M(sphere(big ? 0.13 : 0.1, 20, 16), white, 0, 0, -0.03, g, { s: [big ? 0.85 : 1, big ? 1.2 : 1.05, 0.45] });
      if (big) M(sphere(0.085, 20, 16), mat(c.hairColor === '#1e1e1e' ? '#6b4423' : c.hairColor, st, 'gloss'), 0.01, -0.01, 0.025, g, { s: [1, 1.15, 0.4] });
      M(sphere(big ? 0.055 : 0.065, 18, 14), ink, 0.01, -0.01, 0.035, g, { s: [1, 1.1, 0.4] });
      M(sphere(0.022, 10, 8), mat('#ffffff', st, 'flat'), 0.035, 0.035, 0.06, g); if (big) M(sphere(0.012, 8, 6), mat('#ffffff', st, 'flat'), -0.02, -0.05, 0.06, g); return;
    }
    M(sphere(kind === 'sparkle' ? 0.075 : 0.06, 18, 14), ink, 0, 0, 0, g, { s: [0.85, 1.15, 0.5] });
    M(sphere(kind === 'sparkle' ? 0.026 : 0.02, 10, 8), mat('#ffffff', st, 'flat'), 0.022, 0.03, 0.03, g);
    if (kind === 'sparkle') M(sphere(0.012, 8, 6), mat('#ffffff', st, 'flat'), -0.02, -0.03, 0.03, g);
  };
  const eL = c.eyes === 'wink' ? 'dot' : c.eyes, eR = c.eyes === 'wink' ? 'happy' : c.eyes;
  eye(-0.19, eL); eye(0.19, eR);
  // brows
  if (c.brows !== 'none') { const by = c.brows === 'raised' ? 0.2 : 0.16, bw = c.brows === 'bold' ? 0.032 : 0.02, bm = S(c.hairColor); [-1, 1].forEach((sx) => M(capsule(bw, 0.09), bm, sx * 0.19, by, fz - 0.01, H, { r: [0, 0, Math.PI / 2 + sx * (c.brows === 'raised' ? 0.25 : 0.1)] })); }
  // nose, cheeks, mouth
  M(sphere(0.045, 12, 10), S(darken(c.skin, 0.08).getStyle()), 0, -0.08, fz + 0.04, H);
  const blush = new THREE.MeshStandardMaterial({ color: '#ff7a8a', transparent: true, opacity: 0.35, roughness: 1 });
  [-1, 1].forEach((sx) => M(sphere(0.08, 14, 10), blush, sx * 0.3, -0.1, fz - 0.06, H, { s: [1, 0.6, 0.3] }));
  J.mouth = G(H, 0, -0.2, fz + 0.01);
  const mouth = c.mouth;
  if (mouth === 'grin' || mouth === 'tongue') { M(sphere(0.1, 20, 12, 0, TAU, Math.PI / 2, Math.PI / 2), ink, 0, 0.02, 0, J.mouth, { s: [1, 0.9, 0.35] }); M(roundedBox(0.15, 0.035, 0.03, 0.012), white, 0, 0.0, 0.02, J.mouth); if (mouth === 'tongue') M(sphere(0.05, 14, 10), mat('#ff7a8a', st), 0.02, -0.06, 0.02, J.mouth, { s: [1, 0.7, 0.5] }); }
  else if (mouth === 'o') M(torus(0.04, 0.018), ink, 0, -0.01, 0, J.mouth);
  else if (mouth === 'flat') M(capsule(0.016, 0.08), ink, 0, 0, 0, J.mouth, { r: [0, 0, Math.PI / 2] });
  else if (mouth === 'smirk') M(torus(0.08, 0.017, Math.PI * 0.7), ink, 0.02, 0.05, 0, J.mouth, { r: [0, 0, Math.PI + 0.5] });
  else M(torus(0.085, 0.018, Math.PI), ink, 0, 0.05, 0, J.mouth, { r: [0, 0, Math.PI] });
  // facial hair
  if (c.face === 'beard') M(sphere(0.56, 32, 16, 0, TAU, Math.PI * 0.56, Math.PI * 0.32), hairM, 0, 0.02, 0.02, H, { s: [1, 0.98, 0.95] });
  if (c.face === 'mustache') [-1, 1].forEach((sx) => M(capsule(0.025, 0.07), hairM, sx * 0.05, -0.13, fz + 0.03, H, { r: [0, 0, Math.PI / 2 - sx * 0.35] }));
  if (c.face === 'stubble') { const sb = new THREE.MeshStandardMaterial({ color: c.hairColor, transparent: true, opacity: 0.22, roughness: 1 }); M(sphere(0.555, 32, 16, 0, TAU, Math.PI * 0.6, Math.PI * 0.3), sb, 0, 0, 0, H, { s: [1, 0.95, 0.93] }); }
  if (c.face === 'freckles') { const fm = mat(darken(c.skin, 0.35).getStyle(), st, 'flat'); [[-0.3, -0.05], [-0.25, -0.1], [-0.33, -0.12], [0.3, -0.05], [0.25, -0.1], [0.33, -0.12]].forEach(([x, y]) => M(sphere(0.012, 6, 6), fm, x, y, fz - 0.07, H)); }
  // hair
  const cap = (th, rx, r) => { const m = M(sphere(r || 0.58, 40, 24, 0, TAU, 0, Math.PI * th), hairM, 0, 0.02, 0, H, { s: [1, 0.96, 0.95], r: [rx, 0, 0] }); return m; };
  const fib = (n, f) => { const out = []; for (let i = 0; i < n; i++) { const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996; const p = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r); if (f(p)) out.push(p); } return out; };
  const hs = c.hair;
  if (blocky && hs !== 'bald') M(roundedBox(1.1, 0.34, 1.0, 0.1), hairM, 0, 0.42, -0.04, H);
  else if (hs === 'short') { cap(0.42, -0.4); M(capsule(0.07, 0.24), hairM, -0.1, 0.4, 0.38, H, { r: [0.6, 0, 1.2] }); }
  else if (hs === 'buzz') cap(0.48, -0.25, 0.565);
  else if (hs === 'sidepart') { cap(0.44, -0.38); M(capsule(0.1, 0.36), hairM, 0.12, 0.38, 0.34, H, { r: [0.5, 0, -1.25] }); }
  else if (hs === 'curly') { cap(0.4, -0.3); fib(70, (p) => p.y > 0.05 && (p.z < 0.55 || p.y > 0.55)).forEach((p) => M(sphere(0.13, 12, 10), hairM, p.x * 0.58, p.y * 0.56 + 0.04, p.z * 0.56, H)); }
  else if (hs === 'afro') { cap(0.45, -0.35); fib(120, (p) => p.y > -0.25 && (p.z < 0.25 || p.y > 0.6)).forEach((p) => M(sphere(0.2, 12, 10), hairM, p.x * 0.66, p.y * 0.62 + 0.1, p.z * 0.64 - 0.05, H)); }
  else if (hs === 'wavy') { cap(0.45, -0.35); [-1, 1].forEach((sx) => { M(capsule(0.1, 0.36), hairM, sx * 0.5, -0.12, -0.06, H, { r: [0.1, 0, sx * 0.08] }); M(sphere(0.12, 12, 10), hairM, sx * 0.52, -0.36, -0.02, H); }); }
  else if (hs === 'long') { cap(0.46, -0.32); M(roundedBox(1.08, 1.05, 0.32, 0.15), hairM, 0, -0.32, -0.3, H); [-1, 1].forEach((sx) => M(capsule(0.11, 0.6), hairM, sx * 0.5, -0.32, 0.05, H, { r: [0.08, 0, 0] })); }
  else if (hs === 'bob') { cap(0.46, -0.3); [-1, 1].forEach((sx) => M(roundedBox(0.2, 0.6, 0.7, 0.09), hairM, sx * 0.5, -0.12, -0.05, H)); M(roundedBox(1.1, 0.5, 0.35, 0.15), hairM, 0, -0.08, -0.32, H); }
  else if (hs === 'bun') { cap(0.44, -0.32); M(sphere(0.2, 20, 16), hairM, 0, 0.6, -0.12, H); }
  else if (hs === 'ponytail') { cap(0.44, -0.32); M(sphere(0.12, 14, 12), S(c.outfitColor), 0, 0.22, -0.56, H); M(capsule(0.13, 0.42), hairM, 0, -0.12, -0.62, H, { r: [0.25, 0, 0] }); }
  else if (hs === 'spiky') { cap(0.42, -0.3); fib(40, (p) => p.y > 0.25 && p.z < 0.6).forEach((p) => { const m = M(cone(0.09, 0.3), hairM, p.x * 0.58, p.y * 0.56 + 0.05, p.z * 0.56, H); m.lookAt(m.position.clone().multiplyScalar(3).add(H.getWorldPosition(new THREE.Vector3()))); m.rotateX(Math.PI / 2); }); }
  else if (hs === 'bald') M(sphere(0.07, 12, 8), mat('#ffffff', st, 'flat'), -0.18, 0.4, 0.3, H, { s: [1, 0.4, 0.3] }).material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25 });
  // headwear
  const hw = c.head;
  if (hw === 'headphones') { const hp = S(darken(oc, 0.35).getStyle()); M(torus(0.6, 0.045, Math.PI), hp, 0, 0.02, -0.02, H); [-1, 1].forEach((sx) => { M(cyl(0.15, 0.15, 0.12), S(darken(oc, 0.2).getStyle()), sx * 0.58, 0.0, 0, H, { r: [0, 0, Math.PI / 2] }); M(cyl(0.11, 0.11, 0.02), mat('#ddff00', st, 'emit'), sx * 0.65, 0, 0, H, { r: [0, 0, Math.PI / 2] }); }); }
  if (hw === 'beanie') { M(sphere(0.6, 32, 16, 0, TAU, 0, Math.PI / 2), cloth, 0, 0.1, -0.02, H, { r: [-0.2, 0, 0] }); M(torus(0.56, 0.08), dk, 0, 0.12, 0, H, { r: [Math.PI / 2 - 0.2, 0, 0] }); M(sphere(0.12, 14, 10), det, 0, 0.72, -0.1, H); }
  if (hw === 'cap') { M(sphere(0.59, 32, 16, 0, TAU, 0, Math.PI / 2), cloth, 0, 0.1, -0.02, H, { r: [-0.15, 0, 0] }); M(roundedBox(0.6, 0.04, 0.42, 0.02), dk, 0, 0.18, 0.6, H, { r: [0.15, 0, 0] }); }
  if (hw === 'beret') M(sphere(0.55, 32, 16), S('#1e1e1e'), 0.05, 0.45, -0.05, H, { s: [1.1, 0.3, 1.05], r: [-0.2, 0, -0.18] });
  if (hw === 'bandana') M(torus(0.56, 0.07), cloth, 0, 0.2, 0, H, { r: [Math.PI / 2 - 0.2, 0, 0] });
  if (c.gear.includes('pencil')) { const pg = G(H, 0.5, 0.25, 0.1); pg.rotation.set(0, 0, -0.9); M(cyl(0.03, 0.03, 0.4, 6), S('#f5c542'), 0, 0, 0, pg); M(cone(0.03, 0.08), S('#e9b48a'), 0, 0.24, 0, pg); M(cyl(0.032, 0.032, 0.06), S('#ff8aa0'), 0, -0.22, 0, pg); }
  if (c.gear.includes('earphones')) [-1, 1].forEach((sx) => M(sphere(0.05, 12, 10), S('#ffffff'), sx * 0.56, -0.05, 0.08, H));
  // glasses
  const gl = c.glasses;
  if (gl !== 'none') {
    const gg = G(H, 0, 0.03, fz + 0.06), frame = gl === 'retro' ? S('#8a4b2a') : gl === 'visor' ? S('#c7e600') : ink;
    if (gl === 'visor') M(cyl(0.62, 0.62, 0.17, 32, true), mat('#ddff00', st, 'emit'), 0, 0, -0.56, gg, { r: [0, 0, 0] }).material = new THREE.MeshPhysicalMaterial({ color: '#ddff00', emissive: '#a8c400', emissiveIntensity: 0.4, transparent: true, opacity: 0.85, roughness: 0.1, side: THREE.DoubleSide });
    else {
      [-1, 1].forEach((sx) => {
        const tube = gl === 'retro' ? 0.032 : 0.02;
        if (gl === 'round') M(torus(0.12, tube, TAU, 8, 24), frame, sx * 0.19, 0, 0, gg);
        else M(torus(0.13, tube, TAU, 8, 4), frame, sx * 0.19, 0, 0, gg, { r: [0, 0, Math.PI / 4], s: [1.15, 0.85, 1] });
        if (gl === 'sun') M(cyl(0.12, 0.12, 0.015, 24), mat('#141414', st, 'gloss'), sx * 0.19, 0, 0, gg, { r: [Math.PI / 2, 0, 0] });
        else M(cyl(0.11, 0.11, 0.008, 20), mat('#ffffff', st, 'glass'), sx * 0.19, 0, 0, gg, { r: [Math.PI / 2, 0, 0] });
        M(cyl(0.012, 0.012, 0.45, 6), frame, sx * 0.34, 0, -0.22, gg, { r: [Math.PI / 2, 0, 0] });
      });
      M(torus(0.05, 0.014, Math.PI), frame, 0, 0.0, 0, gg);
    }
  }
  // arms: shoulder → upper arm → elbow → forearm → hand with fingers
  const sleeveFull = c.outfit !== 'tee' && c.outfit !== 'overalls';
  const arm = (sx) => {
    const sh = G(J.chest, sx * (bean ? 0.46 : 0.38), bean ? -0.1 : 0.0, 0);
    if (blocky) M(roundedBox(0.2, 0.34, 0.2, 0.06), cloth, 0, -0.14, 0, sh); else M(capsule(0.1, 0.18), cloth, 0, -0.14, 0, sh);
    const el = G(sh, 0, -0.3, 0);
    if (blocky) M(roundedBox(0.18, 0.3, 0.18, 0.06), sleeveFull ? cloth : skin, 0, -0.13, 0, el); else M(capsule(0.085, 0.16), sleeveFull ? cloth : skin, 0, -0.13, 0, el);
    if (c.outfit === 'sweater' || c.outfit === 'hoodie') M(torus(0.085, 0.03), dk, 0, -0.25, 0, el, { r: [Math.PI / 2, 0, 0] });
    const hd = G(el, 0, -0.3, 0);
    M(sphere(0.1, 18, 14), hand, 0, 0, 0, hd, { s: [1, 0.95, 0.72] });
    const fingers = [];
    [-0.055, -0.018, 0.018, 0.055].forEach((fx, i) => { const f = G(hd, fx, -0.06, 0.02); M(capsule(0.026, 0.06 - (i === 3 ? 0.015 : 0)), hand, 0, -0.04, 0, f); fingers.push(f); });
    const th = G(hd, sx * -0.07, -0.01, 0.05); M(capsule(0.028, 0.05), hand, 0, -0.035, 0, th); th.rotation.z = sx * 0.7;
    return { sh, el, hd, fingers, th };
  };
  J.L = arm(1); J.R = arm(-1);
  // legs
  const leg = (sx) => {
    const th = G(J.hips, sx * 0.15, 0.02, 0);
    if (blocky) M(roundedBox(0.26, 0.34, 0.26, 0.06), pants, 0, -0.16, 0, th); else M(capsule(0.13, bean ? 0.08 : 0.17), pants, 0, -0.16, 0, th);
    const kn = G(th, 0, bean ? -0.2 : -0.34, 0);
    if (blocky) M(roundedBox(0.24, 0.3, 0.24, 0.06), pants, 0, -0.12, 0, kn); else M(capsule(0.12, bean ? 0.04 : 0.14), pants, 0, -0.12, 0, kn);
    const ft = G(kn, 0, bean ? -0.2 : -0.3, 0.04);
    M(roundedBox(0.24, 0.13, 0.36, 0.06), S(c.shoes), 0, 0, 0.03, ft); M(roundedBox(0.25, 0.04, 0.37, 0.02), S('#fafafa'), 0, -0.065, 0.03, ft); M(roundedBox(0.2, 0.02, 0.08, 0.01), S(darken(c.shoes, 0.25).getStyle()), 0, 0.07, 0.1, ft);
    return { th, kn, ft };
  };
  J.LL = leg(1); J.RL = leg(-1);
  // toon outlines
  if (st === 'toon') root.traverse((o) => { if (o.isMesh && o.material !== OUTLINE && !o.userData.ol && o.geometry.boundingSphere !== undefined) { const ol = new THREE.Mesh(o.geometry, OUTLINE); ol.scale.setScalar(1.045); ol.userData.ol = true; o.add(ol); } });
  root.userData.cfg = c;
  return { root, J, cfg: c };
}

/* ---------- props: the tools of each craft ---------- */
function prop(kind, st) {
  const S = (col, k) => mat(col, st === 'toon' ? 'toon' : 'vinyl', k), g = new THREE.Group();
  const add = (geo0, m, x, y, z, o) => M(geo0, m, x, y, z, g, o);
  if (kind === 'laptop') { add(roundedBox(0.7, 0.04, 0.48, 0.02), S('#cfcac0'), 0, 0, 0); const lid = G(g, 0, 0.02, -0.23); lid.rotation.x = -0.25; M(roundedBox(0.7, 0.46, 0.03, 0.02), S('#cfcac0'), 0, 0.23, 0, lid); M(roundedBox(0.62, 0.38, 0.01, 0.01), mat('#685bc7', 'x', 'emit'), 0, 0.23, 0.02, lid); M(roundedBox(0.4, 0.12, 0.012, 0.01), mat('#ddff00', 'x', 'emit'), -0.05, 0.25, 0.026, lid); }
  if (kind === 'tablet') { add(roundedBox(0.5, 0.66, 0.04, 0.05), S('#2b2926'), 0, 0, 0); add(roundedBox(0.44, 0.58, 0.01, 0.03), mat('#8fd3ff', 'x', 'emit'), 0, 0, 0.022); add(torus(0.08, 0.015, TAU * 0.6), mat('#685bc7', 'x', 'flat'), 0, 0.02, 0.03, { r: [0, 0, 1] }); const p = add(cyl(0.02, 0.02, 0.5, 10), S('#f0eee9'), 0.36, -0.05, 0.05, { r: [0, 0, 0.4] }); p.add(M(cone(0.02, 0.06), S('#1e1e1e'), 0, -0.28, 0)); }
  if (kind === 'camera') { add(roundedBox(0.56, 0.38, 0.28, 0.07), S('#2b2926'), 0, 0, 0); add(cyl(0.15, 0.17, 0.22, 28), S('#4a4743'), 0, 0, 0.22, { r: [Math.PI / 2, 0, 0] }); add(cyl(0.11, 0.11, 0.02, 24), mat('#3a7bd5', 'x', 'gloss'), 0, 0, 0.34, { r: [Math.PI / 2, 0, 0] }); add(sphere(0.035, 12, 10), mat('#ff5a26', 'x', 'emit'), 0.2, 0.15, 0.14); add(roundedBox(0.16, 0.08, 0.12, 0.03), S('#2b2926'), -0.14, 0.22, 0); }
  if (kind === 'clapper') { add(roundedBox(0.6, 0.4, 0.05, 0.02), S('#1e1e1e'), 0, 0, 0); const top = G(g, -0.3, 0.22, 0); top.rotation.z = 0.35; M(roundedBox(0.6, 0.1, 0.05, 0.02), S('#f0eee9'), 0.3, 0.05, 0, top); [0.1, 0.25, 0.4, 0.55].forEach((x) => M(roundedBox(0.06, 0.1, 0.055, 0.005), S('#1e1e1e'), x, 0.05, 0, top, { r: [0, 0, 0.6] })); [0.05, -0.08].forEach((y) => add(roundedBox(0.46, 0.02, 0.01, 0.005), mat('#f0eee9', 'x', 'flat'), 0, y, 0.03)); g.userData.flap = top; }
  if (kind === 'mic') { add(sphere(0.13, 20, 16), S('#6a6760', 'metal'), 0, 0.3, 0); add(cyl(0.05, 0.06, 0.4, 16), S('#2b2926'), 0, 0, 0); add(torus(0.14, 0.02), S('#2b2926'), 0, 0.22, 0, { r: [Math.PI / 2, 0, 0] }); }
  if (kind === 'mug') { add(cyl(0.16, 0.14, 0.3, 28), S('#ff5a26'), 0, 0, 0); add(torus(0.08, 0.025, Math.PI), S('#ff5a26'), 0.17, 0, 0, { r: [0, 0, -Math.PI / 2] }); add(cyl(0.14, 0.14, 0.01, 24), S('#5a3520'), 0, 0.14, 0); }
  if (kind === 'sketchbook') { add(roundedBox(0.46, 0.06, 0.6, 0.02), S('#f5c542'), 0, 0, 0); add(roundedBox(0.44, 0.065, 0.58, 0.01), S('#fffdf5'), 0.01, 0, 0); add(torus(0.08, 0.012), mat('#1e1e1e', 'x', 'flat'), 0, 0.04, 0, { r: [Math.PI / 2, 0, 0] }); }
  if (kind === 'book') { ['#685bc7', '#ff5a26', '#2fb37a'].forEach((col, i) => add(roundedBox(0.5 - i * 0.04, 0.1, 0.36, 0.02), S(col), i * 0.02, i * 0.105, 0, { r: [0, i * 0.15, 0] })); }
  if (kind === 'typewriter') { add(roundedBox(0.62, 0.22, 0.46, 0.06), S('#3a6fb0'), 0, 0, 0); add(cyl(0.05, 0.05, 0.66, 16), S('#1e1e1e'), 0, 0.15, -0.16, { r: [0, 0, Math.PI / 2] }); add(roundedBox(0.4, 0.34, 0.01, 0.005), S('#fffdf5'), 0, 0.32, -0.18, { r: [-0.2, 0, 0] }); for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) add(cyl(0.025, 0.025, 0.03, 10), S('#f0eee9'), -0.2 + k * 0.08 + r * 0.02, 0.12 + r * 0.02, 0.08 + r * -0.07); }
  if (kind === 'notebook') { add(roundedBox(0.36, 0.04, 0.48, 0.02), S('#e86aa6'), 0, 0, 0); const p = add(cyl(0.02, 0.02, 0.46, 10), S('#1e1e1e'), 0.24, 0.04, 0, { r: [Math.PI / 2, 0, 0.3] }); }
  if (kind === 'palette') { add(cyl(0.34, 0.34, 0.04, 32), S('#d9a06a'), 0, 0, 0, { s: [1, 1, 0.75] }); ['#ff5a26', '#ddff00', '#685bc7', '#2fb37a', '#e86aa6'].forEach((col, i) => { const a = -0.4 + i * 0.5; add(sphere(0.06, 14, 10), S(col), Math.cos(a) * 0.22, 0.03, Math.sin(a) * 0.17, { s: [1, 0.5, 1] }); }); add(cyl(0.06, 0.06, 0.06, 16), mat('#1e1e1e', 'x', 'flat'), -0.18, 0.0, -0.08); }
  if (kind === 'plant') { add(cyl(0.16, 0.12, 0.26, 24), S('#e86aa6'), 0, 0, 0); for (let i = 0; i < 5; i++) { const l = add(sphere(0.1, 14, 10), S('#2fb37a'), Math.cos(i * 1.3) * 0.08, 0.22 + i * 0.03, Math.sin(i * 1.3) * 0.08, { s: [0.5, 1.4, 0.3] }); l.rotation.z = Math.cos(i * 1.3) * 0.6; l.rotation.x = Math.sin(i * 1.3) * 0.6; } }
  if (kind === 'trophy') { add(cyl(0.2, 0.08, 0.3, 28, false), S('#f5c542', 'metal'), 0, 0.3, 0); [-1, 1].forEach((sx) => add(torus(0.08, 0.02, Math.PI), S('#f5c542', 'metal'), sx * 0.2, 0.33, 0, { r: [0, 0, sx * Math.PI / 2] })); add(cyl(0.03, 0.03, 0.15, 12), S('#f5c542', 'metal'), 0, 0.08, 0); add(roundedBox(0.24, 0.08, 0.24, 0.02), S('#1e1e1e'), 0, 0, 0); }
  if (kind === 'reel') { add(cyl(0.3, 0.3, 0.06, 32), S('#2b2926'), 0, 0, 0, { r: [Math.PI / 2, 0, 0] }); for (let i = 0; i < 5; i++) add(cyl(0.06, 0.06, 0.07, 16), S('#ddff00'), Math.cos(i * TAU / 5) * 0.17, Math.sin(i * TAU / 5) * 0.17, 0, { r: [Math.PI / 2, 0, 0] }); }
  g.userData.kind = kind; return g;
}

/* ---------- moves ---------- */
export const MOVES = [['idle', 'Chill'], ['wave', 'Wave'], ['peace', 'Peace sign'], ['thumbs', 'Thumbs up'], ['heart', 'Heart hands'], ['clap', 'Clap-along'], ['dab', 'Dab'], ['floss', 'Floss'], ['robot', 'Robot'], ['disco', 'Disco point'], ['bhangra', 'Bhangra'], ['shimmy', 'Shoulder shimmy'], ['runningman', 'Running man'], ['moonwalk', 'Moonwalk'], ['horse', 'Horse ride'], ['fastfeet', 'Fast feet'], ['fistpump', 'Fist pump'], ['victory', 'Victory jump'], ['spin', 'Spin']];
const rest = () => ({ ry: 0, y: 0, z: 0, rz: 0, hips: [0, 0, 0], spine: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], L: [0, 0, 0.12], Le: [-0.15, 0, 0], R: [0, 0, -0.12], Re: [-0.15, 0, 0], LL: [0, 0, 0], Lk: [0, 0, 0], RL: [0, 0, 0], Rk: [0, 0, 0], hl: 'open', hr: 'open' });
function pose(name, t) {
  const p = rest(), s = Math.sin, co = Math.cos, b = t * TAU * (112 / 60) / 2, a = Math.abs;
  p.spine[0] = 0.02 * s(t * 2); p.head[1] = 0.12 * s(t * 0.6); p.head[0] = 0.04 * s(t * 0.9);
  switch (name) {
    case 'wave': p.R = [0, 0, -2.6]; p.Re = [0, 0, -0.25 + 0.45 * s(t * 9)]; p.head = [0, 0.1, -0.12]; p.spine[2] = -0.05; p.L = [0, 0, 0.2]; break;
    case 'peace': p.R = [-0.55, 0.2, -0.65]; p.Re = [-2.3, 0, 0]; p.hr = 'peace'; p.head = [0.05, 0.18, 0.16 + 0.04 * s(t * 2)]; p.spine[2] = 0.06; p.L = [0, 0, 0.25]; p.y = 0.01 * s(t * 4); break;
    case 'thumbs': p.R = [-1.1, 0, -0.25]; p.Re = [-0.7, 0, 0]; p.hr = 'thumb'; p.L = [-1.1, 0, 0.25]; p.Le = [-0.7, 0, 0]; p.hl = 'thumb'; p.y = 0.04 * a(s(b)); p.head[0] = -0.1; break;
    case 'heart': p.L = [0, 0, 2.5]; p.Le = [0, 0, 1.15]; p.R = [0, 0, -2.5]; p.Re = [0, 0, -1.15]; p.hips[2] = 0.08 * s(b / 2); p.head[2] = -0.12 * s(b / 2); p.y = 0.03 * a(s(b)); break;
    case 'clap': { const k = a(s(b)); p.L = [-1.2, 0, 0.55 - 0.45 * k]; p.Le = [-0.5, 0, 0]; p.R = [-1.2, 0, -0.55 + 0.45 * k]; p.Re = [-0.5, 0, 0]; p.y = 0.05 * k; p.head[0] = -0.05 + 0.08 * k; break; }
    case 'dab': { const on = (t % 2.4) < 1.6; if (on) { p.R = [0, 0, -2.2]; p.Re = [0, 0, 0]; p.L = [-1.7, -0.3, -0.5]; p.Le = [-1.9, 0, 0]; p.head = [0.55, 0.35, 0.25]; p.spine = [0.18, 0.2, 0.08]; p.y = -0.03; } else { p.L = [0, 0, 0.3]; p.R = [0, 0, -0.3]; } break; }
    case 'floss': { const k = s(b * 2); p.L = [0.35 * co(b * 2), 0, 0.45 + 0.4 * k]; p.R = [-0.35 * co(b * 2), 0, -0.45 + 0.4 * k]; p.Le = p.Re = [0, 0, 0]; p.hips = [0, 0, -0.18 * k]; p.z = 0; p.ry = 0; p.rz = -0.06 * k; p.LL = [0, 0, -0.1 * k]; p.RL = [0, 0, -0.1 * k]; break; }
    case 'robot': { const q = Math.floor(t * 2.5) % 4, P = [[1.6, 0], [0, 1.6], [1.2, 1.2], [0.2, 0.2]][q]; p.L = [0, 0, P[0] > 1 ? 1.5 : 0.2]; p.Le = [-1.57, 0, 0]; p.R = [0, 0, P[1] > 1 ? -1.5 : -0.2]; p.Re = [-1.57, 0, 0]; p.head = [0, [0.5, -0.5, 0, 0][q], 0]; p.hl = p.hr = 'flat'; p.spine = [0, [0.2, -0.2, 0, 0][q], 0]; break; }
    case 'disco': { const up = s(b / 2) > 0; p.R = up ? [0, 0, -2.7] : [0, 0, -0.55]; p.Re = [0, 0, 0]; p.hr = 'point'; p.L = [0, 0, 0.6]; p.Le = [-1.6, 0, 0]; p.hips = [0, 0, up ? 0.12 : -0.12]; p.head = [0, 0, up ? -0.25 : 0.2]; p.RL = [0, 0, up ? -0.25 : 0]; p.y = 0.02 * a(s(b)); break; }
    case 'bhangra': { const k = s(b), up = a(s(b)); p.L = [0, 0, 2.6 + 0.15 * k]; p.Le = [0, 0, 0.3]; p.R = [0, 0, -2.6 + 0.15 * k]; p.Re = [0, 0, -0.3]; p.hl = p.hr = 'point'; p.y = 0.08 * up; p.LL = [-0.9 * Math.max(0, k), 0, 0]; p.Lk = [1.3 * Math.max(0, k), 0, 0]; p.RL = [-0.9 * Math.max(0, -k), 0, 0]; p.Rk = [1.3 * Math.max(0, -k), 0, 0]; p.head = [0, 0.2 * k, 0.1 * k]; p.spine[1] = 0.15 * k; break; }
    case 'shimmy': { const k = s(b * 2); p.L = [-0.3, 0, 0.6]; p.Le = [-1.4, 0, 0]; p.R = [-0.3, 0, -0.6]; p.Re = [-1.4, 0, 0]; p.spine = [0, 0.3 * k, 0.06 * k]; p.hips = [0, -0.15 * k, 0]; p.head = [0, -0.2 * k, 0]; p.y = 0.02 * a(k); p.hl = p.hr = 'fist'; break; }
    case 'runningman': { const k = s(b); p.LL = [-0.7 * k, 0, 0]; p.Lk = [0.9 * Math.max(0, k), 0, 0]; p.RL = [0.7 * k, 0, 0]; p.Rk = [0.9 * Math.max(0, -k), 0, 0]; p.L = [0.6 * k, 0, 0.2]; p.Le = [-1.3, 0, 0]; p.R = [-0.6 * k, 0, -0.2]; p.Re = [-1.3, 0, 0]; p.hl = p.hr = 'fist'; p.y = 0.05 * a(s(b * 2)); break; }
    case 'moonwalk': { const k = s(b); p.z = -0.3 * ((t * 0.5) % 2 < 1 ? (t * 0.5) % 1 : 1 - ((t * 0.5) % 1)) * 2 + 0.3; p.LL = [0.2 * k, 0, 0]; p.Lk = [0.5 * Math.max(0, k), 0, 0]; p.RL = [-0.2 * k, 0, 0]; p.Rk = [0.5 * Math.max(0, -k), 0, 0]; p.L = [0.2, 0, 0.15]; p.R = [-0.2, 0, -0.15]; p.head = [0.1, 0, 0]; p.spine[0] = 0.08; break; }
    case 'horse': { const k = s(b); p.L = [-1.1, 0, -0.35]; p.Le = [-0.9, 0, 0]; p.R = [-1.1, 0, 0.35]; p.Re = [-0.9, 0, 0]; p.hl = p.hr = 'fist'; p.y = 0.08 * a(k); p.LL = [-0.4 * Math.max(0, k), 0, 0.15]; p.Lk = [0.6 * Math.max(0, k), 0, 0]; p.RL = [-0.4 * Math.max(0, -k), 0, -0.15]; p.Rk = [0.6 * Math.max(0, -k), 0, 0]; p.spine[0] = 0.1; p.head = [-0.1, 0.2 * s(b / 2), 0]; break; }
    case 'fastfeet': { const k = s(b * 2); p.LL = [-0.6 * Math.max(0, k), 0, 0.1]; p.Lk = [0.9 * Math.max(0, k), 0, 0]; p.RL = [-0.6 * Math.max(0, -k), 0, -0.1]; p.Rk = [0.9 * Math.max(0, -k), 0, 0]; p.L = [0, 0, 0.5]; p.Le = [-0.3, 0, 0.5]; p.R = [0, 0, -0.5]; p.Re = [-0.3, 0, -0.5]; p.y = 0.04 * a(k); p.spine[2] = 0.06 * k; p.head[2] = -0.08 * k; break; }
    case 'fistpump': { const k = a(s(b)); p.R = [0, 0, -2.4 - 0.3 * k]; p.Re = [0, 0, -0.6 * (1 - k)]; p.hr = 'fist'; p.L = [-0.2, 0, 0.5]; p.Le = [-1.6, 0, 0]; p.hl = 'fist'; p.y = 0.06 * k; p.head[0] = -0.15 * k; break; }
    case 'victory': { const k = Math.max(0, s(b / 1.5)); p.y = 0.45 * k; p.L = [0, 0, 2.7]; p.R = [0, 0, -2.7]; p.Le = p.Re = [0, 0, 0]; p.hl = p.hr = 'fist'; p.LL = [-0.8 * k, 0, 0]; p.Lk = [1.4 * k, 0, 0]; p.RL = [-0.8 * k, 0, 0]; p.Rk = [1.4 * k, 0, 0]; p.head[0] = -0.2 * k; break; }
    case 'spin': { p.ry = (t * 4) % TAU; p.L = [0, 0, 1.5]; p.R = [0, 0, -1.5]; p.Le = p.Re = [0, 0, 0]; p.y = 0.04 * a(s(t * 8)); p.head[2] = 0.15; break; }
    default: p.L = [0, 0, 0.14 + 0.03 * s(t * 2)]; p.R = [0, 0, -0.14 - 0.03 * s(t * 2)]; p.y = 0.006 * s(t * 2); p.head[1] = 0.25 * s(t * 0.4); p.head[2] = 0.04 * s(t * 0.7);
  }
  return p;
}
const HANDS = { open: [0.15, 0.15, 0.15, 0.15, 0], flat: [0, 0, 0, 0, 0], fist: [1.5, 1.5, 1.5, 1.5, 0.6], peace: [0, 0, 1.6, 1.6, 0.9], point: [0, 1.5, 1.5, 1.5, 0.8], thumb: [1.5, 1.5, 1.5, 1.5, -0.6] };
const lerp = (a, b, k) => a + (b - a) * k;
function apply(f, p, k) {
  const J = f.J, set = (o, v) => { o.rotation.x = lerp(o.rotation.x, v[0], k); o.rotation.y = lerp(o.rotation.y, v[1], k); o.rotation.z = lerp(o.rotation.z, v[2], k); };
  J.root.position.y = lerp(J.root.position.y, p.y, k); J.root.position.z = lerp(J.root.position.z, p.z, k);
  const dry = p.ry - J.root.rotation.y; J.root.rotation.y = Math.abs(dry) > 3 ? p.ry : lerp(J.root.rotation.y, p.ry, k); J.root.rotation.z = lerp(J.root.rotation.z, p.rz, k);
  set(J.hips, p.hips); set(J.spine, p.spine); set(J.head, p.head); set(J.L.sh, p.L); set(J.L.el, p.Le); set(J.R.sh, p.R); set(J.R.el, p.Re);
  set(J.LL.th, p.LL); set(J.LL.kn, p.Lk); set(J.RL.th, p.RL); set(J.RL.kn, p.Rk);
  [[J.L, p.hl], [J.R, p.hr]].forEach(([A, h]) => { const v = HANDS[h] || HANDS.open; A.fingers.forEach((fg, i) => { fg.rotation.x = lerp(fg.rotation.x, -v[i], k); }); A.th.rotation.x = lerp(A.th.rotation.x, -v[4], k); });
}
// blink and look around
function life(f, t) {
  const bl = (t % 4.3) < 0.12 ? 0.12 : 1; f.J.eyes.children.forEach((e) => { if (!e.userData.still) e.scale.y = lerp(e.scale.y, bl, 0.6); });
}

/* ---------- celebrations ---------- */
const TAGC = { 'best-performer': '#ddff00', 'best-creative': '#685bc7', 'top-contributor': '#ff5a26', 'rising-star': '#e86aa6', 'client-favourite': '#8fd3ff', 'speed-star': '#f5c542', 'team-player': '#2fb37a', 'idea-machine': '#c9b6ff', custom: '#f5c542', star: '#ddff00' };
function crown(st) { const g = new THREE.Group(), m = mat('#f5c542', st, 'metal'); M(cyl(0.28, 0.3, 0.14, 24, true), m, 0, 0, 0, g).material = new THREE.MeshStandardMaterial({ color: '#f5c542', metalness: 0.8, roughness: 0.25, side: THREE.DoubleSide }); for (let i = 0; i < 5; i++) { const a = i * TAU / 5; M(cone(0.06, 0.18), m, Math.cos(a) * 0.28, 0.14, Math.sin(a) * 0.28, g); M(sphere(0.035, 10, 8), mat(['#ff5a26', '#685bc7', '#2fb37a', '#e86aa6', '#8fd3ff'][i], 'x', 'gloss'), Math.cos(a) * 0.29, 0.25, Math.sin(a) * 0.29, g); } return g; }
function confetti(colors, n) {
  const geo0 = new THREE.PlaneGeometry(0.06, 0.1), g = new THREE.Group(); g.userData.parts = [];
  for (let i = 0; i < (n || 70); i++) { const m = new THREE.Mesh(geo0, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide })); m.position.set((Math.random() - 0.5) * 4, Math.random() * 4 + 1, (Math.random() - 0.5) * 2.5); m.userData.v = [(Math.random() - 0.5) * 0.3, -(0.4 + Math.random() * 0.6), Math.random() * 6]; g.add(m); g.userData.parts.push(m); }
  g.userData.tick = (dt) => g.userData.parts.forEach((m) => { m.position.y += m.userData.v[1] * dt; m.position.x += Math.sin(m.position.y * 2 + m.userData.v[2]) * 0.004; m.rotation.x += dt * 3; m.rotation.y += dt * 2; if (m.position.y < -0.2) m.position.y = 4 + Math.random(); });
  return g;
}

/* ---------- scene plumbing ---------- */
let ENV = null;
function env(renderer) {
  if (ENV) return ENV;
  const sc = new THREE.Scene(), box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial({ color: '#8a877f', side: THREE.BackSide })); sc.add(box);
  [[0, 4.5, 0, 6, 0.1, 6, 6], [-4.5, 1, 2, 0.1, 3, 4, 3], [4.5, 2, -1, 0.1, 3, 3, 2.5], [0, 1, -4.5, 4, 2, 0.1, 1.5]].forEach(([x, y, z, w, h, d, i]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#fff', emissiveIntensity: i })); m.position.set(x, y, z); sc.add(m); });
  const pm = new THREE.PMREMGenerator(renderer); ENV = pm.fromScene(sc, 0.04).texture; pm.dispose(); return ENV;
}
function lights(scene, warm) {
  scene.add(new THREE.HemisphereLight('#ffffff', warm ? '#c9b6a0' : '#b6b0d6', 1.1));
  const k = new THREE.DirectionalLight('#fff4e6', 2.2); k.position.set(2.5, 5, 4); k.castShadow = true; k.shadow.mapSize.set(1024, 1024); k.shadow.camera.left = -3; k.shadow.camera.right = 3; k.shadow.camera.top = 4; k.shadow.camera.bottom = -2; k.shadow.radius = 6; k.shadow.bias = -0.0005; scene.add(k);
  const r = new THREE.DirectionalLight('#c9b6ff', 1.2); r.position.set(-3, 3, -3); scene.add(r);
  return k;
}
function renderer(canvas, alpha) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: alpha !== false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75)); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; return r;
}
function ground(scene, color) { const g = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.ShadowMaterial({ opacity: 0.18 })); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g); return g; }
function disposeTree(o) { o.traverse((x) => { if (x.isMesh && x.material && x.material.map) x.material.map.dispose(); }); }
// props around a figure, gently floating
function propRing(f, list, st) {
  const g = new THREE.Group(), kinds = list.filter((k) => !['pencil', 'earphones', 'bag'].includes(k));
  const SLOT = [[1.08, 1.35, 0.05, -0.5], [-1.08, 1.05, 0.1, 0.5], [1.0, 0.42, 0.4, -0.4], [-1.0, 0.36, 0.4, 0.4]];
  kinds.slice(0, 4).forEach((k, i) => { const p = prop(k, st), sl = SLOT[i]; p.position.set(sl[0], sl[1], sl[2]); p.rotation.y = sl[3]; p.scale.setScalar(0.72); p.userData.base = p.position.y; p.userData.ph = i * 1.7; g.add(p); });
  g.userData.tick = (t) => g.children.forEach((p) => { p.position.y = p.userData.base + Math.sin(t * 1.4 + p.userData.ph) * 0.07; p.rotation.y += 0.002; if (p.userData.flap) p.userData.flap.rotation.z = 0.35 * Math.max(0, Math.sin(t * 3 + p.userData.ph)); });
  return g;
}
function addFx(scene, f, fx, st) {
  const out = new THREE.Group(); scene.add(out);
  if (!fx || !fx.length) return out;
  const cols = fx.map((x) => TAGC[x.tag] || '#ddff00');
  if (fx.some((x) => x.tag === 'best-performer' || x.crown)) { const cr = crown(st); cr.position.set(0, 0.5, 0); f.J.head.add(cr); out.userData.crown = cr; }
  const tr = prop('trophy', st); tr.position.set(-1.05, 0.02, 0.35); tr.scale.setScalar(1.1); out.add(tr);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.035, 10, 60), new THREE.MeshBasicMaterial({ color: cols[0] })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; out.add(ring);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.5, 32, 1, true), new THREE.MeshBasicMaterial({ color: cols[0], transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })); beam.position.y = 2.25; out.add(beam);
  if (!reduce()) { const cf = confetti(cols.concat(['#ffffff', '#ff5a26', '#685bc7']), 60); out.add(cf); out.userData.cf = cf; }
  out.userData.tick = (t, dt) => { ring.scale.setScalar(1 + 0.04 * Math.sin(t * 3)); beam.material.opacity = 0.06 + 0.03 * Math.sin(t * 2); if (out.userData.cf) out.userData.cf.userData.tick(dt); };
  return out;
}

/* ---------- a single live figure (builder, spotlights) ---------- */
export function view(el, cfg, opts) {
  const o = opts || {}, canvas = document.createElement('canvas'); canvas.className = 'c3d'; el.replaceChildren(canvas);
  const R = renderer(canvas), scene = new THREE.Scene(); scene.environment = env(R); scene.environmentIntensity = 0.6;
  lights(scene); ground(scene);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50); cam.position.set(0, 1.6, o.close ? 5.2 : 7.4); cam.lookAt(0, o.close ? 1.55 : 1.3, 0);
  let f = null, ring = null, fx = null, move = o.move || 'idle', t0 = performance.now(), last = t0, raf = 0, drag = null, rotY = o.rot || 0.35, alive = true, fxList = o.fx || [];
  const setCfg = (c) => { if (f) { scene.remove(f.root); disposeTree(f.root); } if (ring) scene.remove(ring); if (fx) scene.remove(fx); f = build(c); scene.add(f.root); ring = propRing(f, o.props === false ? [] : f.cfg.gear, f.cfg.style); scene.add(ring); fx = addFx(scene, f, fxList, f.cfg.style); };
  setCfg(cfg);
  const size = () => { const w = el.clientWidth || 300, h = el.clientHeight || 330; R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  const ro = new ResizeObserver(size); ro.observe(el); size();
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, r: rotY, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 3) drag.moved = true; rotY = drag.r + dx * 0.012; });
  canvas.addEventListener('pointerup', () => { if (drag && !drag.moved && o.onTap) o.onTap(); drag = null; });
  const loop = (now) => {
    if (!alive) return; raf = requestAnimationFrame(loop);
    if (!el.isConnected) { api.dispose(); return; }
    if (el.closest('[hidden]') || document.hidden) return;
    const t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
    const still = reduce();
    apply(f, pose(still ? 'idle' : move, still ? 0 : t), still ? 1 : 0.22); life(f, t);
    scene.rotation.y = lerp(scene.rotation.y, rotY, 0.12);
    if (ring) ring.userData.tick(t); if (fx && fx.userData.tick) fx.userData.tick(t, dt);
    R.render(scene, cam);
  };
  raf = requestAnimationFrame(loop);
  const api = {
    set(c) { setCfg(c); }, play(m) { move = m || 'idle'; t0 = performance.now(); }, get move() { return move; },
    fx(list) { fxList = list || []; if (fx) scene.remove(fx); fx = addFx(scene, f, fxList, f.cfg.style); },
    dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); R.dispose(); R.forceContextLoss && R.forceContextLoss(); }
  };
  return api;
}

/* ---------- head-and-shoulders picture, for avatars everywhere ---------- */
let SNAP = null;
export function snap(cfg, size) {
  size = size || 256;
  if (!SNAP) { const cv = document.createElement('canvas'); SNAP = { R: renderer(cv), scene: new THREE.Scene() }; SNAP.R.shadowMap.enabled = false; SNAP.scene.environment = env(SNAP.R); SNAP.scene.environmentIntensity = 0.7; lights(SNAP.scene); SNAP.cam = new THREE.PerspectiveCamera(26, 1, 0.1, 30); }
  const { R, scene, cam } = SNAP; R.setPixelRatio(1); R.setSize(size, size, false);
  const f = build(cfg); scene.add(f.root); apply(f, pose('idle', 0), 1);
  const bg = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshBasicMaterial({ color: norm(cfg).bg })); bg.position.set(0, 1.6, -1.2); scene.add(bg);
  cam.position.set(0.5, 2.15, 3.9); cam.lookAt(0, 1.93, 0); f.root.rotation.y = 0.18;
  R.render(scene, cam); const url = R.domElement.toDataURL('image/webp', 0.9);
  scene.remove(f.root); scene.remove(bg); bg.geometry.dispose();
  return url.startsWith('data:image/webp') ? url : R.domElement.toDataURL('image/png');
}

/* ---------- the crew: many small live figures drawn on one canvas ---------- */
export function crew(container, clipTop) {
  const canvas = document.createElement('canvas'); canvas.className = 'c3d-crew'; document.body.append(canvas);
  const R = renderer(canvas); R.setScissorTest(true);
  const slots = new Map(); let alive = true, raf = 0, t0 = performance.now();
  const shared = env(R);
  const add = (el, cfg, opts) => {
    const scene = new THREE.Scene(); scene.environment = shared; scene.environmentIntensity = 0.6; lights(scene); ground(scene);
    const f = build(cfg); scene.add(f.root); const ring = propRing(f, f.cfg.gear, f.cfg.style); scene.add(ring); const fx = addFx(scene, f, (opts && opts.fx) || [], f.cfg.style);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50); cam.position.set(0, 1.5, 7.6); cam.lookAt(0, 1.3, 0);
    const s = { el, scene, f, ring, fx, cam, move: 'idle', sig: f.cfg.move || 'wave', off: Math.random() * 10, rot: 0.3 };
    el.addEventListener('mouseenter', () => { s.move = s.sig; s.t0 = performance.now(); });
    el.addEventListener('mouseleave', () => { s.move = 'idle'; });
    el.addEventListener('click', () => { const i = MOVES.findIndex((m) => m[0] === s.move); s.move = MOVES[(i + 1) % MOVES.length][0]; if (s.move === 'idle') s.move = 'wave'; s.t0 = performance.now(); });
    slots.set(el, s);
  };
  const size = () => { R.setSize(window.innerWidth, window.innerHeight, false); };
  window.addEventListener('resize', size); size();
  const loop = (now) => {
    if (!alive) return; raf = requestAnimationFrame(loop);
    if (!container.isConnected) { api.dispose(); return; }
    const vis = !container.closest('[hidden]') && !document.hidden; canvas.style.display = vis ? '' : 'none'; if (!vis) return;
    R.setScissorTest(false); R.clear(); R.setScissorTest(true);
    const H = window.innerHeight, still = reduce();
    const top = clipTop ? clipTop() : 0;
    slots.forEach((s, key) => {
      if (!s.el.isConnected) { if (!s.lost) s.lost = now; if (now - s.lost > 3000) slots.delete(key); return; } s.lost = 0;
      const r = s.el.getBoundingClientRect(); if (r.bottom < top || r.top > H || r.width < 2) return;
      const vt = Math.max(r.top, top), vh = r.bottom - vt;
      const t = (now - (s.t0 || t0)) / 1000 + (s.move === 'idle' ? s.off : 0);
      apply(s.f, pose(still ? 'idle' : s.move, still ? 0 : t), 0.22); life(s.f, t + s.off); s.ring.userData.tick(t + s.off); if (s.fx.userData.tick) s.fx.userData.tick(t, 0.016);
      s.scene.rotation.y = s.rot + Math.sin((now - t0) / 4000 + s.off) * 0.15;
      s.cam.aspect = r.width / r.height; s.cam.updateProjectionMatrix();
      const y = H - r.bottom; R.setViewport(r.left, y, r.width, r.height); R.setScissor(r.left, y, r.width, vh); R.render(s.scene, s.cam);
    });
  };
  raf = requestAnimationFrame(loop);
  const api = { add, play(el, m) { const s = slots.get(el); if (s) { s.move = m; s.t0 = performance.now(); } }, dispose() { alive = false; cancelAnimationFrame(raf); window.removeEventListener('resize', size); R.dispose(); canvas.remove(); slots.clear(); } };
  return api;
}

/* ---------- Hall of Fame: a desk with a retro computer, a mug with eyes and the spotlight figure ---------- */
export function stage(el, opts) {
  const o = opts || {}, canvas = document.createElement('canvas'); canvas.className = 'c3d-stage'; el.replaceChildren(canvas);
  const R = renderer(canvas), scene = new THREE.Scene(); scene.environment = env(R); scene.environmentIntensity = 0.55; lights(scene, true);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 60); cam.position.set(0.4, 3.0, 9.2); cam.lookAt(0, 1.6, 0);
  const dark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  // desk / plinth
  const plinthM = new THREE.MeshPhysicalMaterial({ color: '#f4f1ea', roughness: 0.5, clearcoat: 0.3 });
  const desk = M(roundedBox(7.2, 0.7, 3.2, 0.12), plinthM, 0, -0.35, 0, scene); desk.receiveShadow = true;
  const shadowCatch = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), new THREE.ShadowMaterial({ opacity: 0.2 })); shadowCatch.rotation.x = -Math.PI / 2; shadowCatch.position.y = 0.005; shadowCatch.receiveShadow = true; scene.add(shadowCatch);
  // retro computer
  const pc = G(scene, -1.75, 0, -0.2); pc.rotation.y = 0.32;
  const shellM = new THREE.MeshPhysicalMaterial({ color: '#e9e3d6', roughness: 0.45, clearcoat: 0.5 });
  M(roundedBox(2.2, 1.8, 1.7, 0.22), shellM, 0, 1.25, 0, pc); M(roundedBox(2.4, 0.42, 1.9, 0.14), shellM, 0, 0.21, 0.05, pc);
  M(roundedBox(1.84, 1.4, 0.1, 0.12), mat('#c9c1b0', 'clay'), 0, 1.3, 0.83, pc);
  const scr = document.createElement('canvas'); scr.width = 512; scr.height = 384; const sctx = scr.getContext('2d'); const tex = new THREE.CanvasTexture(scr); tex.colorSpace = THREE.SRGBColorSpace;
  const screen = M(roundedBox(1.62, 1.2, 0.04, 0.1), new THREE.MeshBasicMaterial({ map: tex }), 0, 1.3, 0.88, pc);
  const glow = new THREE.PointLight('#ddff00', 1.6, 3.5); glow.position.set(0, 1.3, 1.4); pc.add(glow);
  M(roundedBox(0.7, 0.05, 0.04, 0.02), mat('#1e1e1e', 'clay'), -0.5, 0.25, 1.0, pc); M(sphere(0.05, 12, 10), mat('#ff5a26', 'x', 'emit'), 0.85, 0.25, 1.0, pc);
  const knobs = [0.38, 0.62].map((x, i) => { const k = M(cyl(0.12, 0.12, 0.08, 24), new THREE.MeshPhysicalMaterial({ color: i ? '#685bc7' : '#d9d1c2', roughness: 0.3, clearcoat: 1 }), x, 0.24, 1.0, pc, { r: [Math.PI / 2, 0, 0] }); k.userData.knob = i ? 'next' : 'prev'; M(roundedBox(0.03, 0.1, 0.02, 0.01), mat(i ? '#ffffff' : '#1e1e1e', 'x', 'flat'), 0, 0.045, -0.04, k, { r: [-Math.PI / 2, 0, 0] }); return k; });
  // keyboard
  const kb = G(scene, -1.6, 0, 1.15); kb.rotation.y = 0.2; M(roundedBox(1.9, 0.14, 0.7, 0.06), shellM, 0, 0.07, 0, kb); for (let r = 0; r < 3; r++) for (let k = 0; k < 10; k++) M(roundedBox(0.13, 0.06, 0.13, 0.03), mat(k === 9 && r === 1 ? '#ff5a26' : '#f7f4ee', 'vinyl'), -0.82 + k * 0.18, 0.16, -0.18 + r * 0.18, kb);
  // a mug with eyes (it looks at whoever is in the spotlight)
  const mug = G(scene, 2.6, 0, 0.9); const mugB = M(cyl(0.34, 0.3, 0.62, 32), new THREE.MeshPhysicalMaterial({ color: '#ff5a26', roughness: 0.35, clearcoat: 0.8 }), 0, 0.31, 0, mug); M(torus(0.17, 0.05, Math.PI), mugB.material, 0.34, 0.33, 0, mug, { r: [0, 0, -Math.PI / 2] });
  const mEyes = G(mug, 0, 0.42, 0.29); [-0.11, 0.11].forEach((x) => { M(sphere(0.09, 16, 12), mat('#ffffff', 'vinyl'), x, 0, 0, mEyes, { s: [1, 1.1, 0.5] }); M(sphere(0.045, 12, 10), mat('#1e1e1e', 'x', 'gloss'), x + 0.01, -0.01, 0.04, mEyes); });
  M(torus(0.06, 0.015, Math.PI), mat('#1e1e1e', 'x', 'flat'), 0, 0.24, 0.31, mug, { r: [0, 0, Math.PI] });
  // floating paper and a pencil
  const paper = M(roundedBox(0.9, 0.012, 0.6, 0.006), mat('#fffdf5', 'clay'), 1.6, 0.02, 1.25, scene, { r: [0, -0.3, 0] });
  const pencil = G(scene, 1.4, 0.06, 1.35); pencil.rotation.set(Math.PI / 2, 0, 0.9); M(cyl(0.035, 0.035, 0.6, 6), mat('#f5c542', 'vinyl'), 0, 0, 0, pencil); M(cone(0.035, 0.1), mat('#e9b48a', 'clay'), 0, 0.35, 0, pencil);
  // spotlight figure
  let f = null, ring = null, fx = null, move = 'wave', t0 = performance.now(), last = t0, alive = true, raf = 0, card = null;
  const holder = G(scene, 0.75, 0, 0.3); holder.scale.setScalar(1.05);
  const paint = (c) => {
    card = c; const w = 512, h = 384, g = sctx;
    const grd = g.createRadialGradient(w * 0.5, h * 0.4, 20, w * 0.5, h * 0.5, w * 0.7); grd.addColorStop(0, '#efff7a'); grd.addColorStop(0.6, '#ddff00'); grd.addColorStop(1, '#b6d100'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(30,30,30,.06)'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 2);
    g.fillStyle = '#1e1e1e'; g.font = '600 18px "IBM Plex Mono", monospace'; g.fillText(c ? 'HALL OF FAME · CH ' + String(c.i + 1).padStart(2, '0') + '/' + String(c.n).padStart(2, '0') : 'HALL OF FAME', 28, 42);
    if (!c) { g.font = '700 54px Outfit, Inter, sans-serif'; g.fillText('Awards and', 28, 170); g.fillText('weekly stars', 28, 230); g.font = '500 22px Inter, sans-serif'; g.fillText('show up here.', 28, 280); tex.needsUpdate = true; return; }
    const tag = c.title.toUpperCase(); g.font = '700 22px Inter, sans-serif'; const tw = g.measureText(tag).width; g.fillStyle = c.color || '#1e1e1e'; g.beginPath(); g.roundRect(28, 70, tw + 32, 40, 20); g.fill(); g.lineWidth = 3; g.strokeStyle = '#1e1e1e'; g.stroke(); g.fillStyle = c.ink || '#ffffff'; g.fillText(tag, 44, 98);
    g.fillStyle = '#1e1e1e'; g.font = '800 58px Outfit, Inter, sans-serif'; const words = c.who.split(' '); g.fillText(words[0], 28, 180); if (words[1]) g.fillText(words.slice(1).join(' '), 28, 238);
    g.font = '500 22px Inter, sans-serif'; const line = String(c.line || ''); const wrap = []; let cur = ''; line.split(' ').forEach((wd) => { if (g.measureText(cur + ' ' + wd).width > 440) { wrap.push(cur); cur = wd; } else cur = cur ? cur + ' ' + wd : wd; }); wrap.push(cur); wrap.slice(0, 3).forEach((l, i) => g.fillText(l, 28, 290 + i * 30));
    tex.needsUpdate = true;
  };
  const setSpot = (c, cfg) => {
    if (f) { holder.remove(f.root); disposeTree(f.root); } if (ring) holder.remove(ring); if (fx) { scene.remove(fx); }
    paint(c);
    if (!cfg) { f = null; return; }
    f = build(cfg); holder.add(f.root); ring = propRing(f, f.cfg.gear, f.cfg.style); holder.add(ring);
    fx = addFx(holder, f, c && c.fx ? c.fx : [], f.cfg.style); move = (c && c.move) || f.cfg.move || 'wave'; t0 = performance.now();
  };
  // pointer: parallax, knobs, tap the figure to change its move, tap the mug to make it hop
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), look = { x: 0, y: 0 }; let hop = 0;
  canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); look.x = ((e.clientX - r.left) / r.width) * 2 - 1; look.y = ((e.clientY - r.top) / r.height) * 2 - 1; });
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, cam);
    const hits = ray.intersectObjects(scene.children, true); if (!hits.length) return; let ob = hits[0].object;
    while (ob && !ob.userData.knob && ob !== mug && ob !== holder && ob.parent) ob = ob.parent;
    if (ob && ob.userData.knob) { ob.rotation.y += 0.8; o.onKnob && o.onKnob(ob.userData.knob); }
    else if (ob === mug) hop = 1;
    else if (ob === holder && f) { const i = MOVES.findIndex((m) => m[0] === move); move = MOVES[(i + 1) % MOVES.length][0]; if (move === 'idle') move = 'wave'; t0 = performance.now(); o.onMove && o.onMove(move); }
  });
  canvas.style.cursor = 'pointer';
  const size = () => { const w = el.clientWidth || 600, h = el.clientHeight || 420; R.setSize(w, h, false); cam.aspect = w / h; cam.position.z = w < 560 ? 12 : 9.2; cam.updateProjectionMatrix(); };
  const ro = new ResizeObserver(size); ro.observe(el); size();
  const loop = (now) => {
    if (!alive) return; raf = requestAnimationFrame(loop);
    if (!el.isConnected) { api.dispose(); return; }
    if (el.closest('[hidden]') || document.hidden) return;
    const t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000), T = now / 1000; last = now;
    const still = reduce();
    plinthM.color.set(dark() ? '#2a2928' : '#f4f1ea'); shellM.color.set(dark() ? '#3a3937' : '#e9e3d6');
    cam.position.x = lerp(cam.position.x, 0.4 + look.x * 0.6, 0.05); cam.position.y = lerp(cam.position.y, 3.0 - look.y * 0.35, 0.05); cam.lookAt(0, 1.5, 0);
    if (f) { apply(f, pose(still ? 'idle' : move, still ? 0 : t), still ? 1 : 0.22); life(f, T); ring.userData.tick(T); if (fx && fx.userData.tick) fx.userData.tick(T, dt); }
    mEyes.position.x = lerp(mEyes.position.x, -0.05 + look.x * 0.04, 0.1); mEyes.scale.y = (T % 5) < 0.12 ? 0.15 : 1;
    if (hop > 0) { hop = Math.max(0, hop - dt * 1.6); mug.position.y = Math.sin((1 - hop) * Math.PI) * 0.5; mug.rotation.z = Math.sin((1 - hop) * TAU) * 0.15; }
    glow.intensity = 1.5 + 0.2 * Math.sin(T * 3);
    if (!still) { paper.position.y = 0.02 + 0.02 * Math.sin(T * 1.5); }
    R.render(scene, cam);
  };
  raf = requestAnimationFrame(loop);
  const api = { spot: setSpot, play(m) { move = m; t0 = performance.now(); }, dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); R.dispose(); } };
  return api;
}

export function supported() { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; } }
window.CO_3D = { view, stage, crew, snap, MOVES, norm, supported, version: 1 };
