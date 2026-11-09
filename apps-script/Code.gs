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
 *   1. Put your sheet links in Config.gs (a second file in the same project).
 *   2. Run setup() once. It turns on change detection, creates the access list
 *      and audit log, and checks every sheet opens.
 *   3. Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 *
 * Access: once CONFIG.access.clientId is filled in, nobody gets any data without
 * signing in with an approved Google work account (see README → "Access and sign-in").
 * Until then the dashboard uses the older shared key.
 */

/* Your settings (sheet links, sign-in, owners) are in Config.gs, so this file can be replaced with a newer version without touching them. */

/* Roles, lowest first. Viewer: sees everything. Editor: also edits tasks. Admin: also team list, access and the audit log. */
const ROLES = { Viewer: 1, Editor: 2, Admin: 3 };
const NEEDS = { me: 'Viewer', ver: 'Viewer', data: 'Viewer', signout: 'Viewer', updateTask: 'Editor', setMember: 'Admin', health: 'Admin', users: 'Admin', setAccess: 'Admin', audit: 'Admin' };

/* The source's layout: its `kind`, else guessed from its name. */
function kindOf_(name) {
  const s = CONFIG.sources[name] || {};
  if (s.kind) return s.kind;
  return name === 'team' ? 'team' : /^paid/.test(name) ? 'paid' : 'mkt';
}
function teamSource_() {
  const names = Object.keys(CONFIG.sources).filter(function (n) { return kindOf_(n) === 'team'; });
  if (!names.length) throw new Error('No team list in CONFIG');
  return CONFIG.sources[names[0]];
}

/* ================= One-time setup ================= */

/** Run once from the editor: creates the key, installs change detection, checks the sheets. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY');
  if (!key && !authOn_()) key = createKey();
  if (!props.getProperty('SESSION_SECRET')) props.setProperty('SESSION_SECRET', newSecret_());
  // Change detection: any edit in a source sheet bumps the data version, so open dashboards reload within ~30 s.
  // Edits typed into the sheets are also written to the audit log.
  ScriptApp.getProjectTriggers().forEach(function (t) { if (TRIGGER_FNS.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  const seen = {}, ok = [], viewOnly = [];
  Object.keys(CONFIG.sources).forEach(function (name) {
    const id = sheetId_(CONFIG.sources[name].sheet);
    if (seen[id]) return; seen[id] = true;
    try {
      ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(id).onEdit().create();
      ScriptApp.newTrigger('onSheetChange').forSpreadsheet(id).onChange().create();
      ok.push(name);
    } catch (err) {
      // Google only allows these triggers on sheets this account can edit.
      viewOnly.push(name);
    }
  });
  bumpVersion_();
  testRead();
  Logger.log('Web app runs as: ' + Session.getEffectiveUser().getEmail());
  Logger.log('Change detection is on for: ' + (ok.join(', ') || 'none'));
  Logger.log('Edits by other scripts and integrations: ' + (driveCheckWorks_() ? 'detected too (Drive check works)' : 'NOT detected: add the Drive scope in appsscript.json (see README)'));
  if (viewOnly.length) Logger.log('NEEDS EDIT ACCESS: ' + viewOnly.join(', ') + '. This account can only view those sheets, so the dashboard can read them but cannot detect edits instantly or save changes to them. Ask the owner to make ' + Session.getEffectiveUser().getEmail() + ' an Editor, then run setup() again.');
  const book = ensureAccessBook_();
  Logger.log('Access list and audit log: ' + book.getUrl());
  if (authOn_()) {
    Logger.log('Sign-in is ON. Only approved ' + CONFIG.access.domains.map(function (d) { return '@' + d; }).join(' / ') + ' accounts can use the dashboard. Owner (always Admin): ' + owners_().join(', '));
    if (!owners_().length) Logger.log('ADD YOUR EMAIL to CONFIG.access.owners, or nobody can approve access.');
  } else {
    Logger.log('Sign-in is OFF (CONFIG.access.clientId is not filled in), so the shared key is used. Your dashboard key: ' + key);
  }
}

/** Signs everyone out of the dashboard at once (they sign in again with Google). */
function signOutEveryone() {
  PropertiesService.getScriptProperties().setProperty('SESSION_SECRET', newSecret_());
  audit_([{ who: Session.getEffectiveUser().getEmail(), role: 'Script owner', action: 'Signed everyone out', via: 'Apps Script' }]);
  Logger.log('Done: every dashboard session has ended.');
}

/** Creates a new key (old keys stop working). The key is printed in the execution log. */
function createKey() {
  const key = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  Logger.log('Your dashboard key: ' + key);
  return key;
}

const TRIGGER_FNS = ['onSheetChange', 'onSheetEdit'];

/** Trigger handler: a person edited one of the sheets. Moves the data version and records the edit in the audit log. */
function onSheetEdit(e) {
  bumpVersion_(); clearCache_();
  try { auditSheetEdit_(e); } catch (err) { console.error('audit: ' + err); }
}

/** Trigger handler: rows or columns added or removed, or other changes. */
function onSheetChange(e) {
  bumpVersion_(); clearCache_();
  try {
    const t = e && e.changeType;
    const what = { INSERT_ROW: 'Rows added in sheet', REMOVE_ROW: 'Rows deleted in sheet', INSERT_COLUMN: 'Columns added in sheet', REMOVE_COLUMN: 'Columns deleted in sheet', INSERT_GRID: 'Tab added in sheet', REMOVE_GRID: 'Tab deleted in sheet' }[t];
    if (!what || !hasAccessBook_()) return;
    let who = ''; try { who = e.user && e.user.getEmail ? e.user.getEmail() : ''; } catch (x) { /* not shared by Google */ }
    let file = ''; try { file = e.source.getName(); } catch (x) { /* ignore */ }
    audit_([{ who: who || UNKNOWN_EDITOR, role: 'Sheet editor', action: what, sheet: file, details: 'Google does not report which rows or columns. The sheet\'s version history (File → Version history) shows them.', via: 'Google Sheets' }]);
  } catch (err) { console.error('audit: ' + err); }
}

