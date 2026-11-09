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
const NEEDS = { me: 'Viewer', ver: 'Viewer', data: 'Viewer', signout: 'Viewer', directory: 'Viewer', notes: 'Viewer', noteSave: 'Viewer', noteDelete: 'Viewer', noteAction: 'Viewer', prefs: 'Viewer', feed: 'Viewer', history: 'Viewer', updateTask: 'Editor', settings: 'Admin', saveSettings: 'Admin', setMember: 'Admin', health: 'Admin', users: 'Admin', setAccess: 'Admin', audit: 'Admin' };
/* Daily reminders (IST). Optional overrides in Config.gs: reminders: { morning: 10, evening: 18, email: true } */
/* Admin settings (saved from the dashboard's Access page) override Config.gs, which overrides these defaults. */
const SETTING_DEFAULTS = { morning: '10:00', evening: '18:00', email: true, chat: '', presence: true };
function settings_() {
  const cfg = (typeof CONFIG !== 'undefined' && CONFIG.reminders) || {};
  const fromCfg = {}; ['morning', 'evening'].forEach(function (k) { if (cfg[k] != null) fromCfg[k] = typeof cfg[k] === 'number' ? (cfg[k] < 10 ? '0' : '') + cfg[k] + ':00' : String(cfg[k]); });
  if (cfg.email != null) fromCfg.email = !!cfg.email;
  let saved = {}; try { saved = JSON.parse(PropertiesService.getScriptProperties().getProperty('SETTINGS') || '{}'); } catch (err) { saved = {}; }
  return Object.assign({}, SETTING_DEFAULTS, fromCfg, saved);
}
const hhmm_ = function (t) { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/* Kept for the setup log; the reminder check reads settings_() each time. */
const REMIND = { get morning() { return settings_().morning; }, get evening() { return settings_().evening; }, get email() { return settings_().email; } };
const IST = 'Asia/Kolkata';

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
  Logger.log('Access list, notes and audit log: ' + book.getUrl());
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'remindersTick') ScriptApp.deleteTrigger(t); });
  if (authOn_()) {
    ScriptApp.newTrigger('remindersTick').timeBased().everyMinutes(10).create();
    snapshot_(Utilities.formatDate(new Date(), IST, 'yyyy-MM-dd'));
    Logger.log('Daily reminders: ' + REMIND.morning + ' and ' + REMIND.evening + ' IST' + (REMIND.email ? ', by email and on the dashboard' : ', on the dashboard only') + '. Note reminders are emailed within 10 minutes of their time.');
  }
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
    if (body.action === 'ver') {
      const set = settings_();
      const out = { ok: true, ver: liveVersion_(), role: user.role, remind: { morning: set.morning, evening: set.evening }, presenceOn: set.presence };
      if (set.presence) presenceBeat_(user, body.at);
      if (user.role === 'Admin') { out.pending = users_().list.filter(function (u) { return u.status === 'Pending'; }).length; if (set.presence) out.presence = presenceList_(); }
      return json_(out);
    }
    if (body.action === 'feed') return json_(feed_(user));
    if (body.action === 'history') return json_({ ok: true, days: history_() });
    if (body.action === 'settings') { const st = settings_(); return json_({ ok: true, settings: Object.assign({}, st, { chat: st.chat ? 'set' : '' }) }); }
    if (body.action === 'data') return text_(dataText_(!!body.fresh));
    if (body.action === 'health') return json_(health_());
    if (body.action === 'users') return json_({ ok: true, users: users_().list.map(publicUser_), you: user.email, owners: owners_() });
    if (body.action === 'audit') return json_(auditRead_(body));
    if (body.action === 'directory') return json_({ ok: true, people: users_().list.filter(function (u) { return u.status === 'Approved'; }).map(function (u) { return { email: u.email, name: u.name || '', photo: photo_(u.photo) }; }) });
    if (body.action === 'notes') return json_(notesList_(user));
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
    else if (body.action === 'noteSave') out = noteSave_(body, user);
    else if (body.action === 'noteDelete') out = noteDelete_(body, user);
    else if (body.action === 'noteAction') out = noteAction_(body, user);
    else if (body.action === 'prefs') out = prefs_(body, user);
    else if (body.action === 'saveSettings') out = saveSettings_(body, user);
    else out = { ok: false, error: 'unknown_action' };
    // Only edits to the task sheets change the dashboard's data version.
    if (out.ok && (body.action === 'setMember' || body.action === 'updateTask')) { SpreadsheetApp.flush(); bumpVersion_(); clearCache_(); }
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
const USER_HEAD = ['Email', 'Name', 'Role', 'Status', 'Team / role', 'Note', 'Requested on', 'Decided by', 'Decided on', 'Last sign-in', 'Sessions valid from', 'Photo', 'Email reminders', 'Last active'];
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
    const photo = photo_(g.picture);
    if (u) {
      // Every sign-in attempt refreshes the profile shown to admins (name, photo, last sign-in).
      const patch = { lastSignIn: now };
      if (g.name && g.name !== u.name) patch.name = g.name;
      if (photo && photo !== u.photo) patch.photo = photo;
      if (u.status === 'Pending' && body.intent === 'signup' && body.profile) {
        const pr = profile_(body.profile);
        if (pr.team) patch.team = pr.team;
        if (pr.note) patch.note = pr.note;
      }
      updateUser_(u, patch);
      u = Object.assign({}, u, patch);
    }
    if (u && u.status === 'Approved') {
      audit_([{ who: u.email, role: u.role, action: 'Signed in' }]);
      return { ok: true, status: 'approved', session: makeSession_(u.email), user: publicUser_(u) };
    }
    if (u && u.status === 'Pending') return { ok: true, status: 'pending', user: publicUser_(u) };
    if (u) {
      audit_([{ who: u.email, role: 'No access', action: 'Sign-in blocked', record: u.email, details: u.status === 'Denied' ? 'Request was declined' : 'Access was revoked' }]);
      return { ok: true, status: u.status === 'Denied' ? 'denied' : 'revoked', user: publicUser_(u) };
    }
    // Someone new, from an allowed domain: whether they chose Log in or Sign up, they become a
    // pending request. They get no session and no data until an admin approves them.
    const pr = profile_(body.profile || {});
    appendUser_({ email: g.email, name: g.name, role: 'Viewer', status: 'Pending', team: pr.team || '', note: pr.note || '', requestedOn: now, lastSignIn: now, photo: photo });
    audit_([{ who: g.email, action: 'Access requested', record: g.email, details: [body.intent === 'signup' ? 'Signed up' : 'Logged in without access', pr.team ? 'Team / role: ' + pr.team : '', pr.note ? 'Note: ' + pr.note : ''].filter(String).join('; ') }]);
    notifyAdmins_(g, pr);
    return { ok: true, status: 'pending', isNew: true, user: publicUser_(userByEmail_(g.email) || { email: g.email, name: g.name, role: 'Viewer', status: 'Pending' }) };
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
        validFrom: Number(v[i][10]) || 0, photo: photo_(v[i][11]), reminders: clean_(v[i][12]) !== 'Off', lastActive: iso_(v[i][13])
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
  return { email: u.email, name: u.name || '', role: u.role, status: u.status, team: u.team || '', note: u.note || '', requestedOn: u.requestedOn || '', decidedBy: u.decidedBy || '', decidedOn: u.decidedOn || '', lastSignIn: u.lastSignIn || '', photo: photo_(u.photo), reminders: u.reminders !== false, lastActive: u.lastActive || '', owner: !!u.owner || isOwner_(u.email) };
}
/* Only Google profile photos are kept and shown. */
function photo_(url) { const s = String(url || ''); return /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\/[^\s"'<>]+$/i.test(s) ? s.slice(0, 500) : ''; }
function userHeader_(sh) {
  if (String(sh.getRange(1, 12).getValue()) !== 'Photo') sh.getRange(1, 12).setValue('Photo');
  if (String(sh.getRange(1, 13).getValue()) !== 'Email reminders') sh.getRange(1, 13).setValue('Email reminders');
  if (String(sh.getRange(1, 14).getValue()) !== 'Last active') sh.getRange(1, 14).setValue('Last active');
}
function appendUser_(u) {
  const sh = accessBook_().getSheetByName('Users');
  userHeader_(sh);
  sh.appendRow([u.email, u.name || '', u.role, u.status, u.team || '', u.note || '', u.requestedOn || '', u.decidedBy || '', u.decidedOn || '', u.lastSignIn || '', '', u.photo || ''].map(safe_));
  CacheService.getScriptCache().remove('users');
}
function updateUser_(u, patch) {
  const sh = accessBook_().getSheetByName('Users');
  // Find the row again by email, in case rows moved since the list was cached.
  const emails = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), 1).getValues().map(function (r) { return clean_(r[0]).toLowerCase(); });
  const row = emails.indexOf(u.email) + 1;
  if (row < 2) throw new Error('User ' + u.email + ' is no longer in the access list');
  userHeader_(sh);
  const cols = { name: 2, role: 3, status: 4, team: 5, note: 6, decidedBy: 8, decidedOn: 9, lastSignIn: 10, validFrom: 11, photo: 12, reminders: 13, lastActive: 14 };
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
  tab('Notes', NOTE_HEAD);
  tab('History', HIST_HEAD);
  const audit = tab('Audit', AUDIT_HEAD);
  audit.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  // Only the account the web app runs as may edit either tab: no one can rewrite history.
  [ss.getSheetByName('Users'), ss.getSheetByName('Notes'), audit].forEach(function (sh) {
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
const AUDIT_KINDS = { tasks: /^(Task|Sheet|Rows|Columns|Tab)/, team: /^Team/, access: /^(Access|User|Signed everyone|Settings|Reminder setting)/, signins: /^Sign/, notes: /^Note/ };
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

/* ================= Notes: meeting minutes and personal notes ================= */
/*
 * Stored in the Notes tab of the access book (owned by the web app account, not shared for editing).
 * Who sees a note:
 *   private – its author (and admins)          team – everyone with dashboard access
 *   people  – its author, the people it is shared with, everyone @mentioned and everyone with an action item (and admins)
 * Who changes it: its author or an admin. Anyone with an action item can tick that item.
 * Every create, edit and delete is in the audit log; deleted notes are kept, marked deleted.
 */
const NOTE_HEAD = ['ID', 'Created', 'Created by', 'Updated', 'Updated by', 'Title', 'Meeting date', 'Type', 'Brand', 'Category', 'Visibility', 'Shared with', 'Mentions', 'Body', 'Action items', 'Reminder', 'Follow-ups', 'Reminder sent', 'Deleted', 'Deleted by', 'Pinned'];
const NOTE_TYPES = ['Meeting', 'Discussion', 'Personal'];
function notesSheet_() {
  const ss = accessBook_();
  let sh = ss.getSheetByName('Notes');
  if (!sh) { sh = ss.insertSheet('Notes'); sh.appendRow(NOTE_HEAD); sh.setFrozenRows(1); }
  return sh;
}
function parseJson_(s, d) { try { const v = JSON.parse(String(s || '')); return v == null ? d : v; } catch (err) { return d; } }
function noteFromRow_(v, row) {
  return {
    row: row, id: String(v[0]), createdAt: iso_(v[1]), createdBy: clean_(v[2]).toLowerCase(), updatedAt: iso_(v[3]), updatedBy: clean_(v[4]).toLowerCase(),
    title: String(v[5] || ''), date: v[6] instanceof Date ? Utilities.formatDate(v[6], IST, 'yyyy-MM-dd') : clean_(v[6]), type: clean_(v[7]) || 'Meeting', brand: clean_(v[8]), category: clean_(v[9]),
    visibility: ['private', 'team', 'people'].indexOf(clean_(v[10])) >= 0 ? clean_(v[10]) : 'private', sharedWith: parseJson_(v[11], []), mentions: parseJson_(v[12], []),
    body: String(v[13] || ''), actions: parseJson_(v[14], []), reminder: clean_(v[15]), followUps: String(v[16] || ''), reminderSent: clean_(v[17]), deleted: v[18] === true || clean_(v[18]) === 'TRUE', pinned: v[20] === true || clean_(v[20]) === 'TRUE'
  };
}
function noteReaders_(n) {
  const out = {}; out[n.createdBy] = 1;
  (n.sharedWith || []).forEach(function (e) { out[String(e).toLowerCase()] = 1; });
  (n.mentions || []).forEach(function (m) { if (m && m.email) out[String(m.email).toLowerCase()] = 1; });
  (n.actions || []).forEach(function (a) { if (a && a.email) out[String(a.email).toLowerCase()] = 1; });
  return out;
}
function canSeeNote_(n, u) {
  if (n.deleted) return false;
  if (u.role === 'Admin' || n.createdBy === u.email || n.visibility === 'team') return true;
  return n.visibility === 'people' && !!noteReaders_(n)[u.email];
}
function canEditNote_(n, u) { return u.role === 'Admin' || n.createdBy === u.email; }
function allNotes_() {
  if (!hasAccessBook_()) return [];
  const sh = notesSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  const v = sh.getRange(2, 1, last - 1, NOTE_HEAD.length).getValues();
  return v.map(function (r, i) { return noteFromRow_(r, i + 2); }).filter(function (n) { return n.id; });
}
function publicNote_(n, u) {
  const o = Object.assign({}, n); delete o.row; delete o.reminderSent; delete o.deleted;
  o.canEdit = canEditNote_(n, u);
  return o;
}
function notesList_(u) {
  const names = {}; users_().list.forEach(function (x) { names[x.email] = x.name || x.email; });
  const list = allNotes_().filter(function (n) { return canSeeNote_(n, u); })
    .sort(function (a, b) { return String(b.date || b.createdAt).localeCompare(String(a.date || a.createdAt)) || String(b.updatedAt).localeCompare(String(a.updatedAt)); })
    .map(function (n) { const o = publicNote_(n, u); o.createdByName = names[n.createdBy] || n.createdBy; o.updatedByName = names[n.updatedBy] || n.updatedBy; return o; });
  return { ok: true, notes: list };
}
/* Cleans what the browser sent: lengths, known values, and people who actually have access. */
function noteInput_(b) {
  const approved = {}; users_().list.forEach(function (x) { if (x.status === 'Approved') approved[x.email] = x; });
  const emailOk = function (e) { e = clean_(e).toLowerCase(); return approved[e] ? e : ''; };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : Utilities.formatDate(new Date(), IST, 'yyyy-MM-dd');
  const reminder = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(b.reminder || '')) ? String(b.reminder) : '';
  const actions = (Array.isArray(b.actions) ? b.actions : []).slice(0, 100).map(function (a) {
    return { id: clean_(a.id).slice(0, 40) || Utilities.getUuid().slice(0, 8), text: clean_(a.text).slice(0, 300), assignee: clean_(a.assignee).slice(0, 80), email: emailOk(a.email),
      due: /^\d{4}-\d{2}-\d{2}$/.test(String(a.due || '')) ? String(a.due) : '', done: !!a.done, doneBy: clean_(a.doneBy).slice(0, 120), doneAt: clean_(a.doneAt).slice(0, 40) };
  }).filter(function (a) { return a.text; });
  const mentions = (Array.isArray(b.mentions) ? b.mentions : []).slice(0, 50).map(function (m) { return { name: clean_(m.name).slice(0, 80), email: emailOk(m.email) }; }).filter(function (m) { return m.name || m.email; });
  return {
    title: clean_(b.title).slice(0, 160) || 'Untitled note', date: date, type: NOTE_TYPES.indexOf(b.type) >= 0 ? b.type : 'Meeting',
    brand: clean_(b.brand).slice(0, 80), category: clean_(b.category).slice(0, 60), visibility: ['private', 'team', 'people'].indexOf(b.visibility) >= 0 ? b.visibility : 'private',
    sharedWith: (Array.isArray(b.sharedWith) ? b.sharedWith : []).map(emailOk).filter(String).slice(0, 50), mentions: mentions,
    body: String(b.body == null ? '' : b.body).slice(0, 40000), actions: actions, reminder: reminder, followUps: String(b.followUps == null ? '' : b.followUps).slice(0, 4000), pinned: !!b.pinned
  };
}
function noteRowValues_(id, created, createdBy, n, now, by, reminderSent) {
  return [id, created, createdBy, now, by, n.title, n.date, n.type, n.brand, n.category, n.visibility, JSON.stringify(n.sharedWith), JSON.stringify(n.mentions), n.body, JSON.stringify(n.actions), n.reminder, n.followUps, reminderSent || '', false, '', n.pinned]
    // Dates and times are kept as plain text (IST), so Sheets never turns them into another time zone.
    .map(function (v, i) { return i === 1 || i === 3 || typeof v === 'boolean' ? v : (i === 6 || i === 15 || i === 17) && v ? "'" + v : safe_(v); });
}
function noteSave_(b, u) {
  const n = noteInput_(b.note || {}), now = new Date(), sh = notesSheet_();
  if (!b.id) {
    const id = 'N' + Utilities.formatDate(now, IST, 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 6);
    sh.appendRow(noteRowValues_(id, now, u.email, n, now, u.email, ''));
    return { ok: true, id: id, changes: [{ action: 'Note created', sheet: 'Notes', record: n.title, field: 'Visibility', after: n.visibility, details: n.type + (n.brand ? ' · ' + n.brand : '') + ' · ' + n.actions.length + ' action items' }] };
  }
  const cur = allNotes_().filter(function (x) { return x.id === String(b.id); })[0];
  if (!cur || cur.deleted) return { ok: false, error: 'This note no longer exists.' };
  if (!canEditNote_(cur, u)) return { ok: false, error: 'Only the person who wrote this note (or an admin) can change it.' };
  if (b.updatedAt && cur.updatedAt && b.updatedAt !== cur.updatedAt) return { ok: false, error: 'stale', note: publicNote_(cur, u) };
  // A changed reminder time is sent again.
  const sent = n.reminder && n.reminder === cur.reminder ? cur.reminderSent : '';
  sh.getRange(cur.row, 1, 1, NOTE_HEAD.length).setValues([noteRowValues_(cur.id, new Date(cur.createdAt), cur.createdBy, n, now, u.email, sent)]);
  const changed = ['title', 'date', 'type', 'brand', 'category', 'visibility', 'body', 'reminder', 'followUps'].filter(function (k) { return String(cur[k] || '') !== String(n[k] || ''); });
  if (JSON.stringify(cur.actions) !== JSON.stringify(n.actions)) changed.push('action items');
  if (JSON.stringify(cur.sharedWith) !== JSON.stringify(n.sharedWith)) changed.push('shared with');
  return { ok: true, id: cur.id, changes: changed.length ? [{ action: 'Note edited', sheet: 'Notes', record: n.title, field: changed.join(', '), before: cur.visibility === n.visibility ? '' : cur.visibility, after: cur.visibility === n.visibility ? '' : n.visibility, details: cur.createdBy === u.email ? '' : 'Note by ' + cur.createdBy }] : [] };
}
function noteDelete_(b, u) {
  const cur = allNotes_().filter(function (x) { return x.id === String(b.id); })[0];
  if (!cur || cur.deleted) return { ok: false, error: 'This note no longer exists.' };
  if (!canEditNote_(cur, u)) return { ok: false, error: 'Only the person who wrote this note (or an admin) can delete it.' };
  const sh = notesSheet_();
  sh.getRange(cur.row, 19, 1, 2).setValues([[true, u.email]]);
  sh.getRange(cur.row, 4, 1, 2).setValues([[new Date(), u.email]]);
  return { ok: true, changes: [{ action: 'Note deleted', sheet: 'Notes', record: cur.title, details: cur.createdBy === u.email ? '' : 'Note by ' + cur.createdBy }] };
}
function noteAction_(b, u) {
  const cur = allNotes_().filter(function (x) { return x.id === String(b.id); })[0];
  if (!cur || !canSeeNote_(cur, u)) return { ok: false, error: 'This note no longer exists.' };
  const a = (cur.actions || []).filter(function (x) { return x.id === String(b.actionId); })[0];
  if (!a) return { ok: false, error: 'That action item is gone.' };
  if (!canEditNote_(cur, u) && a.email !== u.email) return { ok: false, error: 'Only the person it is assigned to, the author or an admin can tick this.' };
  a.done = !!b.done; a.doneBy = a.done ? u.email : ''; a.doneAt = a.done ? new Date().toISOString() : '';
  notesSheet_().getRange(cur.row, 15).setValue(JSON.stringify(cur.actions));
  return { ok: true, actions: cur.actions, changes: [{ action: 'Note action item ' + (a.done ? 'done' : 'reopened'), sheet: 'Notes', record: cur.title, field: 'Action item', before: a.done ? 'Open' : 'Done', after: a.done ? 'Done' : 'Open', details: a.text }] };
}
function prefs_(b, u) {
  updateUser_(u, { reminders: b.reminders ? 'On' : 'Off' });
  return { ok: true, reminders: !!b.reminders, changes: [{ action: 'Reminder setting changed', record: u.email, field: 'Email reminders', before: u.reminders === false ? 'Off' : 'On', after: b.reminders ? 'On' : 'Off' }] };
}

/* ================= Daily reminders (IST) ================= */
/* Runs every 10 minutes (setup installs it). Sends the 10:00 and 18:00 IST emails once a day each, and note reminders when due. */
function remindersTick() {
  if (!authOn_() || !hasAccessBook_()) return;
  const now = new Date(), day = Utilities.formatDate(now, IST, 'yyyy-MM-dd');
  const mins = Number(Utilities.formatDate(now, IST, 'H')) * 60 + Number(Utilities.formatDate(now, IST, 'mm'));
  const props = PropertiesService.getScriptProperties(), set = settings_();
  const lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return;
  try {
    ['morning', 'evening'].forEach(function (k) {
      const at = hhmm_(set[k]); if (at == null) return;
      const key = 'SENT_' + k.toUpperCase();
      if (mins >= at && mins < at + 180 && props.getProperty(key) !== day) {
        props.setProperty(key, day);
        if (set.email) sendDigests_(k);
        if (set.chat) postChat_(k, set.chat);
      }
    });
    // One snapshot a day of the point-in-time numbers (open, overdue…), so later comparisons are exact.
    if (mins >= 9 * 60 && props.getProperty('SNAP_DAY') !== day) { props.setProperty('SNAP_DAY', day); snapshot_(day); }
    sendNoteReminders_(now);
  } finally { lock.releaseLock(); }
}
/** Run from the editor to email yourself today's morning briefing (nothing else is sent). */
function sendTestReminder() { sendDigests_('morning', Session.getEffectiveUser().getEmail()); Logger.log('Sent a test morning briefing to ' + Session.getEffectiveUser().getEmail()); }

/* The task list, built exactly as the dashboard builds it (CODATA below is the dashboard's own data.js). */
function tasksNow_() {
  const body = JSON.parse(dataText_(false)), src = body.sources || {};
  const keys = Object.keys(src).filter(function (k) { return !src[k].error && CODATA.kindOf(k, src[k].kind) !== 'team'; });
  const tasks = CODATA.buildTasks(keys.map(function (k) { return { kind: CODATA.kindOf(k, src[k].kind), rows: CODATA.parseSource(CODATA.kindOf(k, src[k].kind), src[k], k) }; }));
  const teamKey = Object.keys(src).filter(function (k) { return CODATA.kindOf(k, src[k].kind) === 'team'; })[0];
  const team = CODATA.parseTeam(teamKey ? src[teamKey] : null) || [];
  const byKey = {}, alias = {}, first = {};
  team.forEach(function (m) {
    byKey[m.name.toLowerCase()] = m;
    String(m.aliases || '').split(/[,;\/]/).map(function (a) { return a.trim().toLowerCase(); }).filter(String).forEach(function (a) { alias[a] = m; });
    const f = m.name.split(' ')[0].toLowerCase(); first[f] = first.hasOwnProperty(f) ? null : m;
  });
  const resolve = function (n) { const k = String(n || '').toLowerCase(); return byKey[k] || alias[k] || first[k.split(' ')[0]] || null; };
  tasks.forEach(function (t) { t.list = t.designers ? t.designers.split(' + ').map(function (d) { const r = resolve(d); return r ? r.name : d; }) : []; });
  return { tasks: tasks, resolve: resolve };
}
function sendDigests_(kind, onlyTo) {
  const t = tasksNow_(), today = Utilities.formatDate(new Date(), IST, 'yyyy-MM-dd');
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 864e5), IST, 'yyyy-MM-dd');
  const open = t.tasks.filter(function (r) { return r.open; });
  const team = {
    overdue: open.filter(function (r) { return r.eta && r.eta < today; }), today: open.filter(function (r) { return r.eta === today; }),
    tomorrow: open.filter(function (r) { return r.eta === tomorrow; }), unassigned: open.filter(function (r) { return !r.list.length; }),
    review: t.tasks.filter(function (r) { return r.stage === 'Under review'; }), deliveredToday: t.tasks.filter(function (r) { return r.stage === 'Delivered' && r.ddate === today; })
  };
  const notes = allNotes_().filter(function (n) { return !n.deleted; });
  users_().list.filter(function (u) { return u.status === 'Approved' && u.reminders !== false && (!onlyTo || u.email === onlyTo); }).forEach(function (u) {
    const me = t.resolve(u.name || '') ; const mine = me ? open.filter(function (r) { return r.list.indexOf(me.name) >= 0; }) : [];
    const myActions = [];
    notes.forEach(function (n) { (n.actions || []).forEach(function (a) { if (!a.done && a.email === u.email) myActions.push({ note: n.title, text: a.text, due: a.due }); }); });
    const html = digestHtml_(kind, u, team, mine, myActions, today);
    try {
      MailApp.sendEmail({ to: u.email, subject: (kind === 'morning' ? 'Morning briefing' : 'Evening wrap-up') + ' · ' + team.overdue.length + ' overdue, ' + team.today.length + ' due today · Creative Ops', htmlBody: html, name: 'Creative Ops Tracker' });
    } catch (err) { console.error('mail: ' + err); }
  });
}
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function digestHtml_(kind, u, team, mine, myActions, today) {
  const fmt = function (d) { return d ? Utilities.formatDate(new Date(d + 'T00:00:00+05:30'), IST, 'd MMM') : 'No ETA'; };
  const row = function (r) { return '<tr><td style="padding:6px 10px 6px 0;color:#111"><b>' + esc_(r.brand) + '</b> · ' + esc_(String(r.topic || '').slice(0, 70)) + '</td><td style="padding:6px 0;color:#666;white-space:nowrap;text-align:right">' + esc_(r.id || '') + ' · ' + fmt(r.eta) + '</td></tr>'; };
  const list = function (title, rs, max) { if (!rs.length) return ''; return '<h3 style="font:600 14px Arial;margin:22px 0 6px">' + esc_(title) + ' (' + rs.length + ')</h3><table style="font:13px Arial;border-collapse:collapse;width:100%">' + rs.slice(0, max || 8).map(row).join('') + '</table>' + (rs.length > (max || 8) ? '<p style="font:12px Arial;color:#666">+' + (rs.length - (max || 8)) + ' more on the dashboard</p>' : ''); };
  const stat = function (n, label, color) { return '<td style="padding:12px 14px;background:#f4f4f1;border-radius:12px;font:12px Arial;color:#555"><div style="font:600 24px Arial;color:' + (color || '#111') + '">' + n + '</div>' + label + '</td><td style="width:8px"></td>'; };
  const first = (u.name || '').split(' ')[0];
  const intro = kind === 'morning'
    ? 'Good morning' + (first ? ', ' + esc_(first) : '') + '. Here is what needs attention today: review your tasks, assignments and priorities.'
    : 'Good evening' + (first ? ', ' + esc_(first) : '') + '. Here is today\'s wrap-up: completed work, what is still pending, and tomorrow\'s priorities.';
  let h = '<div style="max-width:640px;margin:auto;font:14px/1.5 Arial;color:#111">';
  h += '<div style="background:#111;color:#fff;border-radius:18px;padding:22px 24px"><div style="font:12px Arial;color:#d6f36b;letter-spacing:.1em;text-transform:uppercase">' + (kind === 'morning' ? 'Morning briefing · ' + REMIND.morning + ' IST' : 'Evening wrap-up · ' + REMIND.evening + ' IST') + '</div><div style="font:600 22px Arial;margin-top:6px">' + Utilities.formatDate(new Date(), IST, 'EEEE, d MMMM') + '</div><p style="color:#ccc;margin:8px 0 0">' + intro + '</p></div>';
  h += '<table style="margin:16px 0;border-collapse:separate"><tr>' + stat(team.overdue.length, 'overdue', '#c2413b') + stat(team.today.length, 'due today', '#a96500') + (kind === 'evening' ? stat(team.deliveredToday.length, 'delivered today', '#1d8a5b') : stat(team.unassigned.length, 'unassigned')) + stat(team.review.length, 'in review') + '</tr></table>';
  if (mine.length) {
    h += list('Your overdue work', mine.filter(function (r) { return r.eta && r.eta < today; }));
    h += list('Yours, due today', mine.filter(function (r) { return r.eta === today; }));
    if (kind === 'evening') h += list('Yours, due tomorrow', mine.filter(function (r) { return r.eta > today; }).sort(function (a, b) { return a.eta.localeCompare(b.eta); }), 5);
  }
  if (myActions.length) h += '<h3 style="font:600 14px Arial;margin:22px 0 6px">Your action items from meeting notes (' + myActions.length + ')</h3><ul style="font:13px Arial;padding-left:18px;margin:0">' + myActions.slice(0, 10).map(function (a) { return '<li style="margin:4px 0">' + esc_(a.text) + ' <span style="color:#666">· ' + esc_(a.note) + (a.due ? ' · due ' + fmt(a.due) : '') + '</span></li>'; }).join('') + '</ul>';
  if (u.role === 'Admin' || !mine.length) {
    h += list('Team: overdue', team.overdue);
    h += list(kind === 'morning' ? 'Team: due today' : 'Team: due tomorrow', kind === 'morning' ? team.today : team.tomorrow);
    if (kind === 'evening') h += list('Delivered today', team.deliveredToday, 10);
    else h += list('Unassigned', team.unassigned, 5);
  }
  h += '<p style="margin:26px 0 0"><a href="' + esc_(CONFIG.access.dashboardUrl) + '" style="background:#d6f36b;color:#111;text-decoration:none;padding:11px 20px;border-radius:999px;font:600 14px Arial">Open the dashboard</a></p>';
  h += '<p style="font:11px Arial;color:#888;margin-top:22px">You get this at ' + REMIND.morning + ' and ' + REMIND.evening + ' IST. Turn it off in the dashboard menu (Daily emails).</p></div>';
  return h;
}
/* Note reminders: emailed to the note's author (and its action-item owners) once, at the time set (IST). */
function sendNoteReminders_(now) {
  const due = allNotes_().filter(function (n) {
    if (n.deleted || !n.reminder || n.reminderSent === n.reminder) return false;
    const at = new Date(n.reminder + ':00+05:30');
    return at <= now && now - at < 2 * 864e5;
  });
  if (!due.length) return;
  const sh = notesSheet_();
  due.forEach(function (n) {
    const to = {}; to[n.createdBy] = 1; (n.actions || []).forEach(function (a) { if (!a.done && a.email) to[a.email] = 1; });
    const open = (n.actions || []).filter(function (a) { return !a.done; });
    const html = '<div style="max-width:600px;margin:auto;font:14px/1.5 Arial;color:#111"><div style="background:#111;color:#fff;border-radius:18px;padding:20px 22px"><div style="font:12px Arial;color:#d6f36b;letter-spacing:.1em;text-transform:uppercase">Note reminder</div><div style="font:600 20px Arial;margin-top:6px">' + esc_(n.title) + '</div></div>' +
      (n.followUps ? '<h3 style="font:600 14px Arial;margin:18px 0 6px">Follow-ups</h3><p style="white-space:pre-wrap;margin:0">' + esc_(n.followUps) + '</p>' : '') +
      (open.length ? '<h3 style="font:600 14px Arial;margin:18px 0 6px">Open action items</h3><ul style="padding-left:18px;margin:0">' + open.map(function (a) { return '<li>' + esc_(a.text) + (a.assignee ? ' <span style="color:#666">· ' + esc_(a.assignee) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '') +
      '<p style="margin:22px 0 0"><a href="' + esc_(CONFIG.access.dashboardUrl) + '#notes" style="background:#d6f36b;color:#111;text-decoration:none;padding:10px 18px;border-radius:999px;font:600 14px Arial">Open notes</a></p></div>';
    Object.keys(to).forEach(function (e) { const u = userByEmail_(e); if (!u || u.status !== 'Approved') return; try { MailApp.sendEmail({ to: e, subject: 'Reminder: ' + n.title, htmlBody: html, name: 'Creative Ops Tracker' }); } catch (err) { console.error('mail: ' + err); } });
    sh.getRange(n.row, 18).setValue("'" + n.reminder);
  });
}


/* ================= Presence, activity feed, history, admin settings ================= */
/*
 * Presence (transparent: every user is told admins can see it): while the dashboard is open it reports,
 * every 30 seconds, the page in use and the task being edited (if any). Kept 3 minutes in the cache;
 * "Last active" is written to the access list at most every 10 minutes. Nothing else is collected.
 */
const PAGES_OK = ['today', 'standup', 'tasks', 'notes', 'team', 'reports', 'health', 'access'];
function presenceBeat_(u, at) {
  at = at || {};
  const rec = { email: u.email, name: u.name || u.email, at: Date.now(), page: PAGES_OK.indexOf(at.page) >= 0 ? at.page : '', task: clean_(at.task).slice(0, 40), taskLabel: clean_(at.taskLabel).slice(0, 90) };
  const cache = CacheService.getScriptCache();
  cache.put('pres:' + u.email, JSON.stringify(rec), 180);
  const last = Number(cache.get('pres-saved:' + u.email) || 0);
  if (Date.now() - last > 10 * 60 * 1000) {
    cache.put('pres-saved:' + u.email, String(Date.now()), 21600);
    try { updateUser_(u, { lastActive: new Date() }); } catch (err) { /* best effort */ }
  }
}
function presenceList_() {
  const users = users_().list.filter(function (u) { return u.status === 'Approved'; });
  const got = CacheService.getScriptCache().getAll(users.map(function (u) { return 'pres:' + u.email; }));
  return users.map(function (u) {
    let p = null; try { p = JSON.parse(got['pres:' + u.email] || 'null'); } catch (err) { p = null; }
    return { email: u.email, name: u.name || u.email, role: u.role, online: !!p && Date.now() - p.at < 90 * 1000, at: p ? new Date(p.at).toISOString() : (u.lastActive || u.lastSignIn || ''), page: p ? p.page : '', task: p ? p.task : '', taskLabel: p ? p.taskLabel : '' };
  });
}
/* Recent changes for the notification bell: task and team changes for everyone; notes and access only for admins. */
function feed_(u) {
  const r = auditRead_({ limit: 60 }), since = Date.now() - 2 * 864e5, admin = u.role === 'Admin';
  return { ok: true, entries: (r.entries || []).filter(function (e) {
    if (new Date(e.when) < since || e.who === u.email) return false;
    if (/^(Task updated|Sheet edited|Rows (added|deleted)|Team member)/.test(e.action)) return true;
    return admin && /^(Note created|Access requested|Note action)/.test(e.action);
  }).slice(0, 30).map(function (e) { return { when: e.when, who: e.who, action: e.action, record: e.record, field: e.field, before: e.before, after: e.after, sheet: e.sheet }; }) };
}
/* Daily snapshots (IST), kept in the History tab: the numbers that have no history in the sheets themselves. */
const HIST_HEAD = ['Date', 'Open', 'Overdue', 'Due today', 'Under review', 'Unassigned', 'Awaiting brief', 'Delivered this month'];
function histSheet_() { const ss = accessBook_(); let sh = ss.getSheetByName('History'); if (!sh) { sh = ss.insertSheet('History'); sh.appendRow(HIST_HEAD); sh.setFrozenRows(1); } return sh; }
function snapshot_(day) {
  try {
    const t = tasksNow_().tasks, open = t.filter(function (r) { return r.open; }), m = day.slice(0, 7);
    const sum = function (rs) { return rs.reduce(function (a, r) { return a + (r.qty || 1); }, 0); };
    const row = ["'" + day, open.length, open.filter(function (r) { return r.eta && r.eta < day; }).length, open.filter(function (r) { return r.eta === day; }).length,
      t.filter(function (r) { return r.stage === 'Under review'; }).length, open.filter(function (r) { return !r.designers; }).length, t.filter(function (r) { return r.stage === 'Awaiting brief'; }).length,
      sum(t.filter(function (r) { return r.stage === 'Delivered' && r.month === m; }))];
    const sh = histSheet_(), last = sh.getLastRow();
    const days = last > 1 ? sh.getRange(2, 1, last - 1, 1).getDisplayValues().map(function (x) { return x[0]; }) : [];
    const at = days.indexOf(day);
    if (at >= 0) sh.getRange(at + 2, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
  } catch (err) { console.error('snapshot: ' + err); }
}
function history_() {
  if (!hasAccessBook_()) return [];
  const sh = accessBook_().getSheetByName('History'); if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(Math.max(2, sh.getLastRow() - 119), 1, Math.min(120, sh.getLastRow() - 1), HIST_HEAD.length).getDisplayValues();
  return v.map(function (r) { return { date: r[0], open: +r[1], overdue: +r[2], today: +r[3], review: +r[4], unassigned: +r[5], awaiting: +r[6], deliveredMonth: +r[7] }; });
}
function saveSettings_(b, u) {
  const cur = settings_(), next = Object.assign({}, cur), changes = [];
  ['morning', 'evening'].forEach(function (k) { if (b[k] != null) { if (hhmm_(b[k]) == null) throw new Error('Times look like 10:00'); next[k] = String(b[k]); } });
  if (b.email != null) next.email = !!b.email;
  if (b.presence != null) next.presence = !!b.presence;
  if (b.chat != null) {
    const c = String(b.chat).trim();
    if (c && !/^https:\/\/chat\.googleapis\.com\/v1\/spaces\/[^\s]+$/.test(c)) throw new Error('Paste a Google Chat webhook link (it starts with https://chat.googleapis.com/v1/spaces/)');
    next.chat = c;
  }
  ['morning', 'evening', 'email', 'presence'].forEach(function (k) { if (String(cur[k]) !== String(next[k])) changes.push({ action: 'Settings changed', record: 'Reminders', field: k, before: String(cur[k]), after: String(next[k]) }); });
  if (cur.chat !== next.chat) changes.push({ action: 'Settings changed', record: 'Reminders', field: 'Google Chat', before: cur.chat ? 'set' : 'off', after: next.chat ? 'set' : 'off' });
  PropertiesService.getScriptProperties().setProperty('SETTINGS', JSON.stringify({ morning: next.morning, evening: next.evening, email: next.email, presence: next.presence, chat: next.chat }));
  return { ok: true, settings: Object.assign({}, next, { chat: next.chat ? 'set' : '' }), changes: changes };
}
/* Google Chat: one message to the team space at the briefing times (arrives as a phone notification in the Chat app). */
function postChat_(kind, url) {
  try {
    const t = tasksNow_(), today = Utilities.formatDate(new Date(), IST, 'yyyy-MM-dd'), tm = Utilities.formatDate(new Date(Date.now() + 864e5), IST, 'yyyy-MM-dd');
    const open = t.tasks.filter(function (r) { return r.open; });
    const n = { overdue: open.filter(function (r) { return r.eta && r.eta < today; }).length, today: open.filter(function (r) { return r.eta === today; }).length, unassigned: open.filter(function (r) { return !r.list.length; }).length, delivered: t.tasks.filter(function (r) { return r.stage === 'Delivered' && r.ddate === today; }).length, tomorrow: open.filter(function (r) { return r.eta === tm; }).length };
    const text = kind === 'morning'
      ? '*Morning briefing* · ' + n.overdue + ' overdue, ' + n.today + ' due today, ' + n.unassigned + ' unassigned. Review today\'s tasks and priorities: ' + CONFIG.access.dashboardUrl
      : '*Evening wrap-up* · ' + n.delivered + ' delivered today, ' + n.overdue + ' overdue, ' + n.tomorrow + ' due tomorrow: ' + CONFIG.access.dashboardUrl;
    UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify({ text: text }), muteHttpExceptions: true });
  } catch (err) { console.error('chat: ' + err); }
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

/* ==== BEGIN data.js (generated: copied from assets/data.js by tools/inline-data.js; do not edit here) ==== */
/* Creative Ops Tracker: turns raw sheet rows into one clean task list.
   Pure functions, no DOM, so they can be tested outside the browser. */
(function (root) {
  'use strict';

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /* ---------- Dates ---------- */
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const p2 = (n) => String(n).padStart(2, '0');
  const mk = (y, mo, d) => { if (y < 100) y += 2000; if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null; return String(y).padStart(4, '0') + '-' + p2(mo) + '-' + p2(d); };
  // Sheets show dates as "20-Apr-2026", "22 April 2026", "23-10-2026" (day first) or "6/3/2026" (month first).
  const parseDate = (s) => {
    s = clean(s).replace(/_/g, '-').replace(/\b(\d{1,2})(st|nd|rd|th)\b/i, '$1'); if (!s) return null; let m;
    if ((m = s.match(/^(\d{1,2})[-\s.\/]+([A-Za-z]{3,})[-\s.,\/]+(\d{2,4})$/)) && MON[m[2].slice(0, 3).toLowerCase()]) return mk(+m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1]);
    if ((m = s.match(/^([A-Za-z]{3,})[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/)) && MON[m[1].slice(0, 3).toLowerCase()]) return mk(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]);
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return mk(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/))) return mk(+m[3], +m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return mk(+m[3], +m[1], +m[2]);
    return null;
  };

  /* ---------- Columns ---------- */
  // A source's layout: as the web app reports it, else guessed from its name.
  function kindOf(key, given) {
    if (given) return given;
    return key === 'team' ? 'team' : /^paid/.test(key || '') ? 'paid' : 'mkt';
  }
  const QTY = /^(no\.?\s*of\s*creatives?|number of creatives?|qty|quantity|creatives?\s*count|count of creatives?)$/;
  // kind: 'paid' | 'mkt' (the tab's layout); key: the source's name in the web app's CONFIG (used for edits)
  function parseSource(kind, src, key) {
    const name = (src && src.kind) || kindOf(kind);
    if (!src || !Array.isArray(src.rows)) return [];
    const head = (src.headers || []).map((h) => clean(h).toLowerCase());
    const col = (n, nth = 0) => { let seen = 0; for (let i = 0; i < head.length; i++) if (head[i] === n) { if (seen === nth) return i; seen++; } return -1; };
    const any = (...names) => { for (const n of names) { const i = col(n); if (i >= 0) return i; } return -1; };
    const find = (re) => head.findIndex((h) => re.test(h));
    let ix;
    if (name === 'paid') {
      // Paid sheet: column A holds the ID and column B the request date (their headers are shifted);
      // the second "Design ETA" column holds the design status.
      ix = {
        id: 0, req: 1, eta: col('design eta', 0),
        dstatus: col('design eta', 1) >= 0 ? col('design eta', 1) : any('design status'),
        designer: any('designer/editor', 'designer', 'creator')
      };
    } else {
      ix = {
        id: any('creative_id', 'req. id', 'id') >= 0 ? any('creative_id', 'req. id', 'id') : 0,
        req: any('req. date', 'request date'), eta: any('design eta'), dstatus: any('design status'),
        designer: any('creator', 'designer/editor', 'designer')
      };
      if (ix.id === ix.req) ix.id = 0;
    }
    Object.assign(ix, {
      type: any('creative type'), brand: any('brands', 'brand'), topic: any('sku/topic'), channel: any('marketing channel'),
      priority: any('priority'), brief: any('creative brief'), owner: any('content owner'), cstatus: any('content status'),
      link: any('creative link'), file: any('open file'), live: any('live status'), liveDate: any('status live date', 'live status date'),
      delivered: find(/deliver/), qty: find(QTY)
    });
    const v = (r, k) => (ix[k] >= 0 && r[ix[k]] != null ? clean(r[ix[k]]) : '');
    const rowNums = Array.isArray(src.rowNums) ? src.rowNums : [];
    return src.rows.map((r, i) => {
      const qn = parseInt(v(r, 'qty'), 10);
      return {
        src: key || kind, row: rowNums[i] || null,
        id: v(r, 'id'), req_date: parseDate(v(r, 'req')), req_text: v(r, 'req'), type: v(r, 'type'), brand: v(r, 'brand'), topic: v(r, 'topic'),
        channel: v(r, 'channel'), priority: v(r, 'priority'), brief: v(r, 'brief'), owner: v(r, 'owner'), content_status: v(r, 'cstatus'),
        eta: parseDate(v(r, 'eta')), eta_text: v(r, 'eta'), creative_link: v(r, 'link'), design_status: v(r, 'dstatus'), designer: v(r, 'designer'),
        open_file: v(r, 'file'), live_status: v(r, 'live'), live_date: parseDate(v(r, 'liveDate')), delivered_on: parseDate(v(r, 'delivered')),
        qty: qn > 0 ? qn : null
      };
    });
  }

  function parseTeam(src) {
    if (!src || !Array.isArray(src.rows)) return [];
    const head = (src.headers || []).map((h) => clean(h).toLowerCase());
    const f = (re) => head.findIndex((h) => re.test(h));
    const ix = { name: f(/^name/), status: f(/^status/), role: f(/^role/), aliases: f(/also|alias/), notes: f(/^notes?/) };
    const v = (r, k) => (ix[k] >= 0 && r[ix[k]] != null ? clean(r[ix[k]]) : '');
    return src.rows.filter((r) => v(r, 'name')).map((r) => ({
      name: v(r, 'name'),
      status: /inactive|left|former|^no$/i.test(v(r, 'status')) ? 'Inactive' : 'Active',
      role: v(r, 'role'), aliases: v(r, 'aliases'), notes: v(r, 'notes')
    }));
  }

  /* ---------- Status ---------- */
  const title = (s) => s.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
  function stageOf(ds0, cs0) {
    const ds = clean(ds0).toUpperCase(), cs = clean(cs0).toUpperCase();
    if (['DONE', 'DELIVERED', 'COMPLETED', 'COMPLETE'].includes(ds)) return ['Delivered', false];
    if (['WIP', 'IN PROGRESS', 'WORK IN PROGRESS', 'ONGOING', 'IN-PROGRESS'].includes(ds)) return ['In progress', true];
    if (['SHARED', 'UNDER REVIEW', 'IN REVIEW', 'REVIEW', 'SENT FOR REVIEW'].includes(ds)) return ['Under review', false];
    if (['CHANGES', 'CHANGES REQUESTED', 'REVISION', 'REWORK', 'FEEDBACK'].includes(ds)) return ['Changes requested', true];
    if (['HOLD', 'ON HOLD', 'NO UPDATE', 'PAUSED'].includes(ds)) return ['On hold', false];
    if (['DEPRIORITIZED', 'DEPRIORITISED', 'REJECTED', 'CANCELLED', 'CANCELED', 'DROPPED', 'NOT NEEDED'].includes(ds)) return ['Dropped', false];
    if (ds === '' || ['TBP', 'TO BE PLANNED', 'NOT STARTED', 'PLANNED', 'TODO', 'TO DO'].includes(ds)) {
      if (cs === 'HOLD') return ['On hold', false];
      if (['INCOMPLETE BRIEF', 'PENDING', 'TBD', 'TBP', 'WIP'].includes(cs)) return ['Awaiting brief', false];
      return ['To be planned', true];
    }
    return [title(clean(ds0)), true];
  }
  const KNOWN = ['Delivered', 'In progress', 'Under review', 'Changes requested', 'On hold', 'Dropped', 'To be planned', 'Awaiting brief'];

  const TYPES = { 'video (in-house)': 'In-House Video', 'in-house video': 'In-House Video', 'a+': 'A+ Content', 'a++': 'A+ Content', 'static ad': 'Static', 'static ads': 'Static', 'carousel ': 'Carousel', 'carousel ads': 'Carousel', 'gif ads': 'GIF', 'ai ugc video': 'AI Video', 'in-house edit': 'Video Edit', 'reels': 'Reel' };
  const typeOf = (s) => { const c = clean(s); if (!c) return 'Unspecified'; return TYPES[c.toLowerCase()] || c; };

  /* ---------- Designers ---------- */
  const SPLIT = /\s*(?:,|&|\+|\/|;|\band\b)\s*/i;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Learn each person from cells that name one person, then split cells that run several names together.
  function designerSplitter(cells) {
    const counts = new Map(), display = new Map();
    for (const c0 of cells) { const c = clean(c0); if (!c) continue; for (const part of c.split(SPLIT).filter(Boolean)) { const k = part.toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1); if (!display.has(k)) display.set(k, part); } }
    const keys = [...counts.keys()];
    const firstOf = (k) => k.split(' ')[0];
    const covers = (k) => {
      const others = keys.filter((o) => o !== k && k.includes(o));
      let rest = ' ' + k + ' ';
      others.sort((x, y) => y.length - x.length).forEach((o) => { rest = rest.replace(' ' + o + ' ', ' '); });
      const leftover = rest.trim().split(' ').filter(Boolean);
      return others.length >= 2 || (others.length === 1 && leftover.length > 0 && leftover.every((w) => keys.some((o) => o !== k && firstOf(o) === w)));
    };
    const names = new Map();
    for (const k of keys) if (!covers(k)) names.set(k, display.get(k));
    const firsts = new Map();
    for (const [k, d] of names) { const f = firstOf(k); const prev = firsts.get(f); if (!prev || k.length > prev[0].length) firsts.set(f, [k, d]); }
    return (s) => {
      const c = clean(s); if (!c) return [];
      const out = [];
      for (const part of c.split(SPLIT).filter(Boolean)) {
        const k = part.toLowerCase();
        if (names.has(k) && !(k.split(' ').length === 1 && firsts.has(k) && firsts.get(k)[0] !== k)) { out.push(names.get(k)); continue; }
        const hits = [];
        for (const [kk, d] of names) { if (kk.split(' ').length < 2) continue; const i = k.search(new RegExp('\\b' + esc(kk) + '\\b')); if (i >= 0) hits.push([i, kk.length, d]); }
        for (const [f, [, d]] of firsts) { const i = k.search(new RegExp('\\b' + esc(f) + '\\b')); if (i >= 0) hits.push([i, f.length, d]); }
        hits.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
        const kept = []; let end = -1;
        for (const h of hits) { if (h[0] >= end && !kept.includes(h[2])) { kept.push(h[2]); end = h[0] + h[1]; } }
        if (kept.length) out.push(...kept); else out.push(part);
      }
      return [...new Set(out)];
    };
  }

  /* ---------- One task list ---------- */
  /* ---------- Dates that need a year correction ---------- */
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
  const goodYear = (d) => !!d && +d.slice(0, 4) >= 2020 && +d.slice(0, 4) <= 2100;
  const reYear = (d, y) => { const c = String(y).padStart(4, '0') + d.slice(4); return isNaN(Date.parse(c)) ? null : c; };
  // Re-year date d so it falls within [lo, hi] days of ref, as close to ref as possible.
  const nearYear = (d, ref, lo, hi) => {
    let best = null;
    for (const y of [+ref.slice(0, 4) - 1, +ref.slice(0, 4), +ref.slice(0, 4) + 1]) {
      const c = reYear(d, y); if (!c) continue;
      const g = days(ref, c);
      if (g >= lo && g <= hi && (!best || Math.abs(g) < Math.abs(best[1]))) best = [c, g];
    }
    return best ? best[0] : null;
  };

  // sources: [{ kind: 'paid'|'mkt', rows }] in the web app's order (newest tab of each kind first),
  // or the older form { paid: rows, mkt: rows, mkt2025: rows }.
  // Returns the task list; rows that are too incomplete to be a task are on its `ignored` property.
  function buildTasks(sources, today) {
    if (!today) { const d = new Date(); today = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
    const list = Array.isArray(sources) ? sources : Object.keys(sources).map((k) => ({ kind: kindOf(k), rows: sources[k] || [] }));
    const seenIds = { paid: new Set(), mkt: new Set() };
    const both = [], ignored = [];
    for (const s of list) {
      if (s.kind !== 'paid' && s.kind !== 'mkt') continue;
      const ids = new Set();
      for (const r of s.rows || []) {
        const id = clean(r.id);
        if (id && seenIds[s.kind].has(id)) continue; // the same task in an older tab: the newer copy wins
        if (id) ids.add(id);
        const source = s.kind === 'paid' ? 'Paid' : 'Marketing';
        if (clean(r.brand) || clean(r.type) || clean(r.topic)) both.push([r, source]);
        else ignored.push({ src: r.src || '', row: r.row || null, id, source, owner: clean(r.owner), status: clean(r.design_status) || clean(r.content_status), eta: r.eta, req: r.req_date });
      }
      ids.forEach((id) => seenIds[s.kind].add(id));
    }

    // Designer cells: an email becomes a name ("neha@shiprocket.com" → "Neha").
    const fromEmail = (v) => clean(v).replace(/([A-Za-z0-9._-]+)@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m, u) => u.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
    const designersOf = designerSplitter(both.map(([r]) => fromEmail(r.designer)));

    // One spelling per brand and per creative type (case, spacing and plurals merged; the most used spelling wins).
    const canon = (values, keyOf, pretty) => {
      const votes = new Map();
      for (const v of values) { if (!v) continue; const k = keyOf(v); const m = votes.get(k) || new Map(); m.set(v, (m.get(v) || 0) + 1); votes.set(k, m); }
      const out = new Map();
      for (const [k, m] of votes) out.set(k, pretty([...m].sort((a, b) => b[1] - a[1])[0][0]));
      return out;
    };
    const brandKey = (b) => b.toLowerCase();
    const brandName = canon(both.map(([r]) => clean(r.brand)), brandKey, (b) => (b === b.toLowerCase() ? b.replace(/\b\w/g, (c) => c.toUpperCase()) : b));
    const typeKey = (t) => t.toLowerCase().replace(/s$/, '');
    const typeName = canon(both.map(([r]) => typeOf(r.type)), typeKey, (t) => (/^gif$/i.test(t) ? 'GIF' : t));

    // Request dates of neighbouring rows (rows are entered in date order), to tell which date has a mistyped year.
    const bySrc = new Map();
    for (const [r] of both) { const k = r.src || ''; if (!bySrc.has(k)) bySrc.set(k, []); bySrc.get(k).push(r); }
    const around = new Map(), span = new Map();
    for (const [k, rows] of bySrc) {
      // The tab's usual date range (its middle 90%, so a cluster of typos cannot stretch it).
      const all = rows.map((r) => r.req_date).filter(goodYear).sort();
      if (all.length >= 20) span.set(k, [all[Math.floor(all.length * 0.05)], all[Math.ceil(all.length * 0.95) - 1]]);
      rows.sort((x, y) => (x.row || 0) - (y.row || 0));
      rows.forEach((r, i) => {
        const near = [];
        for (let j = Math.max(0, i - 6); j <= Math.min(rows.length - 1, i + 6); j++) if (j !== i && goodYear(rows[j].req_date)) near.push(rows[j].req_date);
        near.sort();
        around.set(r, near.length >= 3 ? near[near.length >> 1] : null);
      });
    }

    // Rows sharing an ID within one tab are different tasks: both are kept and flagged.
    const idCount = new Map();
    for (const [r] of both) { const id = clean(r.id); if (id) { const k = (r.src || '') + '|' + id; idCount.set(k, (idCount.get(k) || 0) + 1); } }

    const seen = new Set();
    const tasks = both.map(([r, source], i) => {
      const flags = [];
      let req = r.req_date, eta = r.eta;
      const mid = around.get(r), sp = span.get(r.src || '');
      const inSpan = (d) => !sp || (days(sp[0], d) >= -60 && days(d, sp[1]) >= -60);
      // 1. Request date: a year outside the tab's range, or far from the neighbouring rows, is a typo.
      //    Re-year it to sit just before the ETA when the ETA looks right, else next to its neighbours.
      if (req && (!goodYear(req) || !inSpan(req) || (mid && Math.abs(days(mid, req)) > 120))) {
        let fix = null;
        if (eta && goodYear(eta) && inSpan(eta)) fix = nearYear(req, eta, -150, 30);
        if (!fix && mid) fix = nearYear(req, mid, -120, 120);
        if (fix && fix !== req) { req = fix; flags.push('Request date year looks mistyped'); }
      }
      if (req && !goodYear(req)) { req = null; flags.push('Request date unreadable'); }
      // 2. ETA: should land shortly after the request date.
      if (eta && req && (Math.abs(days(req, eta)) > 200 || !goodYear(eta))) {
        const fix = nearYear(eta, req, -45, 150);
        if (fix) { eta = fix; flags.push('ETA year looks mistyped'); }
      }
      if (eta && !goodYear(eta)) { eta = null; flags.push('ETA unreadable'); }
      if (!req && clean(r.req_text) && !flags.includes('Request date unreadable')) flags.push('Request date unreadable');
      if (!eta && clean(r.eta_text) && !flags.includes('ETA unreadable')) flags.push('ETA unreadable');
      if (req && eta && days(req, eta) < 0) flags.push('ETA before request date');
      const [stage, open] = stageOf(r.design_status, r.content_status);
      if (!KNOWN.includes(stage)) flags.push('Unrecognised status');
      const des = designersOf(fromEmail(r.designer));
      if (open && !eta) flags.push('Open, no ETA');
      if ((open || stage === 'Under review') && !des.length) flags.push('No designer assigned');
      if (stage === 'Delivered' && !des.length) flags.push('Delivered, no designer');
      if (stage === 'Delivered' && !/^https?:/i.test(clean(r.creative_link))) flags.push('Delivered, no creative link');
      if (!clean(r.brand)) flags.push('No brand');
      if (clean(r.id) && idCount.get((r.src || '') + '|' + clean(r.id)) > 1) flags.push('Duplicate ID');
      let uid = (r.src || source) + ':' + (clean(r.id) || 'row' + (r.row || i + 2));
      while (seen.has(uid)) uid += '·';
      seen.add(uid);
      // Delivery date: the Delivered On column if the sheet has one, else the ETA (or request date).
      // A delivered task can't have been delivered in the future, so a later ETA counts as today.
      let ddate = stage === 'Delivered' ? (r.delivered_on || eta || req || null) : null;
      if (ddate && ddate > today) ddate = today;
      const pri = clean(r.priority).toUpperCase();
      const t0 = typeOf(r.type);
      return {
        uid, id: clean(r.id), source, src: r.src || '', row: r.row || null,
        brand: clean(r.brand) ? brandName.get(brandKey(clean(r.brand))) : 'No brand',
        topic: clean(r.topic), type: typeName.get(typeKey(t0)) || t0, channel: clean(r.channel), qty: r.qty || 1,
        priority: /^P\d$/.test(pri) ? pri : '', owner: clean(r.owner),
        designers: des.join(' + '), stage, open, design_status: clean(r.design_status), req, eta,
        ddate, month: ddate ? ddate.slice(0, 7) : '', date_basis: stage === 'Delivered' ? (r.delivered_on ? 'delivered' : eta ? 'eta' : 'request') : '',
        live_status: clean(r.live_status).replace(/^Luanch/i, 'Launch'),
        brief: clean(r.brief), link: clean(r.creative_link), file: clean(r.open_file),
        flags: flags.join('; ')
      };
    });
    Object.defineProperty(tasks, 'ignored', { value: ignored, enumerable: false });
    return tasks;
  }

  // Which optional columns a source has (so the editor only offers what can be saved).
  function columnsOf(src) {
    const head = ((src && src.headers) || []).map((h) => clean(h).toLowerCase());
    return { qty: head.some((h) => QTY.test(h)), delivered: head.some((h) => /deliver/.test(h)), priority: head.includes('priority') };
  }
  const OPEN_STAGES = ['To be planned', 'In progress', 'Changes requested'];

  const api = { kindOf, parseDate, parseSource, parseTeam, stageOf, buildTasks, designerSplitter, columnsOf, OPEN_STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CODATA = api;
})(typeof window !== 'undefined' ? window : globalThis);
/* ==== END data.js ==== */
