/* Characters (Studio, Nov 2026): original "clay toy" figures drawn as layered SVG, so everyone can build their own:
   skin, face, hair, outfit, glasses, headwear and the tools of their craft. Pure drawing code, no data access.
   CO_CHAR.svg(cfg, opts) → SVG markup (animated when opts.anim), CO_CHAR.url(cfg, 'head') → a cached image URL for small
   avatars, CO_CHAR.random(role) → a fresh character, CO_CHAR.OPT → every choice for the builder. */
(function () {
  'use strict';
  const SKIN = ['#ffe0c7', '#f5cba7', '#e9b48a', '#d49a6a', '#b97a4f', '#935e3c', '#6e432a', '#4b2c1c'];
  const HAIRC = ['#1e1e1e', '#3b2a20', '#6b4423', '#a0662f', '#d8a95b', '#efe0b0', '#b9b6b0', '#ff5a26', '#685bc7', '#ddff00', '#e86aa6', '#3a7bd5'];
  const CLOTH = ['#ddff00', '#ff5a26', '#685bc7', '#f0eee9', '#1e1e1e', '#3a7bd5', '#2fb37a', '#f5c542', '#e86aa6', '#8fd3ff', '#c9b6ff', '#ffb38a'];
  const BG = ['#ddff00', '#685bc7', '#ff5a26', '#f0eee9', '#1e1e1e', '#c9b6ff', '#ffd3c2', '#e8f7a6', '#8fd3ff', '#f5c542'];
  const OPT = {
    skin: SKIN, hairColor: HAIRC, outfitColor: CLOTH, bg: BG,
    hair: [['short', 'Short'], ['sidepart', 'Side part'], ['curly', 'Curly'], ['wavy', 'Wavy'], ['long', 'Long'], ['bob', 'Bob'], ['bun', 'Top bun'], ['ponytail', 'Ponytail'], ['afro', 'Afro'], ['spiky', 'Spiky'], ['buzz', 'Buzz'], ['bald', 'Bald']],
    eyes: [['dot', 'Dots'], ['round', 'Round'], ['sparkle', 'Sparkle'], ['anime', 'Big eyes'], ['happy', 'Happy'], ['wink', 'Wink'], ['sleepy', 'Sleepy']],
    brows: [['soft', 'Soft'], ['bold', 'Bold'], ['raised', 'Raised'], ['none', 'None']],
    mouth: [['smile', 'Smile'], ['grin', 'Grin'], ['tongue', 'Cheeky'], ['smirk', 'Smirk'], ['o', 'Oh!'], ['flat', 'Focused']],
    face: [['none', 'None'], ['stubble', 'Stubble'], ['mustache', 'Moustache'], ['beard', 'Beard'], ['freckles', 'Freckles']],
    glasses: [['none', 'None'], ['round', 'Round'], ['square', 'Square'], ['retro', 'Retro'], ['sun', 'Sunglasses'], ['visor', 'Lime visor']],
    head: [['none', 'None'], ['headphones', 'Headphones'], ['beanie', 'Beanie'], ['cap', 'Cap'], ['beret', 'Beret'], ['bandana', 'Bandana']],
    outfit: [['hoodie', 'Hoodie'], ['tee', 'T-shirt'], ['shirt', 'Shirt'], ['jacket', 'Jacket'], ['sweater', 'Sweater'], ['turtleneck', 'Turtleneck'], ['overalls', 'Overalls']],
    gear: [['typewriter', 'Typewriter'], ['palette', 'Colour palette'], ['notebook', 'Notebook & pen'], ['reel', 'Film reel'], ['laptop', 'Laptop'], ['tablet', 'Tablet & pen'], ['camera', 'Camera'], ['clapper', 'Clapperboard'], ['mic', 'Mic'], ['mug', 'Coffee'], ['sketchbook', 'Sketchbook'], ['book', 'Book'], ['earphones', 'Earphones'], ['pencil', 'Pencil on ear'], ['bag', 'Bag'], ['plant', 'Tiny plant']]
  };
  // Tools that suit each kind of role (matched on the role's words); the builder offers them first.
  const ROLE_GEAR = [
    [/video|editor|motion|film|reel/i, ['headphones', 'clapper', 'camera', 'laptop', 'reel', 'earphones']],
    [/copy|writer|content|script/i, ['typewriter', 'book', 'notebook', 'mug', 'pencil']],
    [/head|lead|manager|director/i, ['mug', 'sun', 'laptop', 'book', 'plant']],
    [/design|graphic|illustr|visual|art/i, ['tablet', 'palette', 'sketchbook', 'pencil', 'laptop']]
  ];
  const gearFor = (role) => { const m = ROLE_GEAR.find((x) => x[0].test(String(role || ''))); return m ? m[1] : ['laptop', 'mug', 'tablet', 'headphones']; };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const val = (x) => (Array.isArray(x) ? x[0] : x);
  function random(role) {
    const g = gearFor(role), hold = g.filter((x) => ['laptop', 'tablet', 'camera', 'clapper', 'mic', 'mug', 'sketchbook', 'book', 'plant'].includes(x));
    const wear = g.filter((x) => ['earphones', 'pencil', 'bag'].includes(x));
    const gear = [pick(hold.length ? hold : ['laptop'])].concat(Math.random() < 0.5 && wear.length ? [pick(wear)] : []);
    return {
      v: 1, skin: pick(SKIN), hair: val(pick(OPT.hair.slice(0, 11))), hairColor: pick(HAIRC.slice(0, 8).concat(['#ff5a26', '#685bc7'])), eyes: val(pick(OPT.eyes.slice(0, 4))), brows: val(pick(OPT.brows.slice(0, 3))),
      mouth: val(pick(OPT.mouth.slice(0, 4))), face: Math.random() < 0.7 ? 'none' : val(pick(OPT.face.slice(1))), glasses: Math.random() < 0.6 ? 'none' : val(pick(OPT.glasses.slice(1))),
      head: g.includes('headphones') && Math.random() < 0.6 ? 'headphones' : Math.random() < 0.75 ? 'none' : val(pick(OPT.head.slice(2))),
      outfit: val(pick(OPT.outfit)), outfitColor: pick(CLOTH), bg: pick(BG), gear
    };
  }
  const DEF = { v: 1, skin: SKIN[2], hair: 'short', hairColor: HAIRC[1], eyes: 'dot', brows: 'soft', mouth: 'smile', face: 'none', glasses: 'none', head: 'none', outfit: 'hoodie', outfitColor: '#685bc7', bg: '#ddff00', gear: ['laptop'] };
  const norm = (c) => { const o = Object.assign({}, DEF, c || {}); if (!Array.isArray(o.gear)) o.gear = []; o.gear = o.gear.filter((x) => OPT.gear.some((g) => g[0] === x)).slice(0, 4); return o; };

  /* colour helpers */
  const hex = (c) => { const m = String(c).replace('#', ''); const n = parseInt(m.length === 3 ? m.split('').map((x) => x + x).join('') : m, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (r) => '#' + r.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  const mix = (c, d, t) => { const a = hex(c), b = hex(d); return toHex(a.map((x, i) => x + (b[i] - x) * t)); };
  const lite = (c, t) => mix(c, '#ffffff', t), dark = (c, t) => mix(c, '#000000', t);
  const lum = (c) => { const [r, g, b] = hex(c).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

  let SEQ = 0;
  /* One figure. Clay look: every surface has a soft radial light (top left) and a gentle drop shadow. */
  function svg(cfg, opts) {
    const c = norm(cfg), o = opts || {}, id = 'c' + (++SEQ).toString(36) + Math.random().toString(36).slice(2, 5);
    const G = {}; // gradient per colour
    const grad = (col, k) => { const key = col + (k || ''); if (G[key]) return 'url(#' + G[key].id + ')'; const gid = id + 'g' + Object.keys(G).length; G[key] = { id: gid, col, k }; return 'url(#' + gid + ')'; };
    const sk = c.skin, hc = c.hairColor, oc = c.outfitColor, ink = '#24211e', bgc = c.bg;
    const P = [];
    // scene
    if (!o.noBg) {
      P.push('<rect x="0" y="0" width="200" height="220" rx="' + (o.round ? 100 : 36) + '" fill="' + grad(bgc, 'bg') + '"/>');
      P.push('<ellipse cx="100" cy="214" rx="70" ry="10" fill="' + dark(bgc, 0.18) + '" opacity=".45"/>');
      if (!o.round) P.push('<circle cx="36" cy="40" r="5" fill="' + lite(bgc, 0.5) + '" opacity=".7"/><circle cx="168" cy="58" r="3.5" fill="' + lite(bgc, 0.5) + '" opacity=".7"/><path d="M160 26l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="' + lite(bgc, 0.6) + '" opacity=".9"/>');
    }
    const hairBack = { long: '<path d="M44 96c0-46 26-66 56-66s56 20 56 66v74c0 10-8 16-18 16H62c-10 0-18-6-18-16z"/>', bob: '<path d="M46 96c0-44 24-64 54-64s54 20 54 64v34c0 8-6 12-14 12H60c-8 0-14-4-14-12z"/>', afro: '<circle cx="100" cy="80" r="64"/>', wavy: '<path d="M48 96c0-46 24-64 52-64s52 18 52 64c0 14 6 22 2 34-4 10-14 8-16 16H62c-2-8-12-6-16-16-4-12 2-20 2-34z"/>', ponytail: '<path d="M140 70c22 6 30 34 22 62-4 14-14 22-22 18 8-18 10-44 0-80z"/>' };
    // body (behind head)
    P.push('<g class="ch-body">');
    if (c.gear.includes('bag')) P.push('<path d="M58 168l84 52" stroke="' + dark(oc, 0.45) + '" stroke-width="7" stroke-linecap="round" opacity=".9"/>');
    const body = 'M30 222c0-44 26-70 70-70s70 26 70 70z';
    if (c.outfit === 'hoodie') P.push('<path d="M62 160c4-14 20-22 38-22s34 8 38 22c-10 10-24 14-38 14s-28-4-38-14z" fill="' + dark(oc, 0.12) + '"/>');
    P.push('<path d="' + body + '" fill="' + grad(oc) + '"/>');
    if (c.outfit === 'overalls') P.push('<path d="M66 222v-44h68v44z" fill="' + grad('#3a6fb0') + '"/><path d="M70 160l6 22M130 160l-6 22" stroke="#3a6fb0" stroke-width="7" stroke-linecap="round"/><circle cx="76" cy="184" r="3" fill="#ffd36b"/><circle cx="124" cy="184" r="3" fill="#ffd36b"/>');
    if (c.outfit === 'jacket') P.push('<path d="M86 152l14 30 14-30v70H86z" fill="' + grad(lum(oc) > 0.5 ? '#1e1e1e' : '#f0eee9') + '"/><path d="M86 152l14 30-18 8-8-34zM114 152l-14 30 18 8 8-34z" fill="' + dark(oc, 0.14) + '"/>');
    if (c.outfit === 'shirt') P.push('<path d="M100 160v62" stroke="' + dark(oc, 0.2) + '" stroke-width="2"/><path d="M84 152l16 12 16-12 2 14-18 6-18-6z" fill="' + lite(oc, 0.35) + '"/><circle cx="100" cy="184" r="2" fill="' + dark(oc, 0.3) + '"/><circle cx="100" cy="200" r="2" fill="' + dark(oc, 0.3) + '"/>');
    if (c.outfit === 'sweater') P.push('<path d="M80 156c6 8 14 12 20 12s14-4 20-12" fill="none" stroke="' + dark(oc, 0.18) + '" stroke-width="5" stroke-linecap="round"/><path d="M56 196h88" stroke="' + lite(oc, 0.25) + '" stroke-width="4" stroke-dasharray="2 6" stroke-linecap="round"/>');
    if (c.outfit === 'turtleneck') P.push('<rect x="80" y="140" width="40" height="22" rx="10" fill="' + grad(dark(oc, 0.06)) + '"/>');
    if (c.outfit === 'hoodie') P.push('<path d="M92 166v18M108 166v18" stroke="' + lite(oc, 0.6) + '" stroke-width="3" stroke-linecap="round"/><circle cx="92" cy="186" r="2.6" fill="' + lite(oc, 0.6) + '"/><circle cx="108" cy="186" r="2.6" fill="' + lite(oc, 0.6) + '"/><path d="M70 206h60v16H70z" fill="' + dark(oc, 0.1) + '" opacity=".6"/>');
    if (c.outfit === 'tee') P.push('<path d="M84 154c4 8 10 11 16 11s12-3 16-11" fill="none" stroke="' + dark(oc, 0.16) + '" stroke-width="4" stroke-linecap="round"/><path d="M84 190h32" stroke="' + lite(oc, 0.45) + '" stroke-width="7" stroke-linecap="round"/>');
    P.push('</g>');
    // neck
    if (c.outfit !== 'turtleneck') P.push('<path d="M86 132h28v22c0 6-6 10-14 10s-14-4-14-10z" fill="' + dark(sk, 0.12) + '"/>');
    // head group (bobs when animated)
    P.push('<g class="ch-head">');
    if (hairBack[c.hair]) P.push('<g fill="' + grad(hc, 'h') + '">' + hairBack[c.hair] + '</g>');
    P.push('<circle cx="55" cy="98" r="10" fill="' + dark(sk, 0.06) + '"/><circle cx="145" cy="98" r="10" fill="' + dark(sk, 0.06) + '"/><circle cx="55" cy="98" r="5" fill="' + dark(sk, 0.16) + '"/><circle cx="145" cy="98" r="5" fill="' + dark(sk, 0.16) + '"/>');
    P.push('<ellipse cx="100" cy="94" rx="46" ry="48" fill="' + grad(sk, 's') + '"/>');
    // cheeks
    P.push('<ellipse cx="72" cy="114" rx="9" ry="6" fill="#ff7a8a" opacity=".28"/><ellipse cx="128" cy="114" rx="9" ry="6" fill="#ff7a8a" opacity=".28"/>');
    if (c.face === 'freckles') P.push('<g fill="' + dark(sk, 0.35) + '" opacity=".55"><circle cx="68" cy="108" r="1.3"/><circle cx="74" cy="111" r="1.3"/><circle cx="70" cy="114" r="1.3"/><circle cx="126" cy="108" r="1.3"/><circle cx="132" cy="111" r="1.3"/><circle cx="130" cy="114" r="1.3"/></g>');
    if (c.face === 'stubble') P.push('<path d="M66 116c6 18 20 26 34 26s28-8 34-26c-6 8-18 12-34 12s-28-4-34-12z" fill="' + hc + '" opacity=".22"/>');
    if (c.face === 'beard') P.push('<path d="M60 104c0 26 18 42 40 42s40-16 40-42c-6 10-14 16-22 16-4-6-10-8-18-8s-14 2-18 8c-8 0-16-6-22-16z" fill="' + grad(hc, 'h') + '"/>');
    // eyes
    const eye = (x, kind) => {
      if (kind === 'happy') return '<path d="M' + (x - 7) + ' 102q7-9 14 0" fill="none" stroke="' + ink + '" stroke-width="3.6" stroke-linecap="round"/>';
      if (kind === 'sleepy') return '<path d="M' + (x - 7) + ' 100q7 6 14 0" fill="none" stroke="' + ink + '" stroke-width="3.4" stroke-linecap="round"/>';
      if (kind === 'round') return '<ellipse cx="' + x + '" cy="100" rx="8" ry="9" fill="#fff"/><ellipse cx="' + (x + 1) + '" cy="101" rx="5" ry="6" fill="' + ink + '"/><circle cx="' + (x + 2.6) + '" cy="98" r="1.8" fill="#fff"/>';
      if (kind === 'sparkle') return '<ellipse cx="' + x + '" cy="100" rx="6.5" ry="8" fill="' + ink + '"/><circle cx="' + (x + 2.2) + '" cy="96.6" r="2.4" fill="#fff"/><circle cx="' + (x - 2.2) + '" cy="104" r="1.2" fill="#fff"/>';
      return '<ellipse cx="' + x + '" cy="100" rx="4.6" ry="6" fill="' + ink + '"/><circle cx="' + (x + 1.6) + '" cy="97.6" r="1.6" fill="#fff"/>';
    };
    const eL = c.eyes === 'wink' ? 'dot' : c.eyes, eR = c.eyes === 'wink' ? 'happy' : c.eyes;
    P.push('<g class="ch-eyes' + (/happy|sleepy/.test(c.eyes) ? ' still' : '') + '">' + eye(82, eL) + eye(118, eR) + '</g>');
    const bw = c.brows === 'bold' ? 5 : 3, by = c.brows === 'raised' ? 80 : 85;
    if (c.brows !== 'none') P.push('<g stroke="' + dark(hc, lum(hc) > 0.5 ? 0.35 : 0) + '" stroke-width="' + bw + '" stroke-linecap="round" fill="none"><path d="M74 ' + by + 'q8-' + (c.brows === 'raised' ? 6 : 3) + ' 16 0"/><path d="M110 ' + by + 'q8-' + (c.brows === 'raised' ? 6 : 3) + ' 16 0"/></g>');
    // nose + mouth
    P.push('<ellipse cx="100" cy="110" rx="4.5" ry="3.4" fill="' + dark(sk, 0.14) + '"/>');
    const m = { smile: '<path d="M88 120q12 11 24 0" fill="none" stroke="' + ink + '" stroke-width="3.6" stroke-linecap="round"/>', grin: '<path d="M86 118h28q-2 16-14 16t-14-16z" fill="' + ink + '"/><path d="M89 119h22v4H89z" fill="#fff"/>', tongue: '<path d="M86 118h28q-2 16-14 16t-14-16z" fill="' + ink + '"/><path d="M89 119h22v4H89z" fill="#fff"/><ellipse cx="104" cy="129" rx="6" ry="4.5" fill="#ff7a8a"/>', smirk: '<path d="M90 123q12 4 22-6" fill="none" stroke="' + ink + '" stroke-width="3.6" stroke-linecap="round"/>', o: '<ellipse cx="100" cy="124" rx="5" ry="6" fill="' + ink + '"/>', flat: '<path d="M91 123h18" stroke="' + ink + '" stroke-width="3.6" stroke-linecap="round"/>' };
    P.push(m[c.mouth] || m.smile);
    if (c.face === 'mustache') P.push('<path d="M84 116c6-6 12-6 16-2 4-4 10-4 16 2-6 4-12 4-16 0-4 4-10 4-16 0z" fill="' + grad(hc, 'h') + '"/>');
    // hair front
    const hf = {
      short: '<path d="M54 92c0-36 20-56 46-56s46 20 46 56c-4-14-12-26-26-30-10 8-30 10-50 8-8 6-14 14-16 22z"/>',
      sidepart: '<path d="M54 94c0-38 20-58 48-58 28 0 44 20 44 54-8-18-22-30-44-32-14 8-30 8-40 4-4 8-6 20-8 32z"/><path d="M98 38c-14 10-26 26-30 44" stroke="' + lite(hc, 0.2) + '" stroke-width="3" fill="none" stroke-linecap="round"/>',
      curly: Array.from({ length: 11 }, (_, i) => { const a = Math.PI * (1.02 + i * 0.096); return '<circle cx="' + (100 + Math.cos(a) * 46).toFixed(1) + '" cy="' + (90 + Math.sin(a) * 48).toFixed(1) + '" r="14"/>'; }).join('') + '<circle cx="86" cy="56" r="14"/><circle cx="112" cy="54" r="14"/><circle cx="100" cy="66" r="12"/>',
      wavy: '<path d="M52 98c-2-40 20-62 48-62s50 22 48 62c-6-16-12-24-20-28-6 10-16 4-22 0-8 8-18 8-26 0-8 4-16 8-20 20z"/>',
      long: '<path d="M54 100c-2-40 18-64 46-64s48 24 46 64c-6-24-22-40-46-42-12 0-22 8-30 18-6 6-12 14-16 24z"/>',
      bob: '<path d="M52 96c0-38 20-60 48-60s48 22 48 60v2c-6-10-10-22-14-32H66c-4 10-8 22-14 32z"/>',
      bun: '<circle cx="100" cy="36" r="17"/><path d="M54 94c0-36 20-56 46-56s46 20 46 56c-6-16-18-28-46-30-28 2-40 14-46 30z"/>',
      ponytail: '<path d="M54 94c0-36 20-56 46-56s46 20 46 56c-6-16-18-28-46-30-28 2-40 14-46 30z"/><circle cx="140" cy="66" r="7" fill="' + c.outfitColor + '"/>',
      afro: '<path d="M54 90c4-30 22-44 46-44s42 14 46 44c-10-12-26-18-46-18s-36 6-46 18z"/>',
      spiky: '<path d="M54 94l2-30 12 8 6-22 12 14 10-24 10 22 12-14 6 22 12-8 2 30c-8-14-22-22-46-22s-38 8-46 22z"/>',
      buzz: '<path d="M56 86c2-30 20-46 44-46s42 16 44 46c-10-10-26-16-44-16s-34 6-44 16z" opacity=".55"/>',
      bald: '<ellipse cx="86" cy="62" rx="12" ry="6" fill="#fff" opacity=".35"/>'
    };
    if (hf[c.hair]) P.push('<g fill="' + (c.hair === 'bald' ? 'none' : grad(hc, 'h')) + '">' + hf[c.hair] + '</g>');
    if (c.hair === 'bald') P.push(hf.bald);
    // glasses
    const fr = c.glasses === 'retro' ? '#8a4b2a' : ink;
    if (c.glasses === 'round') P.push('<g fill="#ffffff" fill-opacity=".18" stroke="' + fr + '" stroke-width="3"><circle cx="82" cy="100" r="13"/><circle cx="118" cy="100" r="13"/><path d="M95 99q5-4 10 0" fill="none"/></g>');
    if (c.glasses === 'square' || c.glasses === 'retro') P.push('<g fill="#ffffff" fill-opacity=".18" stroke="' + fr + '" stroke-width="' + (c.glasses === 'retro' ? 4 : 3) + '" stroke-linejoin="round"><rect x="67" y="89" width="29" height="22" rx="6"/><rect x="104" y="89" width="29" height="22" rx="6"/><path d="M96 98h8" fill="none"/></g>');
    if (c.glasses === 'sun') P.push('<g><path d="M64 92h30q2 18-14 20-16-2-16-20zM106 92h30q0 18-16 20-16-2-14-20z" fill="' + ink + '"/><path d="M94 95h12" stroke="' + ink + '" stroke-width="3"/><path d="M70 96l8 8M112 96l8 8" stroke="#fff" stroke-width="2.4" opacity=".55" stroke-linecap="round"/></g>');
    if (c.glasses === 'visor') P.push('<rect x="60" y="90" width="80" height="20" rx="10" fill="#ddff00" opacity=".92"/><rect x="66" y="94" width="30" height="5" rx="2.5" fill="#fff" opacity=".7"/>');
    // headwear
    if (c.head === 'headphones') P.push('<path d="M50 96c0-34 22-58 50-58s50 24 50 58" fill="none" stroke="' + dark(oc, 0.35) + '" stroke-width="7" stroke-linecap="round"/><rect x="40" y="86" width="18" height="30" rx="9" fill="' + grad(dark(oc, 0.25)) + '"/><rect x="142" y="86" width="18" height="30" rx="9" fill="' + grad(dark(oc, 0.25)) + '"/>');
    if (c.head === 'beanie') P.push('<path d="M52 82c0-30 20-48 48-48s48 18 48 48z" fill="' + grad(oc) + '"/><rect x="50" y="74" width="100" height="16" rx="8" fill="' + dark(oc, 0.15) + '"/><circle cx="100" cy="32" r="9" fill="' + lite(oc, 0.4) + '"/>');
    if (c.head === 'cap') P.push('<path d="M54 80c0-28 20-44 46-44s46 16 46 44z" fill="' + grad(oc) + '"/><path d="M100 76h62c4 0 4 8-2 10-20 4-40 2-60-2z" fill="' + dark(oc, 0.18) + '"/><circle cx="100" cy="38" r="4" fill="' + dark(oc, 0.25) + '"/>');
    if (c.head === 'beret') P.push('<path d="M50 70c4-22 34-32 58-28 22 4 38 14 36 26-26 6-66 8-94 2z" fill="' + grad('#1e1e1e') + '"/><path d="M104 40l2-8" stroke="#1e1e1e" stroke-width="4" stroke-linecap="round"/>');
    if (c.head === 'bandana') P.push('<path d="M54 74c10-12 28-18 46-18s36 6 46 18l-2 10c-12-8-28-12-44-12s-32 4-44 12z" fill="' + grad(oc) + '"/><circle cx="74" cy="72" r="2" fill="#fff" opacity=".7"/><circle cx="100" cy="66" r="2" fill="#fff" opacity=".7"/><circle cx="126" cy="72" r="2" fill="#fff" opacity=".7"/>');
    if (c.gear.includes('pencil')) P.push('<g transform="rotate(-38 148 78)"><rect x="140" y="74" width="40" height="8" rx="2" fill="#f5c542"/><path d="M180 74l9 4-9 4z" fill="#e9b48a"/><path d="M186.5 76.8l2.5 1.2-2.5 1.2z" fill="' + ink + '"/><rect x="136" y="74" width="6" height="8" rx="2" fill="#ff8aa0"/></g>');
    if (c.gear.includes('earphones')) P.push('<circle cx="54" cy="104" r="5" fill="#fff"/><circle cx="146" cy="104" r="5" fill="#fff"/><path d="M54 108c0 30 20 40 46 60M146 108c0 30-20 40-46 60" stroke="#fff" stroke-width="2" fill="none"/>');
    P.push('</g>');
    // held gear, in front
    const held = { laptop: '<g class="ch-gear"><path d="M62 204h76l8 16H54z" fill="' + grad('#d9d6cf') + '"/><rect x="66" y="172" width="68" height="34" rx="6" fill="' + grad('#bfbbb3') + '"/><circle cx="100" cy="189" r="5" fill="#fff" opacity=".85"/></g>',
      tablet: '<g class="ch-gear"><rect x="26" y="160" width="48" height="58" rx="8" fill="' + grad('#2b2926') + '"/><rect x="31" y="165" width="38" height="48" rx="4" fill="#8fd3ff"/><path d="M38 200c6-12 12-4 18-14s8 6 10 2" stroke="#685bc7" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M80 150l-14 48" stroke="#f0eee9" stroke-width="4" stroke-linecap="round"/></g>',
      camera: '<g class="ch-gear"><rect x="120" y="166" width="56" height="40" rx="9" fill="' + grad('#2b2926') + '"/><rect x="130" y="160" width="18" height="10" rx="3" fill="#2b2926"/><circle cx="148" cy="186" r="13" fill="' + grad('#5b5852') + '"/><circle cx="148" cy="186" r="7" fill="#1a1a1a"/><circle cx="145" cy="183" r="2.4" fill="#fff" opacity=".8"/><circle cx="168" cy="174" r="2.4" fill="#ff5a26"/></g>',
      clapper: '<g class="ch-gear"><rect x="24" y="178" width="52" height="34" rx="4" fill="' + grad('#2b2926') + '"/><path d="M24 168l50-10 3 12-50 10z" fill="#f0eee9"/><path d="M32 166l6 10M44 164l6 10M56 161l6 10M68 159l6 10" stroke="#2b2926" stroke-width="4"/><path d="M32 194h36M32 202h22" stroke="#f0eee9" stroke-width="2.4"/></g>',
      mic: '<g class="ch-gear"><rect x="146" y="150" width="18" height="30" rx="9" fill="' + grad('#5b5852') + '"/><path d="M150 158h10M150 164h10M150 170h10" stroke="#2b2926" stroke-width="1.6"/><path d="M155 180v26M144 210h22" stroke="#2b2926" stroke-width="4" stroke-linecap="round"/></g>',
      mug: '<g class="ch-gear"><rect x="132" y="176" width="30" height="34" rx="7" fill="' + grad('#ff5a26') + '"/><path d="M162 184c10 0 10 18 0 18" stroke="#ff5a26" stroke-width="5" fill="none"/><path d="M140 168c0-6 6-6 6-12M150 168c0-6 6-6 6-12" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".8"/></g>',
      sketchbook: '<g class="ch-gear"><rect x="24" y="166" width="54" height="46" rx="5" fill="' + grad('#f5c542') + '"/><path d="M30 166v46" stroke="#1e1e1e" stroke-width="3" stroke-dasharray="3 4"/><circle cx="54" cy="186" r="9" fill="none" stroke="#1e1e1e" stroke-width="2.4"/><path d="M44 202h22" stroke="#1e1e1e" stroke-width="2.4" stroke-linecap="round"/></g>',
      book: '<g class="ch-gear"><path d="M26 176l26-6 26 6v38l-26-6-26 6z" fill="' + grad('#685bc7') + '"/><path d="M52 170v38" stroke="#fff" stroke-width="2" opacity=".7"/><path d="M32 186l14-3M32 194l14-3M58 183l14 3M58 191l14 3" stroke="#fff" stroke-width="2" opacity=".75"/></g>',
      plant: '<g class="ch-gear"><path d="M136 188h28l-4 24h-20z" fill="' + grad('#e86aa6') + '"/><path d="M150 188c-2-14-12-18-16-24 10 0 16 8 16 18 0-14 6-22 16-24-4 8-12 14-14 30" fill="#2fb37a"/></g>'
    };
    let heldN = 0;
    c.gear.forEach((g) => { if (held[g] && heldN < 2) { P.push(held[g]); heldN++; } });
    // gradient defs
    const defs = Object.values(G).map((g) => {
      if (g.k === 'bg') return '<radialGradient id="' + g.id + '" cx="30%" cy="20%" r="95%"><stop offset="0" stop-color="' + lite(g.col, 0.35) + '"/><stop offset=".6" stop-color="' + g.col + '"/><stop offset="1" stop-color="' + dark(g.col, 0.12) + '"/></radialGradient>';
      return '<radialGradient id="' + g.id + '" cx="34%" cy="28%" r="78%"><stop offset="0" stop-color="' + lite(g.col, g.k === 's' ? 0.32 : 0.3) + '"/><stop offset=".55" stop-color="' + g.col + '"/><stop offset="1" stop-color="' + dark(g.col, 0.22) + '"/></radialGradient>';
    }).join('');
    const vb = o.crop === 'head' ? '38 26 124 124' : '0 0 200 220';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" class="ch' + (o.anim ? ' ch-anim' : '') + '" role="img" aria-label="' + String(o.label || 'Character').replace(/"/g, '') + '"><defs>' + defs +
      '<filter id="' + id + 'f" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="3" stdDeviation="2.4" flood-color="#000" flood-opacity=".18"/></filter></defs><g filter="url(#' + id + 'f)">' + P.join('') + '</g></svg>';
  }
  // Small avatars: one image per character, reused everywhere (cheap in long tables).
  const URLS = new Map();
  function url(cfg, crop) {
    const k = JSON.stringify(norm(cfg)) + (crop || '');
    if (!URLS.has(k)) { if (URLS.size > 300) URLS.clear(); URLS.set(k, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(cfg, { crop, round: crop === 'head' }))); }
    return URLS.get(k);
  }
  window.CO_CHAR = { svg, url, random, norm, gearFor, OPT, DEF, lum };
})();