/* ================= Reads ================= */

function doGet(e) {
  const p = (e && e.parameter) || {};
  // Public: tells the dashboard whether to show Google sign-in. Contains no data.
  if (p.mode === 'config') return json_({ ok: true, api: 5, auth: authOn_(), clientId: authOn_() ? CONFIG.access.clientId : '', domains: CONFIG.access.domains });
  if (authOn_()) return json_({ ok: false, error: 'signin_required' });
  // Older shared-key access, used only while sign-in is not set up.
  if (!checkKey_(p.key)) return json_({ ok: false, error: 'bad_key' });
  if (p.mode === 'ver') return json_({ ok: true, ver: liveVersion_() });
  if (p.mode === 'health') return json_(health_());
  return text_(dataText_(!!p.fresh));
}

/* All the sheets as JSON text. The cached copy is served only while the sheets are unchanged since it was read. */
function dataText_(fresh) {
  const cache = CacheService.getScriptCache();
  const ver = liveVersion_();
  if (!fresh) {
    const hit = readCache_(cache, ver);
    if (hit) return hit;
  }
  const body = JSON.stringify(readAll_(ver));
  writeCache_(cache, body, ver);
  return body;
}

function readAll_(ver) {
  const out = { ok: true, generatedAt: new Date().toISOString(), ver: ver || liveVersion_(), sources: {} };
  Object.keys(CONFIG.sources).forEach(function (name) {
    const s = CONFIG.sources[name];
    try {
      out.sources[name] = readTab_(s);
      out.sources[name].kind = kindOf_(name);
    } catch (err) {
      out.sources[name] = { error: String(err && err.message || err), optional: !!s.optional, kind: kindOf_(name) };
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

/* Integration health: which account the web app runs as, whether change detection is on,
   and whether that account can open and edit each sheet. Shown on the dashboard's Sheet health tab. */
function health_() {
  const me = Session.getEffectiveUser().getEmail();
  const triggers = ScriptApp.getProjectTriggers().filter(function (t) { return TRIGGER_FNS.indexOf(t.getHandlerFunction()) >= 0; }).length;
  const out = { ok: true, runsAs: me, ver: liveVersion_(), liveTriggers: triggers, driveCheck: driveCheckWorks_(), checkedAt: new Date().toISOString(), sources: {} };
  out.access = { signIn: authOn_(), auditLog: hasAccessBook_() };
  try { if (hasAccessBook_()) out.access.auditRows = Math.max(0, accessBook_().getSheetByName('Audit').getLastRow() - 1); } catch (err) { /* ignore */ }
  Object.keys(CONFIG.sources).forEach(function (name) {
    const s = CONFIG.sources[name];
    try {
      const sheet = openTab_(s), ss = sheet.getParent();
      let canEdit = false;
      try {
        const owner = ss.getOwner();
        canEdit = (owner && owner.getEmail() === me) || ss.getEditors().some(function (u) { return u.getEmail() === me; });
      } catch (err) { canEdit = false; }
      out.sources[name] = { ok: true, kind: kindOf_(name), file: ss.getName(), tab: sheet.getName(), rows: Math.max(0, sheet.getLastRow() - 1), canEdit: canEdit };
    } catch (err) {
      out.sources[name] = { ok: false, kind: kindOf_(name), error: String(err && err.message || err), optional: !!s.optional };
    }
  });
  return out;
}

/* ================= Writes ================= */

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  try {
    if (!authOn_()) return keyPost_(body);
    if (body.action === 'signin') return json_(signin_(body));
    const who = sessionUser_(body.session);
    if (!who.ok) return json_(who);
    const user = who.user, need = NEEDS[body.action];
    if (!need) return json_({ ok: false, error: 'unknown_action' });
    if (ROLES[user.role] < ROLES[need]) return json_({ ok: false, error: 'forbidden', need: need, role: user.role });
    // Reads
    if (body.action === 'me') return json_({ ok: true, user: publicUser_(user) });
    if (body.action === 'ver') return json_({ ok: true, ver: liveVersion_(), role: user.role });
    if (body.action === 'data') return text_(dataText_(!!body.fresh));
    if (body.action === 'health') return json_(health_());
    if (body.action === 'users') return json_({ ok: true, users: users_().list.map(publicUser_), you: user.email, owners: owners_() });
    if (body.action === 'audit') return json_(auditRead_(body));
    if (body.action === 'signout') { audit_([{ who: user.email, role: user.role, action: 'Signed out' }]); return json_({ ok: true }); }
    // Writes: one at a time, each recorded in the audit log with before and after values.
    return json_(write_(body, user));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* Older shared-key access (only while sign-in is not set up). */
function keyPost_(body) {
  if (!checkKey_(body.key)) return json_({ ok: false, error: 'bad_key' });
  return json_(write_(body, { email: 'Shared dashboard key', role: 'Key' }));
}

function write_(body, user) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy, try again' };
  try {
    let out;
    if (body.action === 'setMember') out = setMember_(body);
    else if (body.action === 'updateTask') out = updateTask_(body);
    else if (body.action === 'setAccess') out = setAccess_(body, user);
    else out = { ok: false, error: 'unknown_action' };
    if (out.ok && body.action !== 'setAccess') { SpreadsheetApp.flush(); bumpVersion_(); clearCache_(); }
    if (out.ok && out.changes && out.changes.length) {
      audit_(out.changes.map(function (c) { return Object.assign({ who: user.email, role: user.role }, c); }));
      delete out.changes;
    }
    return out;
  } finally {
    lock.releaseLock();
  }
}

function setMember_(body) {
  const name = clean_(body.name);
  if (!name || name.length > 80) return { ok: false, error: 'bad_name' };
  const status = body.status === 'Inactive' ? 'Inactive' : 'Active';
  const sheet = openTab_(teamSource_());
  const values = sheet.getDataRange().getValues();
  const head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const col = function (re) { for (let i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  const cName = col(/^name/), cStatus = col(/^status/), cRole = col(/^role/), cAlias = col(/also|alias/), cNotes = col(/^notes?/);
  if (cName < 0 || cStatus < 0) return { ok: false, error: 'The team sheet needs Name and Status columns' };
  if (!plain_(name) || (body.role && !plain_(body.role)) || (body.aliases && !plain_(body.aliases))) return { ok: false, error: 'Names cannot start with = + - or @' };
  let rowIndex = -1;
  for (let i = 1; i < values.length; i++) if (String(values[i][cName]).trim().toLowerCase() === name.toLowerCase()) { rowIndex = i; break; }
  const where = { action: '', sheet: sheet.getParent().getName(), tab: sheet.getName(), record: name };
  const changes = [];
  if (rowIndex < 0) {
    const row = new Array(head.length).fill('');
    row[cName] = name; row[cStatus] = status;
    if (cRole >= 0 && body.role) row[cRole] = String(body.role).slice(0, 60);
    if (cAlias >= 0 && body.aliases) row[cAlias] = String(body.aliases).slice(0, 120);
    if (cNotes >= 0) row[cNotes] = 'Added from the dashboard on ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy');
    sheet.appendRow(row);
    changes.push(Object.assign({}, where, { action: 'Team member added', row: sheet.getLastRow(), field: 'Status', before: '', after: status, details: [cRole >= 0 && body.role ? 'Role: ' + body.role : '', cAlias >= 0 && body.aliases ? 'Also written as: ' + body.aliases : ''].filter(String).join('; ') }));
  } else {
    const was = String(values[rowIndex][cStatus]).trim();
    sheet.getRange(rowIndex + 1, cStatus + 1).setValue(status);
    if (was !== status) changes.push(Object.assign({}, where, { action: 'Team member updated', row: rowIndex + 1, field: 'Status', before: was, after: status }));
    if (cRole >= 0 && typeof body.role === 'string') {
      const wasRole = String(values[rowIndex][cRole]).trim(), role = body.role.slice(0, 60);
      sheet.getRange(rowIndex + 1, cRole + 1).setValue(role);
      if (wasRole !== role) changes.push(Object.assign({}, where, { action: 'Team member updated', row: rowIndex + 1, field: 'Role', before: wasRole, after: role }));
    }
  }
  return { ok: true, name: name, status: status, changes: changes };
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
 * body: { source: a name from CONFIG.sources, id, row, fields: { status?, eta?, designer?, priority?, qty? } }
 * Finds the row by its ID (using `row` as a hint), then writes only the fields given.
 */
function updateTask_(body) {
  const src = CONFIG.sources[body.source];
  if (!src || kindOf_(body.source) === 'team') return { ok: false, error: 'unknown sheet' };
  const id = clean_(body.id);
  if (!id) return { ok: false, error: 'This task has no ID in the sheet, so it can only be edited there.' };
  const f = body.fields || {};
  const sheet = openTab_(src);
  const lastCol = sheet.getLastColumn(), lastRow = sheet.getLastRow();
  const head = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return clean_(h).toLowerCase(); });
  const c = taskColumns_(kindOf_(body.source), head);

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

  // Check every field first, so a task is never left half-saved.
  if (f.status != null && c.status < 0) return { ok: false, error: 'No design status column found' };
  if (f.eta != null && c.eta < 0) return { ok: false, error: 'No Design ETA column found' };
  if (f.eta != null && f.eta !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(f.eta))) return { ok: false, error: 'bad date' };
  if (f.designer != null && c.designer < 0) return { ok: false, error: 'No designer column found' };
  if (f.designer != null && !plain_(f.designer)) return { ok: false, error: 'Designer names cannot start with = + - or @' };
  if (f.priority != null && c.priority < 0) return { ok: false, error: 'No Priority column found' };
  if (f.priority != null && clean_(f.priority) && !/^P[0-3]$/.test(clean_(f.priority).toUpperCase())) return { ok: false, error: 'bad priority' };
  if (f.qty != null && c.qty < 0) return { ok: false, error: 'Add a "No. of Creatives" column to the sheet first' };
  if (f.qty != null && !(parseInt(f.qty, 10) >= 1 && parseInt(f.qty, 10) <= 999)) return { ok: false, error: 'bad quantity' };

  const statusVal = f.status != null ? statusValue_(sheet, sheet.getRange(row, c.status + 1), c.status, String(f.status)) : null;

  // Every cell written is recorded with its value before and after.
  const changes = [];
  const where = { action: 'Task updated', sheet: sheet.getParent().getName(), tab: sheet.getName(), record: id, row: row };
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const track = function (colIndex, fn) {
    const cell = sheet.getRange(row, colIndex + 1);
    const before = cell.getDisplayValue();
    fn(cell);
    const after = cell.getDisplayValue();
    if (before !== after) changes.push(Object.assign({}, where, { field: clean_(headers[colIndex]) || ('Column ' + (colIndex + 1)), before: before, after: after }));
  };
  const written = {};
  if (f.status != null) {
    track(c.status, function (cell) { cell.setValue(statusVal); written.status = statusVal; });
    if (f.status === 'Delivered' && c.delivered >= 0 && !clean_(sheet.getRange(row, c.delivered + 1).getDisplayValue())) {
      track(c.delivered, function (d) { d.setValue(today_()); written.deliveredOn = true; });
    }
  }
  if (f.designer != null) {
    // Checked before anything is written: a name outside the sheet's dropdown is refused.
    const name = clean_(f.designer).slice(0, 120);
    const opts = listOptions_(sheet.getRange(row, c.designer + 1));
    let value = name;
    if (name && opts.length && opts.indexOf(name) < 0) {
      value = opts.filter(function (o) { return o.toLowerCase() === name.toLowerCase(); })[0];
      if (!value) return { ok: false, error: '"' + name + '" is not in the sheet\'s designer dropdown' };
    }
    f.designer = value;
  }
  if (f.eta != null) {
    track(c.eta, function (cell) {
      if (f.eta === '') cell.clearContent();
      else {
        const m = String(f.eta).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!/[dmy]/i.test(cell.getNumberFormat())) cell.setNumberFormat('d-mmm-yyyy');
        cell.setValue(new Date(+m[1], +m[2] - 1, +m[3]));
      }
    });
    written.eta = f.eta;
  }
  if (f.designer != null) { track(c.designer, function (cell) { cell.setValue(f.designer); }); written.designer = f.designer; }
  if (f.priority != null) { const p = clean_(f.priority).toUpperCase(); track(c.priority, function (cell) { cell.setValue(p); }); written.priority = p; }
  if (f.qty != null) { const q = parseInt(f.qty, 10); track(c.qty, function (cell) { cell.setValue(q); }); written.qty = q; }
  return { ok: true, row: row, written: written, changes: changes };
}

function taskColumns_(kind, head) {
  const col = function (n, nth) { let seen = 0; for (let i = 0; i < head.length; i++) if (head[i] === n) { if (seen === (nth || 0)) return i; seen++; } return -1; };
  const any = function () { for (let i = 0; i < arguments.length; i++) { const k = col(arguments[i]); if (k >= 0) return k; } return -1; };
  const find = function (re) { for (let i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  const c = { priority: col('priority'), qty: find(QTY_HEADER), delivered: find(/deliver/) };
  if (kind === 'paid') {
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

/* ================= Access: Google sign-in, roles, audit log ================= */
/*
 * How sign-in works:
 *  1. The dashboard shows Google's own sign-in button. Google gives the browser a signed ID token.
 *  2. signin_ checks that token with Google (right app, not expired, verified work email from an allowed domain).
 *  3. If the person is Approved in the access list, they get a session for CONFIG.access.sessionHours,
 *     signed with a secret only this script knows. Every request re-checks their current role and status,
 *     so revoking someone takes effect on their next request (within 30 seconds on an open dashboard).
 * The access list and the audit log live in a spreadsheet owned by the account the web app runs as.
 * Nobody else can edit it; owners get view access.
 */
const UNKNOWN_EDITOR = 'Not reported by Google';
const USER_HEAD = ['Email', 'Name', 'Role', 'Status', 'Team / role', 'Note', 'Requested on', 'Decided by', 'Decided on', 'Last sign-in', 'Sessions valid from'];
const AUDIT_HEAD = ['When', 'Who', 'Their role', 'Action', 'Sheet', 'Tab', 'Task / record', 'Row', 'Field', 'Before', 'After', 'Details', 'Via'];

function authOn_() { const id = String(CONFIG.access && CONFIG.access.clientId || ''); return !!id && !/^PASTE_/.test(id); }
function owners_() { return (CONFIG.access.owners || []).map(function (e) { return String(e).trim().toLowerCase(); }).filter(function (e) { return /@/.test(e) && !/^paste_/.test(e); }); }
function isOwner_(email) { return owners_().indexOf(String(email || '').toLowerCase()) >= 0; }
function domainOk_(email) { const d = String(email || '').split('@')[1] || ''; return CONFIG.access.domains.map(function (x) { return x.toLowerCase(); }).indexOf(d.toLowerCase()) >= 0; }

/* ---- sessions ---- */
function newSecret_() { return Utilities.getUuid() + Utilities.getUuid(); }
function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SESSION_SECRET');
  if (!s) { s = newSecret_(); props.setProperty('SESSION_SECRET', s); }
  return s;
}
function sign_(payload) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret_())); }
function sameText_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function makeSession_(email) {
  const now = Date.now();
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ e: email, i: now, x: now + (Number(CONFIG.access.sessionHours) || 12) * 3600 * 1000 }));
  return payload + '.' + sign_(payload);
}
function sessionUser_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !sameText_(sign_(parts[0]), parts[1])) return { ok: false, error: 'signin_required' };
  let p;
  try { p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); } catch (err) { return { ok: false, error: 'signin_required' }; }
  if (!p || !p.e || !(p.x > Date.now())) return { ok: false, error: 'session_expired' };
  const u = userByEmail_(p.e);
  if (!u || u.status !== 'Approved') return { ok: false, error: 'no_access', status: u ? u.status : 'none' };
  if (u.validFrom && p.i <= u.validFrom) return { ok: false, error: 'session_expired' };
  return { ok: true, user: u };
}

