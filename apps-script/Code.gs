/**
 * Creative Ops Tracker – data API
 *
 * A Google Apps Script web app that reads the creative requirement sheets and
 * the team list, serves them as JSON to the Tracker dashboard
 * (https://anmolpickrr.github.io/Tracker/), and writes edits made on the
 * dashboard back into the sheets. It runs as the person who deploys it, so it
 * can read and edit sheets that are shared only inside the company.
 *
 * Setup (once): see README.md → "Connect the dashboard to the sheets".
 *   1. Put your sheet links in CONFIG below (if they are not there already).
 *   2. Run setup() once. It creates the key, turns on change detection and
 *      checks every sheet opens. Copy the key from the execution log.
 *   3. Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 *   4. Open the dashboard, click Connect, and paste the web app URL and the key.
 */

/*
 * The links to your sheets (the full URL from the browser is fine).
 * The copy of this file on GitHub has placeholders: keep real links in Apps Script only.
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

/* ================= One-time setup ================= */

/** Run once from the editor: creates the key, installs change detection, checks the sheets. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY');
  if (!key) key = createKey();
  // Change detection: any edit in a source sheet bumps the data version, so open dashboards reload within ~30 s.
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'onSheetChange') ScriptApp.deleteTrigger(t); });
  const seen = {}, ok = [], viewOnly = [];
  Object.keys(CONFIG.sources).forEach(function (name) {
    const id = sheetId_(CONFIG.sources[name].sheet);
    if (seen[id]) return; seen[id] = true;
    try {
      ScriptApp.newTrigger('onSheetChange').forSpreadsheet(id).onEdit().create();
      ScriptApp.newTrigger('onSheetChange').forSpreadsheet(id).onChange().create();
      ok.push(name);
    } catch (err) {
      // Google only allows these triggers on sheets this account can edit.
      viewOnly.push(name);
    }
  });
  bumpVersion_();
  testRead();
  Logger.log('Change detection is on for: ' + (ok.join(', ') || 'none'));
  if (viewOnly.length) Logger.log('NEEDS EDIT ACCESS: ' + viewOnly.join(', ') + '. This account can only view those sheets, so the dashboard can read them but cannot detect edits instantly or save changes to them. Ask the owner to make ' + Session.getEffectiveUser().getEmail() + ' an Editor, then run setup() again.');
  Logger.log('Your dashboard key: ' + key);
}

/** Creates a new key (old keys stop working). The key is printed in the execution log. */
function createKey() {
  const key = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  Logger.log('Your dashboard key: ' + key);
  return key;
}

/** Trigger handler: an edit in one of the sheets. */
function onSheetChange() { bumpVersion_(); clearCache_(); }

/* ================= Reads ================= */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!checkKey_(p.key)) return json_({ ok: false, error: 'bad_key' });
  if (p.mode === 'ver') return json_({ ok: true, ver: version_() });
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
  const out = { ok: true, generatedAt: new Date().toISOString(), ver: version_(), sources: {} };
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

function readTab_(s) {
  const sheet = openTab_(s);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.length ? values[0] : [];
  const rows = [], rowNums = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    let hasContent = false;
    for (let j = 1; j < r.length; j++) if (String(r[j]).trim() !== '') { hasContent = true; break; }
    if (!hasContent) continue; // skip empty and ID-only placeholder rows
    let end = r.length;
    while (end > 0 && String(r[end - 1]).trim() === '') end--;
    rows.push(r.slice(0, end));
    rowNums.push(i + 1);
  }
  return { file: sheet.getParent().getName(), tab: sheet.getName(), headers: headers, rows: rows, rowNums: rowNums };
}

