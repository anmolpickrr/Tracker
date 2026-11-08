/**
 * Creative Ops Tracker – data API
 *
 * A Google Apps Script web app that reads the creative requirement sheets and
 * the team list, and serves them as JSON to the Tracker dashboard
 * (https://anmolpickrr.github.io/Tracker/). It runs as the person who deploys
 * it, so it can read sheets that are shared only inside the company.
 *
 * Setup (once): see README.md → "Connect the dashboard to the sheets".
 *   1. Paste this file into a new Apps Script project and put your sheet links in CONFIG.
 *   2. Run createKey() once and copy the key from the log.
 *   3. Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 *   4. Open the dashboard, click Connect, and paste the web app URL and the key.
 */

/*
 * Paste the links to your sheets below (the full URL from the browser is fine).
 * Keep the real links here, in Apps Script only: this file is public on GitHub
 * with placeholders, so the sheets' addresses never appear there.
 */
const CONFIG = {
  sources: {
    // Client creative requests ("Design Requirements (PAID)"), tab "2026".
    paid: { sheet: 'PASTE_PAID_SHEET_LINK', tab: '2026' },
    // Marketing team requests ("Design Requirements"), tab "2026 (Mkt Team)".
    mkt: { sheet: 'PASTE_MARKETING_SHEET_LINK', tab: '2026 (Mkt Team)' },
    // Earlier marketing history (Nov 2024 – Dec 2025) from the same sheet. Delete this line to leave it out.
    mkt2025: { sheet: 'PASTE_MARKETING_SHEET_LINK', tab: '2025', optional: true },
    // Team list: Name, Status (Active / Inactive), Role, Also written as, Notes. First tab.
    team: { sheet: 'PASTE_TEAM_LIST_SHEET_LINK', tab: '' }
  },
  cacheSeconds: 60
};

/* ---------- Reads ---------- */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!checkKey_(p.key)) return json_({ ok: false, error: 'bad_key' });
  const cache = CacheService.getScriptCache();
  if (!p.fresh) {
    const hit = readCache_(cache);
    if (hit) return text_(hit);
  }
  const body = JSON.stringify(readAll_());
  writeCache_(cache, body);
  return text_(body);
}

function readAll_() {
  const out = { ok: true, generatedAt: new Date().toISOString(), sources: {} };
  Object.keys(CONFIG.sources).forEach(function (name) {
    const s = CONFIG.sources[name];
    try {
      out.sources[name] = readTab_(s);
    } catch (err) {
      out.sources[name] = { error: String(err && err.message || err), optional: !!s.optional };
    }
  });
  return out;
}

function sheetId_(link) {
  if (/^PASTE_/.test(String(link || ''))) throw new Error('Paste the sheet link into CONFIG at the top of the script (still says ' + link + ').');
  const m = String(link || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/) || String(link || '').match(/^([a-zA-Z0-9_-]{20,})$/);
  if (!m) throw new Error('Paste the sheet link into CONFIG at the top of the script (found "' + link + '").');
  return m[1];
}

function readTab_(s) {
  const ss = SpreadsheetApp.openById(sheetId_(s.sheet));
  const sheet = s.tab ? ss.getSheetByName(s.tab) : ss.getSheets()[0];
  if (!sheet) throw new Error('Tab "' + s.tab + '" not found in ' + ss.getName());
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.length ? values[0] : [];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    let hasContent = false;
    for (let j = 1; j < r.length; j++) if (String(r[j]).trim() !== '') { hasContent = true; break; }
    if (!hasContent) continue; // skip empty and ID-only placeholder rows
    let end = r.length;
    while (end > 0 && String(r[end - 1]).trim() === '') end--;
    rows.push(r.slice(0, end));
  }
  return { file: ss.getName(), tab: sheet.getName(), headers: headers, rows: rows };
}

/* ---------- Team list edits (from the Team tab) ---------- */

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  if (!checkKey_(body.key)) return json_({ ok: false, error: 'bad_key' });
  if (body.action !== 'setMember') return json_({ ok: false, error: 'unknown_action' });
  const name = String(body.name || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 80) return json_({ ok: false, error: 'bad_name' });
  const status = body.status === 'Inactive' ? 'Inactive' : 'Active';

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const t = CONFIG.sources.team;
    const ss = SpreadsheetApp.openById(sheetId_(t.sheet));
    const sheet = t.tab ? ss.getSheetByName(t.tab) : ss.getSheets()[0];
    const values = sheet.getDataRange().getValues();
    const head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
    const col = function (re) { for (let i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
    const cName = col(/^name/), cStatus = col(/^status/), cRole = col(/^role/), cAlias = col(/also|alias/), cNotes = col(/^notes?/);
    if (cName < 0 || cStatus < 0) return json_({ ok: false, error: 'team_sheet_needs_name_and_status_columns' });
    let rowIndex = -1;
    for (let i = 1; i < values.length; i++) if (String(values[i][cName]).trim().toLowerCase() === name.toLowerCase()) { rowIndex = i; break; }
    if (rowIndex < 0) {
      const row = new Array(head.length).fill('');
      row[cName] = name; row[cStatus] = status;
      if (cRole >= 0 && body.role) row[cRole] = String(body.role).slice(0, 60);
      if (cAlias >= 0 && body.aliases) row[cAlias] = String(body.aliases).slice(0, 120);
      if (cNotes >= 0) row[cNotes] = 'Added from the dashboard on ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy');
      sheet.appendRow(row);
    } else {
      sheet.getRange(rowIndex + 1, cStatus + 1).setValue(status);
      if (cRole >= 0 && typeof body.role === 'string') sheet.getRange(rowIndex + 1, cRole + 1).setValue(body.role.slice(0, 60));
    }
  } finally {
    lock.releaseLock();
  }
  clearCache_();
  return json_({ ok: true, name: name, status: status });
}

/* ---------- Key ---------- */

/** Run once from the editor. The key is printed in the execution log. */
function createKey() {
  const key = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  Logger.log('Your dashboard key: ' + key);
  return key;
}

function checkKey_(k) {
  const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  return !!key && typeof k === 'string' && k === key;
}

/* ---------- Helpers ---------- */

function json_(o) { return text_(JSON.stringify(o)); }
function text_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON); }

const CHUNK = 90000;
function writeCache_(cache, body) {
  try {
    const parts = {}; const n = Math.ceil(body.length / CHUNK);
    for (let i = 0; i < n; i++) parts['d' + i] = body.slice(i * CHUNK, (i + 1) * CHUNK);
    parts.meta = String(n);
    cache.putAll(parts, CONFIG.cacheSeconds);
  } catch (err) { /* cache is a speed-up only */ }
}
function readCache_(cache) {
  const n = Number(cache.get('meta') || 0);
  if (!n) return null;
  const keys = []; for (let i = 0; i < n; i++) keys.push('d' + i);
  const got = cache.getAll(keys);
  let s = ''; for (let i = 0; i < n; i++) { if (got['d' + i] == null) return null; s += got['d' + i]; }
  return s;
}
function clearCache_() { try { CacheService.getScriptCache().remove('meta'); } catch (err) {} }

/** Optional: run from the editor to check every source opens. */
function testRead() {
  const o = readAll_();
  Object.keys(o.sources).forEach(function (k) {
    const s = o.sources[k];
    Logger.log(k + ': ' + (s.error ? 'ERROR ' + s.error : s.rows.length + ' rows from "' + s.file + '" / ' + s.tab));
  });
}