/* ---- Google ID token ---- */
function verifyIdToken_(t) {
  if (typeof t !== 'string' || t.length < 20 || t.length > 8192) return null;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(t), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const c = JSON.parse(res.getContentText());
  if (c.aud !== CONFIG.access.clientId) return null;
  if (c.iss !== 'accounts.google.com' && c.iss !== 'https://accounts.google.com') return null;
  if (!(Number(c.exp) * 1000 > Date.now())) return null;
  if (String(c.email_verified) !== 'true' || !c.email) return null;
  return { email: String(c.email).toLowerCase(), name: clean_(c.name || ''), hd: String(c.hd || '').toLowerCase(), picture: String(c.picture || '') };
}

/* body: { idToken, intent: 'login' | 'signup', profile: { team, note } } */
function signin_(body) {
  const g = verifyIdToken_(body.idToken);
  if (!g) return { ok: false, error: 'bad_token' };
  const dom = g.email.split('@')[1];
  if (!domainOk_(g.email) || (CONFIG.access.workspaceOnly && g.hd !== dom)) {
    audit_([{ who: g.email, action: 'Sign-in refused', details: domainOk_(g.email) ? 'Not a company-managed Google Workspace account' : 'Not an allowed domain' }]);
    return { ok: false, error: 'domain', email: g.email, domains: CONFIG.access.domains };
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy, try again' };
  try {
    let u = userByEmail_(g.email);
    const now = new Date();
    if (!u && isOwner_(g.email)) {
      appendUser_({ email: g.email, name: g.name, role: 'Admin', status: 'Approved', note: 'Owner (CONFIG.access.owners)', requestedOn: now, decidedBy: 'Owner', decidedOn: now });
      u = userByEmail_(g.email);
    }
    if (u && u.status === 'Approved') {
      const patch = { lastSignIn: now };
      if (!u.name && g.name) patch.name = g.name;
      updateUser_(u, patch);
      audit_([{ who: u.email, role: u.role, action: 'Signed in' }]);
      return { ok: true, status: 'approved', session: makeSession_(u.email), user: publicUser_(Object.assign({}, u, patch)) };
    }
    if (u && u.status === 'Pending') {
      if (body.intent === 'signup' && body.profile) updateUser_(u, profile_(body.profile));
      return { ok: true, status: 'pending', user: publicUser_(u) };
    }
    if (u) return { ok: true, status: u.status === 'Denied' ? 'denied' : 'revoked', user: publicUser_(u) };
    if (body.intent !== 'signup') return { ok: true, status: 'unknown', user: { email: g.email, name: g.name } };
    const pr = profile_(body.profile || {});
    appendUser_({ email: g.email, name: g.name, role: 'Viewer', status: 'Pending', team: pr.team || '', note: pr.note || '', requestedOn: now });
    audit_([{ who: g.email, action: 'Access requested', record: g.email, details: [pr.team ? 'Team / role: ' + pr.team : '', pr.note ? 'Note: ' + pr.note : ''].filter(String).join('; ') }]);
    notifyAdmins_(g, pr);
    return { ok: true, status: 'pending', user: { email: g.email, name: g.name } };
  } finally {
    lock.releaseLock();
  }
}
function profile_(p) {
  const t = clean_(p && p.team).slice(0, 80), n = clean_(p && p.note).slice(0, 300);
  return { team: t, note: n };
}

/* body: { email, role?, status? ('Approved' | 'Revoked' | 'Denied'), name? } — Admin only. */
function setAccess_(body, admin) {
  const email = clean_(body.email).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a full email address' };
  if (!domainOk_(email)) return { ok: false, error: 'Only ' + CONFIG.access.domains.map(function (d) { return '@' + d; }).join(' and ') + ' addresses can be given access' };
  if (isOwner_(email)) return { ok: false, error: 'The owner always has Admin access' };
  if (email === admin.email) return { ok: false, error: 'You cannot change your own access' };
  const role = body.role == null ? null : String(body.role);
  if (role != null && !ROLES[role]) return { ok: false, error: 'Unknown role' };
  const status = body.status == null ? null : String(body.status);
  if (status != null && ['Approved', 'Revoked', 'Denied'].indexOf(status) < 0) return { ok: false, error: 'Unknown status' };
  const now = new Date();
  let u = userByEmail_(email);
  const base = { who: admin.email, role: admin.role, record: email, sheet: 'Access list' };
  const changes = [];
  if (!u) {
    const name = clean_(body.name).slice(0, 80);
    if (name && !plain_(name)) return { ok: false, error: 'Names cannot start with = + - or @' };
    appendUser_({ email: email, name: name, role: role || 'Viewer', status: status || 'Approved', note: 'Added by ' + admin.email, requestedOn: now, decidedBy: admin.email, decidedOn: now });
    changes.push(Object.assign({}, base, { action: 'User added by admin', field: 'Access', before: '', after: (role || 'Viewer') + ', ' + (status || 'Approved') }));
    u = userByEmail_(email);
    if ((status || 'Approved') === 'Approved') notifyApproved_(u);
  } else {
    const patch = {};
    if (role && role !== u.role) { patch.role = role; changes.push(Object.assign({}, base, { action: 'Access changed', field: 'Role', before: u.role, after: role })); }
    if (status && status !== u.status) {
      patch.status = status;
      const action = status === 'Approved' ? (u.status === 'Pending' ? 'Access approved' : 'Access restored') : status === 'Denied' ? 'Access denied' : 'Access revoked';
      changes.push(Object.assign({}, base, { action: action, field: 'Status', before: u.status, after: status }));
      if (status !== 'Approved') patch.validFrom = now.getTime(); // ends every session they have
    }
    if (!changes.length) return { ok: true, user: publicUser_(u) };
    patch.decidedBy = admin.email; patch.decidedOn = now;
    updateUser_(u, patch);
    if (patch.status === 'Approved') notifyApproved_(Object.assign({}, u, patch));
    u = userByEmail_(email);
  }
  audit_(changes);
  return { ok: true, user: publicUser_(u) };
}

/* ---- the access list ---- */
function users_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('users');
  if (hit) { try { return JSON.parse(hit); } catch (err) { /* re-read */ } }
  const out = { list: [] };
  if (hasAccessBook_()) {
    const sh = accessBook_().getSheetByName('Users');
    const v = sh.getDataRange().getValues();
    for (let i = 1; i < v.length; i++) {
      const email = clean_(v[i][0]).toLowerCase();
      if (!email) continue;
      const u = {
        row: i + 1, email: email, name: clean_(v[i][1]), role: ROLES[clean_(v[i][2])] ? clean_(v[i][2]) : 'Viewer',
        status: ['Approved', 'Pending', 'Revoked', 'Denied'].indexOf(clean_(v[i][3])) >= 0 ? clean_(v[i][3]) : 'Pending',
        team: clean_(v[i][4]), note: clean_(v[i][5]), requestedOn: iso_(v[i][6]), decidedBy: clean_(v[i][7]), decidedOn: iso_(v[i][8]), lastSignIn: iso_(v[i][9]),
        validFrom: Number(v[i][10]) || 0
      };
      if (isOwner_(email)) { u.role = 'Admin'; u.status = 'Approved'; u.owner = true; }
      out.list.push(u);
    }
  }
  try { cache.put('users', JSON.stringify(out), 30); } catch (err) { /* only a speed-up */ }
  return out;
}
function userByEmail_(email) {
  email = String(email || '').toLowerCase();
  return users_().list.filter(function (u) { return u.email === email; })[0] || null;
}
function publicUser_(u) {
  return { email: u.email, name: u.name || '', role: u.role, status: u.status, team: u.team || '', note: u.note || '', requestedOn: u.requestedOn || '', decidedBy: u.decidedBy || '', decidedOn: u.decidedOn || '', lastSignIn: u.lastSignIn || '', owner: !!u.owner || isOwner_(u.email) };
}
function appendUser_(u) {
  const sh = accessBook_().getSheetByName('Users');
  sh.appendRow([u.email, u.name || '', u.role, u.status, u.team || '', u.note || '', u.requestedOn || '', u.decidedBy || '', u.decidedOn || '', u.lastSignIn || '', ''].map(safe_));
  CacheService.getScriptCache().remove('users');
}
function updateUser_(u, patch) {
  const sh = accessBook_().getSheetByName('Users');
  // Find the row again by email, in case rows moved since the list was cached.
  const emails = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), 1).getValues().map(function (r) { return clean_(r[0]).toLowerCase(); });
  const row = emails.indexOf(u.email) + 1;
  if (row < 2) throw new Error('User ' + u.email + ' is no longer in the access list');
  const cols = { name: 2, role: 3, status: 4, team: 5, note: 6, decidedBy: 8, decidedOn: 9, lastSignIn: 10, validFrom: 11 };
  Object.keys(patch).forEach(function (k) { if (cols[k] && patch[k] != null) sh.getRange(row, cols[k]).setValue(safe_(patch[k])); });
  CacheService.getScriptCache().remove('users');
}