/* ================= Writes ================= */

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  if (!checkKey_(body.key)) return json_({ ok: false, error: 'bad_key' });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ ok: false, error: 'busy, try again' });
  try {
    let out;
    if (body.action === 'setMember') out = setMember_(body);
    else if (body.action === 'updateTask') out = updateTask_(body);
    else out = { ok: false, error: 'unknown_action' };
    if (out.ok) { SpreadsheetApp.flush(); bumpVersion_(); clearCache_(); }
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function setMember_(body) {
  const name = clean_(body.name);
  if (!name || name.length > 80) return { ok: false, error: 'bad_name' };
  const status = body.status === 'Inactive' ? 'Inactive' : 'Active';
  const sheet = openTab_(CONFIG.sources.team);
  const values = sheet.getDataRange().getValues();
  const head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const col = function (re) { for (let i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  const cName = col(/^name/), cStatus = col(/^status/), cRole = col(/^role/), cAlias = col(/also|alias/), cNotes = col(/^notes?/);
  if (cName < 0 || cStatus < 0) return { ok: false, error: 'The team sheet needs Name and Status columns' };
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
  return { ok: true, name: name, status: status };
}

/* Status names used on the dashboard → spellings the sheets may use, preferred first. */
const STATUS_WORDS = {
  'To be planned': ['TBP', 'To be planned', 'Not started'],
  'In progress': ['WIP', 'In Progress', 'Work in progress'],
  'Under review': ['Under Review', 'Shared', 'Review', 'In Review'],
  'Changes requested': ['Changes', 'Changes Requested', 'Revision'],
  'Delivered': ['DONE', 'Delivered', 'Completed'],
  'On hold': ['HOLD', 'On Hold'],
  'Dropped': ['DEPRIORITIZED', 'Rejected', 'Cancelled']
};
const QTY_HEADER = /^(no\.?\s*of\s*creatives?|number of creatives?|qty|quantity|creatives?\s*count|count of creatives?)$/;

/**
 * body: { source: 'paid'|'mkt'|'mkt2025', id, row, fields: { status?, eta?, designer?, priority?, qty? } }
 * Finds the row by its ID (using `row` as a hint), then writes only the fields given.
 */
function updateTask_(body) {
  const src = CONFIG.sources[body.source];
  if (!src || body.source === 'team') return { ok: false, error: 'unknown sheet' };
  const id = clean_(body.id);
  if (!id) return { ok: false, error: 'This task has no ID in the sheet, so it can only be edited there.' };
  const f = body.fields || {};
  const sheet = openTab_(src);
  const lastCol = sheet.getLastColumn(), lastRow = sheet.getLastRow();
  const head = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return clean_(h).toLowerCase(); });
  const c = taskColumns_(body.source, head);

  // Locate the row: trust the hint only if the ID there still matches.
  let row = Number(body.row) || 0;
  const idAt = function (r) { return clean_(sheet.getRange(r, c.id + 1).getDisplayValue()); };
  if (!(row >= 2 && row <= lastRow && idAt(row) === id)) {
    const ids = sheet.getRange(2, c.id + 1, Math.max(1, lastRow - 1), 1).getDisplayValues();
    const hits = [];
    for (let i = 0; i < ids.length; i++) if (clean_(ids[i][0]) === id) hits.push(i + 2);
    if (hits.length !== 1) return { ok: false, error: hits.length ? 'ID ' + id + ' appears ' + hits.length + ' times in the sheet. Edit it there.' : 'ID ' + id + ' was not found in the sheet any more.' };
    row = hits[0];
  }

  const written = {};
  if (f.status != null) {
    if (c.status < 0) return { ok: false, error: 'No design status column found' };
    const cell = sheet.getRange(row, c.status + 1);
    const value = statusValue_(sheet, cell, c.status, String(f.status));
    cell.setValue(value); written.status = value;
    if (f.status === 'Delivered' && c.delivered >= 0) {
      const d = sheet.getRange(row, c.delivered + 1);
      if (!clean_(d.getDisplayValue())) { d.setValue(today_()); written.deliveredOn = true; }
    }
  }
  if (f.eta != null) {
    if (c.eta < 0) return { ok: false, error: 'No Design ETA column found' };
    const cell = sheet.getRange(row, c.eta + 1);
    if (f.eta === '') cell.clearContent();
    else {
      const m = String(f.eta).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return { ok: false, error: 'bad date' };
      if (!/[dmy]/i.test(cell.getNumberFormat())) cell.setNumberFormat('d-mmm-yyyy');
      cell.setValue(new Date(+m[1], +m[2] - 1, +m[3]));
    }
    written.eta = f.eta;
  }
  if (f.designer != null) {
    if (c.designer < 0) return { ok: false, error: 'No designer column found' };
    const name = clean_(f.designer).slice(0, 120);
    const cell = sheet.getRange(row, c.designer + 1);
    const opts = listOptions_(cell);
    if (name && opts.length && opts.indexOf(name) < 0) {
      const hit = opts.filter(function (o) { return o.toLowerCase() === name.toLowerCase(); })[0];
      if (!hit) return { ok: false, error: '"' + name + '" is not in the sheet\'s designer dropdown' };
      cell.setValue(hit); written.designer = hit;
    } else { cell.setValue(name); written.designer = name; }
  }
  if (f.priority != null) {
    if (c.priority < 0) return { ok: false, error: 'No Priority column found' };
    const p = clean_(f.priority).toUpperCase();
    if (p && !/^P[0-3]$/.test(p)) return { ok: false, error: 'bad priority' };
    sheet.getRange(row, c.priority + 1).setValue(p); written.priority = p;
  }
  if (f.qty != null) {
    if (c.qty < 0) return { ok: false, error: 'Add a "No. of Creatives" column to the sheet first' };
    const q = parseInt(f.qty, 10);
    if (!(q >= 1 && q <= 999)) return { ok: false, error: 'bad quantity' };
    sheet.getRange(row, c.qty + 1).setValue(q); written.qty = q;
  }
  return { ok: true, row: row, written: written };
}

function taskColumns_(name, head) {
  const col = function (n, nth) { let seen = 0; for (let i = 0; i < head.length; i++) if (head[i] === n) { if (seen === (nth || 0)) return i; seen++; } return -1; };
  const any = function () { for (let i = 0; i < arguments.length; i++) { const k = col(arguments[i]); if (k >= 0) return k; } return -1; };
  const find = function (re) { for (let i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  const c = { priority: col('priority'), qty: find(QTY_HEADER), delivered: find(/deliver/) };
  if (name === 'paid') {
    // Paid sheet: column A holds the ID; the second "Design ETA" column holds the design status.
    c.id = 0; c.eta = col('design eta', 0);
    c.status = col('design eta', 1) >= 0 ? col('design eta', 1) : any('design status');
    c.designer = any('designer/editor', 'designer', 'creator');
  } else {
    const idc = any('creative_id', 'req. id', 'id');
    c.id = idc >= 0 ? idc : 0; c.eta = any('design eta'); c.status = any('design status');
    c.designer = any('creator', 'designer/editor', 'designer');
  }
  return c;
}

/* Picks the spelling of a status that the sheet already uses (its dropdown first, then existing values). */
function statusValue_(sheet, cell, colIndex, stage) {
  const words = STATUS_WORDS[stage];
  if (!words) throw new Error('Unknown status "' + stage + '"');
  const opts = listOptions_(cell);
  const pick = function (pool) {
    const lower = pool.map(function (o) { return String(o).trim().toLowerCase(); });
    for (let i = 0; i < words.length; i++) { const k = lower.indexOf(words[i].toLowerCase()); if (k >= 0) return String(pool[k]).trim(); }
    return null;
  };
  if (opts.length) {
    const hit = pick(opts);
    if (!hit) throw new Error('The sheet\'s status dropdown has no option for "' + stage + '" (options: ' + opts.join(', ') + ')');
    return hit;
  }
  const used = sheet.getRange(2, colIndex + 1, Math.max(1, sheet.getLastRow() - 1), 1).getDisplayValues().map(function (r) { return r[0]; }).filter(String);
  return pick(used) || words[0];
}

function listOptions_(cell) {
  const rule = cell.getDataValidation();
  if (!rule) return [];
  const type = rule.getCriteriaType(), args = rule.getCriteriaValues();
  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return (args[0] || []).map(String);
  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) return [].concat.apply([], args[0].getDisplayValues()).filter(String);
  return [];
}

/* ================= Helpers ================= */

function sheetId_(link) {
  if (/^PASTE_/.test(String(link || ''))) throw new Error('Paste the sheet link into CONFIG at the top of the script (still says ' + link + ').');
  const m = String(link || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/) || String(link || '').match(/^([a-zA-Z0-9_-]{20,})$/);
  if (!m) throw new Error('Paste the sheet link into CONFIG at the top of the script (found "' + link + '").');
  return m[1];
}
function openTab_(s) {
  const ss = SpreadsheetApp.openById(sheetId_(s.sheet));
  const sheet = s.tab ? ss.getSheetByName(s.tab) : ss.getSheets()[0];
  if (!sheet) throw new Error('Tab "' + s.tab + '" not found in ' + ss.getName());
  return sheet;
}
function clean_(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function today_() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function version_() { return PropertiesService.getScriptProperties().getProperty('DATA_VER') || '0'; }
function bumpVersion_() { PropertiesService.getScriptProperties().setProperty('DATA_VER', String(Date.now())); }

function checkKey_(k) {
  const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  return !!key && typeof k === 'string' && k === key;
}

function json_(o) { return text_(JSON.stringify(o)); }
function text_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON); }

const CHUNK = 90000;
function writeCache_(cache, body) {
  try {
    const parts = {}; const n = Math.ceil(body.length / CHUNK);
    for (let i = 0; i < n; i++) parts['d' + i] = body.slice(i * CHUNK, (i + 1) * CHUNK);
    parts.meta = String(n);
    cache.putAll(parts, CONFIG.cacheSeconds);
  } catch (err) { /* the cache is only a speed-up */ }
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

/** Run from the editor to check every source opens. */
function testRead() {
  const o = readAll_();
  Object.keys(o.sources).forEach(function (k) {
    const s = o.sources[k];
    Logger.log(k + ': ' + (s.error ? 'ERROR ' + s.error : s.rows.length + ' rows from "' + s.file + '" / ' + s.tab));
  });
}
