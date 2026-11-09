#!/usr/bin/env node
/* Copies assets/data.js (the dashboard's task parser) into apps-script/Code.gs, so the reminder emails count tasks
   exactly as the dashboard does and Code.gs stays a single file to paste. Run after changing data.js:
     node tools/inline-data.js */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const gs = path.join(root, 'apps-script/Code.gs');
const B = '/* ==== BEGIN data.js (generated: copied from assets/data.js by tools/inline-data.js; do not edit here) ==== */';
const E = '/* ==== END data.js ==== */';
const code = fs.readFileSync(gs, 'utf8'), data = fs.readFileSync(path.join(root, 'assets/data.js'), 'utf8');
const a = code.indexOf(B), b = code.indexOf(E);
if (a < 0 || b < a) throw new Error('markers missing in Code.gs');
fs.writeFileSync(gs, code.slice(0, a + B.length) + '\n' + data.trim() + '\n' + code.slice(b));
console.log('data.js inlined into Code.gs');