/* ---- the audit log (append-only) ---- */
function hasAccessBook_() { return !!PropertiesService.getScriptProperties().getProperty('ACCESS_SHEET_ID'); }
function accessBook_() {
  const id = PropertiesService.getScriptProperties().getProperty('ACCESS_SHEET_ID');
  if (!id) throw new Error('Run setup() once in Apps Script to create the access list.');
  return SpreadsheetApp.openById(id);
}
function ensureAccessBook_() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty('ACCESS_SHEET_ID');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Creative Ops Tracker – Access & Audit Log');
    props.setProperty('ACCESS_SHEET_ID', ss.getId());
  }
  const tab = function (name, head, widths) {
    let sh = ss.getSheetByName(name);
    if (!sh) { const first = ss.getSheets()[0]; sh = (first && first.getLastRow() === 0 && !ss.getSheetByName('Users') && name === 'Users') ? first.setName(name) : ss.insertSheet(name); }
    if (sh.getLastRow() === 0) sh.appendRow(head);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
    return sh;
  };
  tab('Users', USER_HEAD);
  const audit = tab('Audit', AUDIT_HEAD);
  audit.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  // Only the account the web app runs as may edit either tab: no one can rewrite history.
  [ss.getSheetByName('Users'), audit].forEach(function (sh) {
    try {
      const prot = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0] || sh.protect();
      prot.setDescription('Written only by the Creative Ops Tracker web app');
      prot.removeEditors(prot.getEditors());
      if (prot.canDomainEdit()) prot.setDomainEdit(false);
    } catch (err) { /* protection is a second safeguard: the file is not shared for editing */ }
  });
  owners_().forEach(function (o) {
    try { ss.addViewer(o); } catch (err) { /* sharing may be restricted; the owner can still use the dashboard */ }
    if (!userByEmail_(o)) appendUser_({ email: o, name: '', role: 'Admin', status: 'Approved', note: 'Owner (CONFIG.access.owners)', requestedOn: new Date(), decidedBy: 'Owner', decidedOn: new Date() });
  });
  CacheService.getScriptCache().remove('users');
  return ss;
}

/* entries: [{ who, role, action, sheet, tab, record, row, field, before, after, details, via }] */
function audit_(entries) {
  if (!entries || !entries.length || !hasAccessBook_()) return;
  const sh = accessBook_().getSheetByName('Audit');
  const now = new Date();
  entries.forEach(function (o) {
    // appendRow is atomic, so entries written at the same moment never overwrite each other.
    sh.appendRow([now, o.who || '', o.role || '', o.action || '', o.sheet || '', o.tab || '', o.record || '', o.row || '', o.field || '', o.before == null ? '' : o.before, o.after == null ? '' : o.after, o.details || '', o.via || 'Dashboard'].map(function (v, i) { return i === 0 ? v : safe_(v); }));
  });
}

/* Newest first. body: { before: row number to continue from, limit, q (text), kind ('tasks'|'team'|'access'|'signins'), who } */
const AUDIT_KINDS = { tasks: /^(Task|Sheet|Rows|Columns|Tab)/, team: /^Team/, access: /^(Access|User|Signed everyone)/, signins: /^Sign/ };
function auditRead_(body) {
  if (!hasAccessBook_()) return { ok: true, entries: [], next: null, total: 0 };
  const sh = accessBook_().getSheetByName('Audit');
  const last = sh.getLastRow();
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 200));
  const q = clean_(body.q).toLowerCase(), who = clean_(body.who).toLowerCase(), kind = AUDIT_KINDS[body.kind] || null;
  let r = Number(body.before) > 0 ? Math.min(Number(body.before) - 1, last) : last; // next row to look at, going up
  const out = [];
  let scanned = 0;
  while (r >= 2 && out.length < limit && scanned < 20000) {
    const start = Math.max(2, r - 999);
    const vals = sh.getRange(start, 1, r - start + 1, AUDIT_HEAD.length).getValues();
    let i;
    for (i = vals.length - 1; i >= 0; i--) {
      const v = vals[i];
      const e = { n: start + i, when: iso_(v[0]), who: String(v[1]), role: String(v[2]), action: String(v[3]), sheet: String(v[4]), tab: String(v[5]), record: String(v[6]), row: String(v[7]), field: String(v[8]), before: String(v[9]), after: String(v[10]), details: String(v[11]), via: String(v[12]) };
      const hit = (!kind || kind.test(e.action)) && (!who || e.who.toLowerCase() === who) &&
        (!q || [e.who, e.action, e.sheet, e.tab, e.record, e.field, e.before, e.after, e.details].join(' ').toLowerCase().indexOf(q) >= 0);
      if (hit) out.push(e);
      if (out.length >= limit) { i--; break; }
    }
    scanned += vals.length - 1 - i;
    r = start + i;
  }
  // `next` continues the listing: send it back as `before` to get older entries.
  const next = r >= 2 ? r + 1 : null;
  return { ok: true, entries: out, next: next, total: Math.max(0, last - 1) };
}

/* An edit typed into a tab the dashboard reads: who, which task, which column, value before and after. */
function auditSheetEdit_(e) {
  if (!e || !e.range || !hasAccessBook_()) return;
  const range = e.range, sheet = range.getSheet(), ss = sheet.getParent();
  const name = sourceFor_(ss, sheet);
  if (!name) return;
  const kind = kindOf_(name);
  let who = ''; try { who = e.user && e.user.getEmail ? e.user.getEmail() : ''; } catch (x) { /* not shared by Google */ }
  const lastCol = Math.max(1, sheet.getLastColumn());
  const head = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const c = kind === 'team' ? { id: 0 } : taskColumns_(kind, head.map(function (h) { return clean_(h).toLowerCase(); }));
  const r0 = range.getRow(), c0 = range.getColumn(), nr = range.getNumRows(), nc = range.getNumColumns();
  const base = { who: who || UNKNOWN_EDITOR, role: 'Sheet editor', action: 'Sheet edited', sheet: ss.getName(), tab: sheet.getName(), via: 'Google Sheets' };
  const colName = function (k) { return clean_(head[k - 1]) || ('Column ' + k); };
  if (nr === 1 && nc === 1) {
    const after = range.getDisplayValue();
    const before = serialToDate_(e.oldValue == null ? '' : String(e.oldValue), after);
    if (before === after) return;
    const id = r0 > 1 ? clean_(sheet.getRange(r0, c.id + 1).getDisplayValue()) : '(header row)';
    audit_([Object.assign(base, { record: id, row: r0, field: colName(c0), before: before, after: after })]);
    return;
  }
  // Pastes, fills and multi-cell deletes: Google does not give the old values, so record the new ones per row.
  const vals = range.getDisplayValues();
  const rows = Math.min(nr, 50), entries = [];
  const ids = sheet.getRange(r0, c.id + 1, rows, 1).getDisplayValues();
  for (let i = 0; i < rows; i++) {
    const parts = [];
    for (let j = 0; j < nc && parts.join('; ').length < 800; j++) parts.push(colName(c0 + j) + ': ' + (vals[i][j] === '' ? '(blank)' : vals[i][j]));
    entries.push(Object.assign({}, base, { record: r0 + i === 1 ? '(header row)' : clean_(ids[i][0]), row: r0 + i, field: nc === 1 ? colName(c0) : nc + ' columns', before: '(not reported by Google for multi-cell edits: see the sheet\'s version history)', after: parts.join('; ').slice(0, 1000) }));
  }
  if (nr > rows) entries.push(Object.assign({}, base, { record: '', row: (r0 + rows) + '–' + (r0 + nr - 1), field: nc + ' columns', details: (nr - rows) + ' more rows changed in the same edit (range ' + range.getA1Notation() + ')' }));
  audit_(entries);
}
function sourceFor_(ss, sheet) {
  const id = ss.getId(), tab = sheet.getName();
  const names = Object.keys(CONFIG.sources);
  for (let i = 0; i < names.length; i++) {
    const s = CONFIG.sources[names[i]];
    let sid; try { sid = sheetId_(s.sheet); } catch (err) { continue; }
    if (sid !== id) continue;
    if (s.tab ? s.tab === tab : ss.getSheets()[0].getName() === tab) return names[i];
  }
  return null;
}
/* Google gives the old value of a date cell as a day number (e.g. 46295): show it as a date. */
function serialToDate_(before, after) {
  if (!/^\d{5}(\.\d+)?$/.test(before) || !/[a-z]{3}|\d{1,4}[-\/.]\d{1,2}[-\/.]\d{1,4}/i.test(after)) return before;
  const d = new Date(Math.round((Number(before) - 25569) * 86400000));
  return Utilities.formatDate(d, 'UTC', 'd-MMM-yyyy');
}

/* ---- emails ---- */
function notifyAdmins_(g, pr) {
  if (!CONFIG.access.emailAdmins) return;
  try {
    const to = users_().list.filter(function (u) { return u.role === 'Admin' && u.status === 'Approved'; }).map(function (u) { return u.email; });
    if (!to.length) return;
    MailApp.sendEmail({
      to: to.join(','), subject: 'Creative Ops Tracker: ' + (g.name || g.email) + ' asked for access',
      body: (g.name || g.email) + ' (' + g.email + ') asked for access to the Creative Ops Tracker.\n' + (pr.team ? '\nTeam / role: ' + pr.team : '') + (pr.note ? '\nNote: ' + pr.note : '') +
        '\n\nApprove or decline it on the Access tab: ' + CONFIG.access.dashboardUrl + '#access\n\nNobody gets any access until an admin approves it.'
    });
  } catch (err) { console.error('mail: ' + err); }
}
function notifyApproved_(u) {
  if (!CONFIG.access.emailAdmins || !u) return;
  try {
    MailApp.sendEmail({ to: u.email, subject: 'You now have access to the Creative Ops Tracker', body: 'Hi' + (u.name ? ' ' + u.name.split(' ')[0] : '') + ',\n\nYou have ' + u.role + ' access to the Creative Ops Tracker. Sign in with this Google account: ' + CONFIG.access.dashboardUrl });
  } catch (err) { console.error('mail: ' + err); }
}

/* Text that a spreadsheet would read as a formula is stored as plain text. */
function safe_(v) {
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean' || v == null) return v == null ? '' : v;
  const s = String(v).slice(0, 2000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function plain_(s) { return !/^[=+\-@]/.test(clean_(s)); }
function iso_(v) { return v instanceof Date && !isNaN(v) ? v.toISOString() : (v ? String(v) : ''); }

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
function bumpVersion_() { PropertiesService.getScriptProperties().setProperty('DATA_VER', String(Date.now())); try { CacheService.getScriptCache().remove('livever'); } catch (err) {} }

/*
 * The data version open dashboards poll every 30 seconds. It moves when:
 *  - someone edits a sheet (the edit triggers installed by setup), or
 *  - Google Drive's "last modified" time of any source sheet changes, which also covers edits by
 *    other scripts, forms and integrations that edit triggers never see.
 * Checked at most every 10 seconds, however many dashboards are open.
 */
function liveVersion_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('livever');
  if (hit) return hit;
  let v = Number(version_()) || 0;
  const seen = {};
  Object.keys(CONFIG.sources).forEach(function (name) {
    let id;
    try { id = sheetId_(CONFIG.sources[name].sheet); } catch (err) { return; }
    if (seen[id]) return; seen[id] = true;
    try { v = Math.max(v, DriveApp.getFileById(id).getLastUpdated().getTime()); } catch (err) { /* without Drive access, edit triggers still work */ }
  });
  const s = String(v);
  cache.put('livever', s, 10);
  return s;
}
function driveCheckWorks_() {
  try { DriveApp.getFileById(sheetId_(CONFIG.sources[Object.keys(CONFIG.sources)[0]].sheet)).getLastUpdated(); return true; } catch (err) { return false; }
}

function checkKey_(k) {
  const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  return !!key && typeof k === 'string' && k === key;
}

function json_(o) { return text_(JSON.stringify(o)); }
function text_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON); }

const CHUNK = 90000;
function writeCache_(cache, body, ver) {
  try {
    const parts = {}; const n = Math.ceil(body.length / CHUNK);
    for (let i = 0; i < n; i++) parts['d' + i] = body.slice(i * CHUNK, (i + 1) * CHUNK);
    parts.meta = n + '|' + ver;
    cache.putAll(parts, CONFIG.cacheSeconds);
  } catch (err) { /* the cache is only a speed-up */ }
}
function readCache_(cache, ver) {
  const meta = String(cache.get('meta') || '').split('|');
  const n = Number(meta[0] || 0);
  if (!n || meta[1] !== String(ver)) return null;
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
