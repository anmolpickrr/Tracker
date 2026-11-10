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
/* ============================ Access model ============================
 * The OWNER (CONFIG.access.owners: the Creative Head, Admin and Team Manager) has every permission and is the only
 * person who can grant or change access, read the activity log, see live team activity and change settings.
 * Everyone else gets a role (View only / Can edit / Manager) whose defaults the owner can fine-tune per person:
 * which pages they see, and whether they can edit tasks, download data, see workload estimates and other people's
 * work, manage the team list and use Fasty, and whether they see all tasks or only their own. */
const PAGE_KEYS = ['mine', 'today', 'standup', 'tasks', 'notes', 'team', 'reports', 'brands', 'health'];
const OWNER_ONLY = { users: 1, setAccess: 1, audit: 1, settings: 1, saveSettings: 1, presence: 1 };
function defaultPerms_(role) {
  const p = { pages: PAGE_KEYS.filter(function (k) { return k !== 'health'; }), edit: false, export: true, load: false, team: false, fasty: true, scope: 'all' };
  if (role === 'Editor') p.edit = true;
  if (role === 'Admin') { p.pages = PAGE_KEYS.slice(); p.edit = true; p.load = true; p.team = true; }
  return p;
}
function permsOf_(u) {
  if (!u) return defaultPerms_('Viewer');
  if (u.owner || isOwner_(u.email)) { const all = defaultPerms_('Admin'); all.owner = true; return all; }
  const p = defaultPerms_(u.role), o = u.perms || {};
  if (Array.isArray(o.pages)) p.pages = o.pages.filter(function (k) { return PAGE_KEYS.indexOf(k) >= 0; });
  ['edit', 'export', 'load', 'team', 'fasty'].forEach(function (k) { if (typeof o[k] === 'boolean') p[k] = o[k]; });
  if (o.scope === 'own' || o.scope === 'all') p.scope = o.scope;
  if (p.pages.indexOf('mine') < 0) p.pages.unshift('mine'); // everyone keeps their own work page
  return p;
}
function cleanPerms_(o) {
  if (!o || typeof o !== 'object') return null;
  const out = {};
  if (Array.isArray(o.pages)) out.pages = o.pages.map(String).filter(function (k, i, a) { return PAGE_KEYS.indexOf(k) >= 0 && a.indexOf(k) === i; });
  ['edit', 'export', 'load', 'team', 'fasty'].forEach(function (k) { if (typeof o[k] === 'boolean') out[k] = o[k]; });
  if (o.scope === 'own' || o.scope === 'all') out.scope = o.scope;
  return out;
}
function allowed_(u, action) {
  if (!NEEDS[action]) return false;
  if (OWNER_ONLY[action]) return !!(u.owner || isOwner_(u.email));
  const p = permsOf_(u);
  if (action === 'updateTask') return p.edit;
  if (action === 'setMember') return p.team;
  if (action === 'health') return p.pages.indexOf('health') >= 0;
  if (action === 'assist' || action === 'speak') return p.fasty;
  return true;
}
const NEEDS = { me: 'Viewer', ver: 'Viewer', data: 'Viewer', signout: 'Viewer', directory: 'Viewer', notes: 'Viewer', noteSave: 'Viewer', noteDelete: 'Viewer', noteAction: 'Viewer', prefs: 'Viewer', feed: 'Viewer', history: 'Viewer', assist: 'Viewer', speak: 'Viewer', meetings: 'Viewer', daily: 'Viewer', beat: 'Viewer', presence: 'Admin', updateTask: 'Editor', settings: 'Admin', saveSettings: 'Admin', setMember: 'Admin', health: 'Admin', users: 'Admin', setAccess: 'Admin', audit: 'Admin' };
/* Daily reminders (IST). Optional overrides in Config.gs: reminders: { morning: 10, evening: 18, email: true } */
/* Admin settings (saved from the dashboard's Access page) override Config.gs, which overrides these defaults. */
const SETTING_DEFAULTS = { morning: '10:00', evening: '18:00', email: true, chat: '', presence: true, model: 'auto' };
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
    if (!allowed_(user, body.action)) return json_({ ok: false, error: 'forbidden', need: OWNER_ONLY[body.action] ? 'Owner' : need, role: user.role });
    // Reads
    if (body.action === 'me') return json_({ ok: true, user: publicUser_(user) });
    if (body.action === 'beat') { if (settings_().presence) presenceBeat_(user, body.at); return json_({ ok: true }); }
    if (body.action === 'presence') return json_({ ok: true, presence: settings_().presence ? presenceList_() : [], on: !!settings_().presence });
    if (body.action === 'ver') {
      const set = settings_();
      const out = { ok: true, ver: liveVersion_(), role: user.role, perms: permsOf_(user), custom: !!(user.perms && Object.keys(user.perms).length), update: updateStatus_(), calOff: isOwner_(user.email) ? PropertiesService.getScriptProperties().getProperty('CAL_API_OFF') || '' : '', remind: { morning: set.morning, evening: set.evening }, presenceOn: set.presence, assist: assistStatus_() };
      if (set.presence) presenceBeat_(user, body.at);
      if (isOwner_(user.email)) { out.pending = users_().list.filter(function (u) { return u.status === 'Pending'; }).length; if (set.presence) out.presence = presenceList_(); }
      return json_(out);
    }
    if (body.action === 'feed') return json_(feed_(user));
    if (body.action === 'meetings') return json_(meetings_(user));
    if (body.action === 'daily') return json_(daily_());
    if (body.action === 'assist') { const r = assist_(user, body); if (r.ok && r.stop_reason !== 'tool_use' && body.voice) attachVoice_(user, r, body.voice); return json_(r); }
    if (body.action === 'speak') return json_(speak_(user, body));
    if (body.action === 'history') return json_({ ok: true, days: history_() });
    if (body.action === 'settings') { const st = settings_(); return json_({ ok: true, settings: Object.assign({}, st, { chat: st.chat ? 'set' : '' }) }); }
    if (body.action === 'data') { const pm = permsOf_(user); return text_(pm.scope === 'own' ? ownDataText_(user, !!body.fresh) : dataText_(!!body.fresh)); }
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
  'WIP': ['WIP', 'In Progress', 'Work in progress'],
  'Under review': ['UNDER REVIEW', 'Under Review', 'In Review', 'Review'],
  'Shared': ['SHARED', 'Shared'],
  'Changes requested': ['CHANGES', 'Changes', 'Changes Requested', 'Revision'],
  'Delivered': ['DONE', 'Delivered', 'Completed'],
  'Rejected': ['REJECTED', 'Rejected'],
  'No update': ['NO UPDATE', 'No Update'],
  'Hold': ['HOLD', 'On Hold'],
  'Deprioritised': ['DEPRIORITIZED', 'Deprioritized', 'Cancelled']
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
    if ((f.status === 'Delivered' || f.status === 'Rejected') && c.delivered >= 0 && !clean_(sheet.getRange(row, c.delivered + 1).getDisplayValue())) {
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
const USER_HEAD = ['Email', 'Name', 'Role', 'Status', 'Team / role', 'Note', 'Requested on', 'Decided by', 'Decided on', 'Last sign-in', 'Sessions valid from', 'Photo', 'Email reminders', 'Last active', 'Permissions'];
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
    if (body.perms) { const nu = userByEmail_(email); if (nu) updateUser_(nu, { perms: JSON.stringify(cleanPerms_(body.perms) || {}) }); }
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
    if (body.perms !== undefined) {
      const np = body.perms === null ? null : cleanPerms_(body.perms);
      const before = JSON.stringify(permsOf_(u)), after = JSON.stringify(permsOf_(Object.assign({}, u, { perms: np })));
      if (before !== after || (body.perms === null && u.perms)) { patch.perms = np ? JSON.stringify(np) : ''; changes.push(Object.assign({}, base, { action: 'Permissions changed', field: 'Permissions', before: permText_(permsOf_(u)), after: permText_(permsOf_(Object.assign({}, u, { perms: np }))) })); }
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
        validFrom: Number(v[i][10]) || 0, photo: photo_(v[i][11]), reminders: clean_(v[i][12]) !== 'Off', lastActive: iso_(v[i][13]), perms: (function () { try { return cleanPerms_(JSON.parse(String(v[i][14] || '') || 'null')); } catch (e) { return null; } })()
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
  return { email: u.email, name: u.name || '', role: u.role, status: u.status, team: u.team || '', note: u.note || '', requestedOn: u.requestedOn || '', decidedBy: u.decidedBy || '', decidedOn: u.decidedOn || '', lastSignIn: u.lastSignIn || '', photo: photo_(u.photo), reminders: u.reminders !== false, lastActive: u.lastActive || '', owner: !!u.owner || isOwner_(u.email), perms: permsOf_(u), custom: !!(u.perms && Object.keys(u.perms).length) };
}
/* Only Google profile photos are kept and shown. */
function photo_(url) { const s = String(url || ''); return /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\/[^\s"'<>]+$/i.test(s) ? s.slice(0, 500) : ''; }
function userHeader_(sh) {
  if (String(sh.getRange(1, 12).getValue()) !== 'Photo') sh.getRange(1, 12).setValue('Photo');
  if (String(sh.getRange(1, 13).getValue()) !== 'Email reminders') sh.getRange(1, 13).setValue('Email reminders');
  if (String(sh.getRange(1, 14).getValue()) !== 'Last active') sh.getRange(1, 14).setValue('Last active');
  if (String(sh.getRange(1, 15).getValue()) !== 'Permissions') sh.getRange(1, 15).setValue('Permissions');
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
  const cols = { name: 2, role: 3, status: 4, team: 5, note: 6, decidedBy: 8, decidedOn: 9, lastSignIn: 10, validFrom: 11, photo: 12, reminders: 13, lastActive: 14, perms: 15 };
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
    const to = owners_();
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
  if (isOwner_(u.email) || n.createdBy === u.email || n.visibility === 'team') return true;
  return n.visibility === 'people' && !!noteReaders_(n)[u.email];
}
function canEditNote_(n, u) { return isOwner_(u.email) || n.createdBy === u.email; }
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
// The note as stored after a save (new updatedAt, to-do ids), so the dashboard can update in place without reloading every note.
function savedNote_(id, u) { try { SpreadsheetApp.flush(); const n = allNotes_().filter(function (x) { return x.id === id; })[0]; return n ? publicNote_(n, u) : null; } catch (e) { return null; } }
function noteSave_(b, u) {
  const n = noteInput_(b.note || {}), now = new Date(), sh = notesSheet_();
  if (!b.id) {
    const id = 'N' + Utilities.formatDate(now, IST, 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 6);
    sh.appendRow(noteRowValues_(id, now, u.email, n, now, u.email, ''));
    return { ok: true, id: id, note: savedNote_(id, u), changes: [{ action: 'Note created', sheet: 'Notes', record: n.title, field: 'Visibility', after: n.visibility, details: n.type + (n.brand ? ' · ' + n.brand : '') + ' · ' + n.actions.length + ' action items' }] };
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
  return { ok: true, id: cur.id, note: savedNote_(cur.id, u), changes: changed.length ? [{ action: 'Note edited', sheet: 'Notes', record: n.title, field: changed.join(', '), before: cur.visibility === n.visibility ? '' : cur.visibility, after: cur.visibility === n.visibility ? '' : n.visibility, details: cur.createdBy === u.email ? '' : 'Note by ' + cur.createdBy }] : [] };
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
  try { maintenance_(); } catch (e) { console.log('maintenance: ' + e); }
  try { deliveryDates_(); } catch (e) { console.log('delivery dates: ' + e); }
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
    review: t.tasks.filter(function (r) { return r.shared; }), deliveredToday: t.tasks.filter(function (r) { return r.done && r.ddate === today; })
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
  if (permsOf_(u).load || !mine.length) {
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
const PAGES_OK = ['mine', 'today', 'standup', 'tasks', 'notes', 'team', 'reports', 'brands', 'health', 'access'];
function presenceBeat_(u, at) {
  at = at || {};
  const num = function (v) { const n = Number(v); return isFinite(n) ? Math.max(0, Math.min(1, Math.round(n * 1000) / 1000)) : null; };
  const rec = { email: u.email, name: u.name || u.email, photo: photo_(u.photo), at: Date.now(), page: PAGES_OK.indexOf(at.page) >= 0 ? at.page : '', task: clean_(at.task).slice(0, 40), taskLabel: clean_(at.taskLabel).slice(0, 90), doing: clean_(at.doing).slice(0, 100), idle: !!at.idle, away: !!at.away, x: num(at.x), y: num(at.y) };
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
    return { email: u.email, name: u.name || u.email, role: u.role, online: !!p && Date.now() - p.at < 90 * 1000, at: p ? new Date(p.at).toISOString() : (u.lastActive || u.lastSignIn || ''), photo: photo_(u.photo), doing: p ? p.doing || '' : '', idle: !!(p && p.idle), away: !!(p && p.away), x: p ? p.x : null, y: p ? p.y : null, page: p ? p.page : '', task: p ? p.task : '', taskLabel: p ? p.taskLabel : '' };
  });
}
/* Recent changes for the notification bell: task and team changes for everyone; notes and access only for admins. */
function feed_(u) {
  const r = auditRead_({ limit: 60 }), since = Date.now() - 2 * 864e5, admin = isOwner_(u.email);
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
      t.filter(function (r) { return r.shared; }).length, open.filter(function (r) { return !r.designers; }).length, t.filter(function (r) { return r.awaiting; }).length,
      sum(t.filter(function (r) { return r.done && r.month === m; }))];
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
  if (b.model != null) { if (!ASSIST_MODELS[b.model]) throw new Error('Unknown assistant model'); next.model = b.model; }
  if (b.chat != null) {
    const c = String(b.chat).trim();
    if (c && !/^https:\/\/chat\.googleapis\.com\/v1\/spaces\/[^\s]+$/.test(c)) throw new Error('Paste a Google Chat webhook link (it starts with https://chat.googleapis.com/v1/spaces/)');
    next.chat = c;
  }
  ['morning', 'evening', 'email', 'presence', 'model'].forEach(function (k) { if (String(cur[k]) !== String(next[k])) changes.push({ action: 'Settings changed', record: k === 'model' ? 'Fasty' : 'Reminders', field: k, before: String(cur[k]), after: String(next[k]) }); });
  if (cur.chat !== next.chat) changes.push({ action: 'Settings changed', record: 'Reminders', field: 'Google Chat', before: cur.chat ? 'set' : 'off', after: next.chat ? 'set' : 'off' });
  PropertiesService.getScriptProperties().setProperty('SETTINGS', JSON.stringify({ morning: next.morning, evening: next.evening, email: next.email, presence: next.presence, chat: next.chat, model: next.model }));
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
  /* Status definitions from the Creative Head (Nov 2026). Design Status is the primary field; Content Status only decides
     whether a task that design has not started is ready to be picked up. Every task gets exactly one stage:
       TBP (or blank) + content DONE (or blank) = To be planned  ready for a designer/editor          OPEN design work
       WIP                                          = WIP                                               OPEN design work
       CHANGES                                      = Changes requested  shared, revisions asked       OPEN design work
       UNDER REVIEW                                 = Under review  team finished, Creative Head reviewing (not workload, never overdue)
       SHARED                                       = Shared  with the client, waiting for approval    SHARED work (never overdue)
       NO UPDATE                                    = No update  shared, no reply after follow-ups     SHARED work (never overdue)
       DONE                                         = Delivered  delivered and approved                COMPLETED work
       REJECTED                                     = Rejected  delivered, rejected by client          COMPLETED work (bandwidth),
                                                                                                        not an approved delivery
       TBP (or blank) + content PENDING / INCOMPLETE BRIEF / TBP / WIP / SHARED / CHANGES
                                                    = Awaiting brief  the brief is not approved yet (sub-status says why)
       HOLD, or not started + content HOLD          = Hold
       DEPRIORITIZED                                = Deprioritised  no longer required */
  const BRIEF = { 'PENDING': 'Brief pending discussion', 'TBD': 'Brief pending discussion', 'INCOMPLETE BRIEF': 'Incomplete brief', 'INCOMPLETE': 'Incomplete brief',
    'TBP': 'Brief ready for scripting', 'WIP': 'Brief in progress', 'SHARED': 'Brief with client', 'CHANGES': 'Brief changes requested' };
  function stageOf(ds0, cs0) {
    const ds = clean(ds0).toUpperCase(), cs = clean(cs0).toUpperCase();
    if (['DONE', 'DELIVERED', 'COMPLETED', 'COMPLETE', 'APPROVED'].includes(ds)) return ['Delivered', false];
    if (ds === 'REJECTED') return ['Rejected', false];
    if (ds === 'NO UPDATE') return ['No update', false];
    if (['UNDER REVIEW', 'IN REVIEW', 'REVIEW', 'INTERNAL REVIEW'].includes(ds)) return ['Under review', false];
    if (['SHARED', 'SENT', 'SENT FOR APPROVAL', 'PENDING APPROVAL'].includes(ds)) return ['Shared', false];
    if (['WIP', 'IN PROGRESS', 'WORK IN PROGRESS', 'ONGOING', 'IN-PROGRESS'].includes(ds)) return ['WIP', true];
    if (['CHANGES', 'CHANGES REQUESTED', 'REVISION', 'REWORK', 'FEEDBACK'].includes(ds)) return ['Changes requested', true];
    if (['HOLD', 'ON HOLD', 'PAUSED'].includes(ds)) return ['Hold', false];
    if (['DEPRIORITIZED', 'DEPRIORITISED', 'CANCELLED', 'CANCELED', 'DROPPED', 'NOT NEEDED'].includes(ds)) return ['Deprioritised', false];
    if (ds === '' || ['TBP', 'TO BE PLANNED', 'NOT STARTED', 'PLANNED', 'TODO', 'TO DO'].includes(ds)) {
      if (cs === 'HOLD') return ['Hold', false];
      if (BRIEF[cs]) return ['Awaiting brief', false, BRIEF[cs]];
      return ['To be planned', true];
    }
    return [title(clean(ds0)), true];
  }
  /* What each stage counts towards (one place, used by every page, report, briefing and the assistant). */
  const GROUPS = { 'To be planned': 'open', 'WIP': 'open', 'Changes requested': 'open', 'Under review': 'review', 'Shared': 'shared', 'No update': 'shared',
    'Delivered': 'done', 'Rejected': 'done', 'Awaiting brief': 'brief', 'Hold': 'hold', 'Deprioritised': 'dropped' };
  function groupOf(stage) { const g = GROUPS[stage] || 'open'; return { group: g, open: g === 'open', done: g === 'done', shared: g === 'shared', review: g === 'review', brief: g === 'brief' }; }
  const KNOWN = Object.keys(GROUPS);

  const TYPES = { 'video (in-house)': 'In-House Video', 'in-house video': 'In-House Video', 'a+': 'A+ Content', 'a++': 'A+ Content', 'static ad': 'Static', 'static ads': 'Static', 'carousel ': 'Carousel', 'carousel ads': 'Carousel', 'gif ads': 'GIF', 'ai ugc video': 'AI Video', 'in-house edit': 'Video Edit', 'reels': 'Reel' };
  const typeOf = (s) => { const c = clean(s); if (!c) return 'Unspecified'; return TYPES[c.toLowerCase()] || c; };

  /* ---------- Designers ---------- */
  const SPLIT = /\s*(?:,|&|\+|\/|;|\band\b)\s*/i;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Learn each person from cells that name one person, then split cells that run several names together.
  // known: names from the team list (and their other spellings), so names typed together split the same way
  // however few rows are loaded (for example when a person sees only their own tasks).
  function designerSplitter(cells, known) {
    const counts = new Map(), display = new Map();
    (known || []).forEach((n0) => { const n = clean(n0); if (!n) return; const k = n.toLowerCase(); counts.set(k, (counts.get(k) || 0) + 5); if (!display.has(k)) display.set(k, n); });
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
  function buildTasks(sources, today, known) {
    if (!today) { const d = new Date(); today = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
    const list = Array.isArray(sources) ? sources : Object.keys(sources).map((k) => ({ kind: kindOf(k), rows: sources[k] || [] }));
    const seenIds = { paid: new Set(), mkt: new Set() };
    const both = [], ignored = [];
    // A Delivered On date shared by 60 or more rows of one tab was written in bulk (not real delivery days): ignore it,
    // date those tasks by their Design ETA as before, and flag them in Data health.
    for (const s of list) { const n = new Map(); (s.rows || []).forEach((r) => { if (r.delivered_on) n.set(r.delivered_on, (n.get(r.delivered_on) || 0) + 1); }); s.bulkDates = new Set([...n].filter(([, c]) => c >= 60).map(([d]) => d)); }
    for (const s of list) {
      if (s.kind !== 'paid' && s.kind !== 'mkt') continue;
      const ids = new Set();
      for (let r of s.rows || []) {
        const id = clean(r.id);
        if (id && seenIds[s.kind].has(id)) continue; // the same task in an older tab: the newer copy wins
        if (id) ids.add(id);
        const source = s.kind === 'paid' ? 'Paid' : 'Marketing';
        if (r.delivered_on && s.bulkDates.has(r.delivered_on)) { r = Object.assign({}, r, { delivered_on: null, bulk_delivered: true }); }
        if (clean(r.brand) || clean(r.type) || clean(r.topic)) both.push([r, source]);
        else ignored.push({ src: r.src || '', row: r.row || null, id, source, owner: clean(r.owner), status: clean(r.design_status) || clean(r.content_status), eta: r.eta, req: r.req_date });
      }
      ids.forEach((id) => seenIds[s.kind].add(id));
    }

    // Designer cells: an email becomes a name ("neha@shiprocket.com" → "Neha").
    // Emails become names (neha@… → Neha), and names typed together without a space ("Shubham RanaHimanshu Saxena") are separated.
    const fromEmail = (v) => clean(v).replace(/([A-Za-z0-9._-]+)@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m, u) => u.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())).replace(/([a-z])([A-Z][a-z])/g, '$1 $2');
    const designersOf = designerSplitter(both.map(([r]) => fromEmail(r.designer)), known);

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
      const [stage, open0, sub] = stageOf(r.design_status, r.content_status);
      const G = groupOf(stage), open = KNOWN.includes(stage) ? G.open : open0;
      if (!KNOWN.includes(stage)) flags.push('Unrecognised status');
      const des = designersOf(fromEmail(r.designer));
      const dsU = clean(r.design_status).toUpperCase(), csU = clean(r.content_status).toUpperCase(), idU = clean(r.id).toUpperCase();
      if (open && !eta) flags.push('Open, no ETA');
      if ((open || G.review || G.shared) && !des.length) flags.push('No designer assigned');
      if (G.done && !des.length) flags.push('Completed, no designer');
      if (G.done && !/^https?:/i.test(clean(r.creative_link))) flags.push('Completed, no creative link');
      if (!dsU && !csU) flags.push('Design and content status blank');
      if ((G.done || G.shared || G.review) && ['PENDING', 'INCOMPLETE BRIEF', 'TBD'].includes(csU)) flags.push('Design finished but brief not approved');
      if (r.bulk_delivered) flags.push('Delivered On written in bulk (ignored)');
      if (!clean(r.brand)) flags.push('No brand');
      if (!idU) flags.push('No Creative_ID');
      else if (source === 'Paid' ? !/^SRAP\d/.test(idU) : !/^SRA\d/.test(idU)) flags.push(source === 'Paid' ? 'ID should start with SRAP (External sheet)' : 'ID should start with SRA (Internal sheet)');
      if (clean(r.id) && idCount.get((r.src || '') + '|' + clean(r.id)) > 1) flags.push('Duplicate ID');
      let uid = (r.src || source) + ':' + (clean(r.id) || 'row' + (r.row || i + 2));
      while (seen.has(uid)) uid += '·';
      seen.add(uid);
      // Delivery date: the Delivered On column if the sheet has one, else the ETA (or request date).
      // A delivered task can't have been delivered in the future, so a later ETA counts as today.
      // Completed work (DONE, REJECTED) is dated by Delivered On, else the Design ETA (the actual delivery date once done), else the request date.
      let ddate = G.done ? (r.delivered_on || eta || req || null) : null;
      if (ddate && ddate > today) ddate = today;
      const pri = clean(r.priority).toUpperCase();
      const t0 = typeOf(r.type);
      return {
        uid, id: clean(r.id), source, src: r.src || '', row: r.row || null,
        brand: clean(r.brand) ? brandName.get(brandKey(clean(r.brand))) : 'No brand',
        topic: clean(r.topic), type: typeName.get(typeKey(t0)) || t0, channel: clean(r.channel), qty: r.qty || 1,
        priority: /^P\d$/.test(pri) ? pri : '', owner: clean(r.owner),
        designers: des.join(' + '), stage, open, group: G.group, done: G.done, shared: G.shared, review: G.review, awaiting: G.brief,
        sub: sub || '', design_status: clean(r.design_status), content_status: clean(r.content_status), req, eta,
        ddate, month: ddate ? ddate.slice(0, 7) : '', date_basis: G.done ? (r.delivered_on ? 'delivered' : eta ? 'eta' : 'request') : '',
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
  const OPEN_STAGES = ['To be planned', 'WIP', 'Changes requested'];

  const api = { kindOf, parseDate, parseSource, parseTeam, stageOf, groupOf, GROUPS, buildTasks, designerSplitter, columnsOf, OPEN_STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CODATA = api;
})(typeof window !== 'undefined' ? window : globalThis);
/* ==== END data.js ==== */


/* ============================ Fasty, the dashboard assistant ============================
 * The browser does the listening (speech to text), runs the tools on the live dashboard data it already
 * holds (so every answer respects the person's role) and plays the voice. This web app only relays the
 * conversation to Claude (Anthropic Messages API) with the key kept in Script properties, so the key never
 * reaches a browser. Task changes still go through updateTask, which checks the role again.
 *
 * Setup (owner, once): Apps Script > Project settings > Script properties >
 *   ANTHROPIC_API_KEY = your key from console.anthropic.com        (required for Fasty's understanding)
 *   GOOGLE_TTS_KEY    = a Google Cloud API key with Text-to-Speech  (optional: natural female voice)
 * Without ANTHROPIC_API_KEY the dashboard falls back to a simpler built-in helper.
 */
/* The model Fasty uses, chosen by an admin in Access > Reminders and notifications. Each needs slightly different settings:
 * Claude Haiku 5.5 has no server-side refusal fallback; Claude Sonnet 5.5 turns thinking off with between_tools;
 * Claude Opus 5.5 always thinks (effort controls how much). All run at low effort for quick spoken replies. */
const ASSIST_MODELS = {
  auto: { label: 'Automatic: Gemini (free) if its key is set, else Claude Haiku 5.5' },
  gemini: { label: 'Free: Google Gemini Flash (AI Studio free tier)' },
  haiku: { id: 'claude-haiku-5-5', label: 'Fast and lowest cost (Claude Haiku 5.5)', extra: { thinking: { type: 'disabled' } }, fallback: false },
  sonnet: { id: 'claude-sonnet-5-5', label: 'Balanced (Claude Sonnet 5.5)', extra: { thinking: { type: 'between_tools' } }, fallback: true },
  opus: { id: 'claude-opus-5-5', label: 'Most capable (Claude Opus 5.5)', extra: {}, fallback: true }
};
function assistStatus_() {
  const p = PropertiesService.getScriptProperties();
  return { ai: !!(p.getProperty('ANTHROPIC_API_KEY') || p.getProperty('GEMINI_API_KEY')), tts: !!(p.getProperty('GOOGLE_TTS_KEY') || p.getProperty('GEMINI_API_KEY')), provider: assistProvider_() };
}
// Which service answers: the admin's choice if its key is set; "auto" prefers the free Gemini key, then Claude Haiku.
function assistProvider_() {
  const p = PropertiesService.getScriptProperties(), m = settings_().model || 'auto';
  const gem = !!p.getProperty('GEMINI_API_KEY'), cl = !!p.getProperty('ANTHROPIC_API_KEY');
  if (m === 'gemini' || m === 'auto') return gem ? 'gemini' : cl ? (m === 'auto' ? 'haiku' : 'none') : 'none';
  return cl ? m : gem ? 'gemini' : 'none';
}
// At most 40 assistant requests per person per 10 minutes (each spoken question can take a few).
function assistLimit_(email, kind, max) {
  const c = CacheService.getScriptCache(), k = 'lim:' + kind + ':' + email, n = Number(c.get(k) || 0);
  if (n >= max) return false; c.put(k, String(n + 1), 600); return true;
}
const ASSIST_SYSTEM = [
  'You are Fasty, the voice assistant inside the FASTRR Creative Ops dashboard used by an Indian creative team (designers, editors, the creative head and coordinators). You are the most knowledgeable teammate: you know every section, number and process of this dashboard, and you help people find things, understand them and get work done.',
  '',
  'Language: people speak Hindi, English, Hinglish, broken English and mixed sentences, often with speech-to-text mistakes (names misspelt, "over due", "kitne task", "yashika ka", "dikhao", "kholo"). Work out what they mean; never correct their grammar. Reply in the same language mix they used: Hinglish in Latin script for Hinglish, Hindi in Devanagari for Hindi, simple English for English. Use Indian number formatting (1,25,000) and IST.',
  '',
  'Spoken version: whenever your reply is in Hindi or Hinglish (any Hindi words), end it with a new line containing only <<say>> and then the same reply written entirely in Devanagari for the voice to read, with English words transliterated as Indians say them (task = टास्क, overdue = ओवरड्यू, deliver = डिलीवर, Huggler = हगलर) and numbers as digits. Keep names recognisable. The screen hides that part. For replies fully in English, add nothing.',
  '',
  'Voice style: your reply is read aloud. Be warm, natural and brief: one to three short sentences, the answer first. No markdown, bullet symbols, tables, emojis or IDs read out unless asked; say "7 tasks" not a list of 7 IDs (the screen shows the matching tasks separately, so say "I have put them on screen" when a tool returned a list). Round sensibly and mention the period you counted.',
  '',
  'Accuracy: every number, name, status or date must come from a tool result in this conversation. Never guess or invent data. If a request is ambiguous (two people match a name, unclear period, unclear task), ask one short follow-up question instead of guessing. Resolve follow-ups like "aur uske?" or "what about last month" from the conversation. If a tool says something is not allowed for this person, explain kindly who can do it (an Editor or the Admin).',
  '',
  'Actions: you can open sections, apply filters, open a task and, for Editors and Admins, change a task\'s status, ETA, designer or priority. Before any change, say exactly what you will change and ask "Shall I go ahead?". Only call update_task after the person clearly says yes in their latest message. The dashboard also shows a confirm button; if they cancel, accept it. Navigation and filters need no confirmation.',
  '',
  'Dashboard guide (use this to explain features and processes):',
  '- Status meanings (Creative Head, Nov 2026). Design Status is the primary field. TBP = ready to be picked up (To be planned). WIP = in progress. CHANGES = shared and revisions requested (Changes requested). These three are OPEN work: workload, and overdue when the Design ETA has passed. UNDER REVIEW = the team finished it, the Creative Head has not reviewed it yet (Under review; not workload, never overdue). SHARED = with the client or another team for approval (shown as Shared). NO UPDATE = shared, no reply despite follow-ups; counted as SHARED work. DONE = delivered and approved (Delivered). REJECTED = delivered, then rejected by the client; counts as COMPLETED work for bandwidth but is NOT an approved delivery; a redo is a new task. Completed work = DONE + REJECTED. HOLD = on hold. DEPRIORITIZED = no longer required. When design has not started (TBP or blank), Content Status decides readiness: DONE (brief approved) = ready to pick up; PENDING (discussion), INCOMPLETE BRIEF, TBP (ready for final scripting), WIP (brief in progress), SHARED (brief with the client) and CHANGES (brief changes) = Awaiting brief, not design workload and never overdue; content HOLD = Hold. Content Owner prepares the brief. Creative_ID: SRAP = External (Paid) sheet, SRA = Internal (Marketing) sheet. A task with no designer is Unassigned and is never counted for any person.',
  '- Data comes live from two Google Sheets: the Paid (client) sheet, shown everywhere as External, and the Marketing team sheet, shown as Internal. Edits in the sheets appear within about 30 seconds.',
  '- Statuses on the dashboard: To be planned, WIP, Changes requested, Under review, Shared, No update, Awaiting brief, Hold, Delivered, Rejected, Deprioritised. Open = to be planned + WIP + changes requested. Overdue = open with a Design ETA before today. Creatives = the "No. of Creatives" quantity (1 per task if blank). Completed work (Delivered + Rejected) is dated by Delivered On, else the Design ETA.',
  '- Overview: headline numbers (open, overdue, due today, in progress, under review, delivered this month with change vs the same days of last month), Needs attention list, Meetings (their Google Calendar), Unassigned queue, Pipeline, Delivery trend and Top brands (each graph has Day, Week, Month, Quarter, Year and Custom buttons), Workload by designer, Coming up.',
  '- Stand-up: one card per designer with overdue, due today and open work; sort options; good for the daily stand-up.',
  '- Tasks: the full searchable list; click a task to edit status, ETA, designer, priority and quantity (Editors and Admins). Changes are written to the sheet and logged.',
  '- Notes: a sticky-note board of meeting minutes, discussions and personal notes; open one to write in the notebook, @mention people, add action items with an owner and due date, follow-ups and an email reminder. Visibility: only me, people mentioned or added, or everyone.',
  '- Team: each designer\'s open, overdue, this week, under review and delivered numbers. Reports: creatives delivered for a chosen period by brand, designer, type, and Internal vs External, with CSV download.',
  '- Data health (admins): rows the dashboard could not read cleanly. Access (admins): approve people, set roles, see who is online, reminder settings, and the activity log of every change.',
  '- Roles: View only sees everything and downloads reports; Can edit also changes tasks; Admin also manages people, the team list, settings and the log.',
  '- Daily briefings at 10:00 and 18:00 IST by email, on the dashboard and optionally in Google Chat; the bell lists deadlines, overdue work, new requirements, changes by others and meetings.',
  '- Colours on changes: green means better (more delivered, fewer overdue), red means worse; deeper shade = bigger change.'
].join('\n');
const ASSIST_TOOLS = [
  { name: 'search_tasks', description: 'Find tasks in the live data the person can see. Use for any question about specific tasks, a designer\'s or brand\'s work, overdue or due work, or a task ID. Returns counts and up to `limit` tasks (shown on screen). Without status or due it returns everything not yet delivered or dropped.', input_schema: { type: 'object', properties: {
    text: { type: 'string', description: 'Free text matched against ID, brand, creative title, type and designer.' },
    designer: { type: 'string', description: 'Designer name or part of it (fuzzy). Use "unassigned" for tasks without a designer.' },
    brand: { type: 'string' }, type: { type: 'string', description: 'Creative type, e.g. Static, Video, AI Video, GIF.' },
    status: { type: 'string', enum: ['open', 'to be planned', 'wip', 'changes requested', 'under review', 'shared', 'no update', 'awaiting brief', 'hold', 'completed', 'delivered', 'rejected', 'deprioritised', 'any'] },
    due: { type: 'string', enum: ['overdue', 'today', 'tomorrow', 'this week', 'next 7 days', 'no eta', 'any'] },
    classification: { type: 'string', enum: ['internal', 'external', 'any'] },
    delivered_from: { type: 'string', description: 'YYYY-MM-DD, for delivered tasks.' }, delivered_to: { type: 'string', description: 'YYYY-MM-DD' },
    limit: { type: 'integer', description: 'Max tasks to return, default 8.' } } } },
  { name: 'get_summary', description: 'Headline numbers right now: open, overdue, due today/tomorrow, in progress, under review, awaiting brief, unassigned, plus delivered this month vs the same days of last month. Optionally for one designer, brand or Internal/External.', input_schema: { type: 'object', properties: { designer: { type: 'string' }, brand: { type: 'string' }, classification: { type: 'string', enum: ['internal', 'external', 'any'] } } } },
  { name: 'team_progress', description: 'Per-designer progress: open, overdue, due today, under review, delivered in the period (default this month) and versus the previous period. Use for "how is the team doing", "who is overloaded", "who delivered most".', input_schema: { type: 'object', properties: { period: { type: 'string', enum: ['today', 'this week', 'last week', 'this month', 'last month', 'this quarter', 'this year', 'custom'] }, from: { type: 'string' }, to: { type: 'string' } } } },
  { name: 'delivery_report', description: 'Creatives delivered in a period, grouped. Use for report questions ("kitne creatives deliver hue", "best brand last month", "internal vs external").', input_schema: { type: 'object', properties: { period: { type: 'string', enum: ['today', 'yesterday', 'this week', 'last week', 'this month', 'last month', 'this quarter', 'last quarter', 'this year', 'custom'] }, from: { type: 'string', description: 'YYYY-MM-DD when period is custom' }, to: { type: 'string' }, group_by: { type: 'string', enum: ['designer', 'brand', 'type', 'classification', 'day', 'week', 'month'] }, designer: { type: 'string' }, brand: { type: 'string' }, classification: { type: 'string', enum: ['internal', 'external', 'any'] } }, required: ['group_by'] } },
  { name: 'my_notes', description: 'Search the notes this person can see, and list open action items (theirs by default).', input_schema: { type: 'object', properties: { text: { type: 'string' }, open_actions_only: { type: 'boolean' } } } },
  { name: 'navigate', description: 'Open a dashboard section and optionally set the filters (designer, brand, creative type, Internal/External), or the Reports period. Use when the person asks to see, show, open or go to something.', input_schema: { type: 'object', properties: { section: { type: 'string', enum: ['overview', 'standup', 'tasks', 'notes', 'team', 'reports', 'health', 'access'] }, designer: { type: 'string' }, brand: { type: 'string' }, type: { type: 'string' }, classification: { type: 'string', enum: ['internal', 'external', 'any'] }, clear_filters: { type: 'boolean' }, report_period: { type: 'string', enum: ['this-month', 'last-month', 'this-quarter', 'last-quarter', 'ytd', 'last-12', 'all'] } }, required: ['section'] } },
  { name: 'open_task', description: 'Open one task\'s detail window on screen.', input_schema: { type: 'object', properties: { id: { type: 'string', description: 'Task ID such as SRAP372.' } }, required: ['id'] } },
  { name: 'update_task', description: 'Change a task in the sheet. Only after the person explicitly confirmed this exact change. Editors and Admins only; the screen asks them to confirm too.', input_schema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['To be planned', 'WIP', 'Under review', 'Shared', 'Changes requested', 'Delivered', 'Rejected', 'No update', 'Hold', 'Deprioritised'] }, eta: { type: 'string', description: 'YYYY-MM-DD' }, designer: { type: 'string' }, priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] } }, required: ['id'] } }
];
ASSIST_TOOLS[ASSIST_TOOLS.length - 1].cache_control = { type: 'ephemeral' };
// Only text, tool calls, tool results and the model's own thinking blocks are relayed; anything else is dropped.
function assistClean_(messages) {
  if (!Array.isArray(messages)) return null;
  const ok = { text: 1, tool_use: 1, tool_result: 1, thinking: 1, redacted_thinking: 1 };
  const out = messages.slice(-40).map(function (m) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
    if (typeof m.content === 'string') return { role: m.role, content: m.content.slice(0, 4000) };
    if (!Array.isArray(m.content)) return null;
    return { role: m.role, content: m.content.filter(function (b) { return b && ok[b.type]; }) };
  }).filter(function (m) { return m && (typeof m.content === 'string' ? m.content : m.content.length); });
  // Start at a question the person typed or said, never at a tool result whose call was cut off.
  while (out.length && !(out[0].role === 'user' && (typeof out[0].content === 'string' || out[0].content.some(function (b) { return b.type === 'text'; }) && !out[0].content.some(function (b) { return b.type === 'tool_result'; })))) out.shift();
  return JSON.stringify(out).length > 120000 ? null : out;
}
function assist_(user, body) {
  const prov = assistProvider_();
  if (prov === 'none') return { ok: false, error: 'not_configured' };
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const M = ASSIST_MODELS[prov];
  if (!assistLimit_(user.email, 'ast', 40)) return { ok: false, error: 'Too many questions in a short time. Try again in a few minutes.' };
  const messages = assistClean_(body.messages);
  if (!messages || !messages.length) return { ok: false, error: 'Nothing to answer.' };
  const ctx = body.context || {};
  const who = 'Signed-in person: ' + (user.name || user.email) + ' (' + user.email + '), role ' + user.role + (user.role === 'Viewer' ? ' (view only: cannot change tasks)' : user.role === 'Editor' ? ' (can edit tasks)' : ' (admin)') + '.\n' +
    'Now: ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', "EEEE d MMMM yyyy, h:mm a") + ' IST.\n' +
    'On screen: ' + String(ctx.page || 'overview').slice(0, 40) + (ctx.filters ? '; filters: ' + String(ctx.filters).slice(0, 200) : '') + (ctx.lang ? '; speech language setting: ' + String(ctx.lang).slice(0, 10) : '') + '.';
  if (prov === 'gemini') return gemini_(messages, who);
  // Gemini-only fields are dropped if the admin switched to Claude mid-conversation.
  messages.forEach(function (m) { if (Array.isArray(m.content)) m.content.forEach(function (b) { delete b.sig; }); });
  const req = {
    model: M.id, max_tokens: 4000,
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: ASSIST_SYSTEM, cache_control: { type: 'ephemeral' } }, { type: 'text', text: who }],
    tools: ASSIST_TOOLS,
    messages: messages
  };
  Object.assign(req, M.extra); if (M.fallback) req.fallbacks = 'default';
  let res;
  try {
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: Object.assign({ 'x-api-key': key, 'anthropic-version': '2026-10-21' }, M.fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}), payload: JSON.stringify(req) });
  } catch (err) { return { ok: false, error: 'Could not reach the assistant service.' }; }
  const code = res.getResponseCode(); let out = {};
  try { out = JSON.parse(res.getContentText()); } catch (err) { out = {}; }
  if (code !== 200) {
    const m = out.error && out.error.message ? String(out.error.message).slice(0, 200) : 'HTTP ' + code;
    return { ok: false, error: code === 429 || code === 529 ? 'The assistant is busy. Try again in a moment.' : code === 401 ? 'The assistant key in Script properties is not valid.' : 'Assistant error: ' + m };
  }
  if (out.stop_reason === 'refusal') return { ok: true, stop_reason: 'refusal', content: [] };
  return { ok: true, stop_reason: out.stop_reason, content: out.content || [] };
}
/* ---- Voice ----
 * Speech is made in parts so it can start at once: the first sentence is synthesised inside the same request as the
 * answer (attachVoice_), so the text and the voice arrive together, and the rest is fetched by the browser while the
 * first part plays. Several parts are synthesised in parallel (UrlFetchApp.fetchAll). Voices: Google Cloud Chirp 3 HD
 * when GOOGLE_TTS_KEY is set (fastest), else Gemini text-to-speech with the free GEMINI_API_KEY. */
function voiceLang_(text, pref) { return pref === 'hi-IN' || /[ऀ-ॿ]/.test(text) ? 'hi-IN' : 'en-IN'; }
function spokenOf_(text) {
  const parts = String(text || '').split(/\s*<<say>>\s*/);
  return String(parts[1] || parts[0] || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_#`>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 900);
}
// First part: just the first sentence (joined with the next only if under 25 characters) so it is quick to make; then parts of up to ~420.
function voiceChunks_(text) {
  const sentences = String(text).split(/(?<=[.!?।])\s+/).filter(Boolean), out = []; let cur = '';
  sentences.forEach(function (x) {
    const cap = out.length ? 420 : 170, joined = (cur ? cur + ' ' : '') + x;
    if (!cur || (out.length ? joined.length <= cap : cur.length < 25 && joined.length <= cap)) cur = joined; else { out.push(cur); cur = x; }
  });
  if (cur) out.push(cur);
  return out.slice(0, 5);
}
function ttsReady_() {
  const p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('GOOGLE_TTS_KEY') || (p.getProperty('GEMINI_API_KEY') && !CacheService.getScriptCache().get('tts-off')));
}
function ttsKey_(lang, text) { return 'tts2:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, lang + text)); }
// Synthesises several texts at once; returns [{ a, m } | null] in the same order.
function ttsMany_(texts, lang) {
  const props = PropertiesService.getScriptProperties(), key = props.getProperty('GOOGLE_TTS_KEY'), gk = props.getProperty('GEMINI_API_KEY');
  const cache = CacheService.getScriptCache(), out = texts.map(function () { return null; }), todo = [];
  texts.forEach(function (t, i) { const hit = cache.get(ttsKey_(lang, t)); if (hit) { try { out[i] = JSON.parse(hit); return; } catch (e) { /* re-make */ } } todo.push(i); });
  if (!todo.length) return out;
  let reqs, model = '';
  if (key) {
    reqs = todo.map(function (i) { return { url: 'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(key), method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ input: { text: texts[i] }, voice: { languageCode: lang, name: lang + '-Chirp3-HD-Aoede' }, audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 } }) }; });
  } else if (gk && !cache.get('tts-off')) {
    model = props.getProperty('GEMINI_TTS_MODEL') || props.getProperty('GEMINI_TTS_OK') || 'gemini-2.5-flash-preview-tts';
    reqs = todo.map(function (i) { return { url: 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': gk },
      payload: JSON.stringify(geminiTtsBody_(texts[i], lang)) }; });
  } else return out;
  let res = []; try { res = UrlFetchApp.fetchAll(reqs); } catch (e) { res = []; }
  let limited = 0;
  todo.forEach(function (i, j) {
    const r = res[j]; let got = null;
    if (r && r.getResponseCode() === 200) {
      try {
        const body = JSON.parse(r.getContentText());
        if (key) got = body.audioContent ? { a: body.audioContent, m: 'audio/mp3' } : null;
        else { const part = ((((body.candidates || [])[0] || {}).content || {}).parts || []).filter(function (x) { return x.inlineData; })[0]; if (part) got = { a: part.inlineData.data, m: part.inlineData.mimeType || 'audio/L16;rate=24000' }; }
      } catch (e) { got = null; }
    } else if (r && r.getResponseCode() === 429) limited++;
    else if (!key && gk) got = geminiSpeak_(gk, texts[i], lang); // model not available: try the others one by one
    if (got && got.a) { out[i] = got; if (got.a.length < 95000) cache.put(ttsKey_(lang, texts[i]), JSON.stringify(got), 21600); }
  });
  if (limited && !key && limited === todo.length && out.every(function (x) { return !x; })) cache.put('tts-off', '1', 900);
  return out;
}
// Adds the spoken parts of a final answer and the audio of the first part to the assist reply.
function attachVoice_(user, r, pref) {
  const text = (r.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join(' ');
  const spoken = spokenOf_(text); if (!spoken) return;
  const lang = voiceLang_(spoken, pref && pref.lang), chunks = voiceChunks_(spoken);
  r.voice = { lang: lang, chunks: chunks, a0: null, off: !ttsReady_() };
  if (r.voice.off || !assistLimit_(user.email, 'tts', 80)) return;
  const a0 = ttsMany_([chunks[0]], lang)[0];
  if (a0) r.voice.a0 = { audio: a0.a, mime: a0.m }; else r.voice.off = !ttsReady_();
}
function speak_(user, body) {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GOOGLE_TTS_KEY') && !props.getProperty('GEMINI_API_KEY')) return { ok: false, error: 'not_configured' };
  const many = Array.isArray(body.texts), texts = (many ? body.texts : [body.text]).map(function (t) { return String(t || '').slice(0, 700); }).filter(Boolean).slice(0, 5);
  if (!texts.length) return { ok: false };
  for (let i = 0; i < texts.length; i++) if (!assistLimit_(user.email, 'tts', 80)) return { ok: false, error: 'limit' };
  const lang = voiceLang_(texts.join(' '), body.lang);
  const res = ttsMany_(texts, lang);
  if (many) return { ok: true, items: res.map(function (x) { return x ? { audio: x.a, mime: x.m } : null; }) };
  if (!res[0]) return { ok: false, error: 'tts unavailable' };
  return { ok: true, audio: res[0].a, mime: res[0].m };
}
function geminiTtsBody_(text, lang) {
  const style = lang === 'hi-IN' ? 'Read this aloud in natural, conversational Hindi as a warm, friendly young Indian woman talking to a colleague; pronounce English words the Indian way: ' : 'Read this aloud in a warm, friendly Indian English accent, natural and conversational, like a helpful colleague: ';
  return { contents: [{ role: 'user', parts: [{ text: style + text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } } };
}
function geminiSpeak_(gk, text, lang) {
  const props = PropertiesService.getScriptProperties();
  const models = [props.getProperty('GEMINI_TTS_MODEL'), props.getProperty('GEMINI_TTS_OK'), 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-tts', 'gemini-flash-tts-latest', 'gemini-2.5-pro-preview-tts'].filter(function (m, i, a) { return m && a.indexOf(m) === i; });
  const style = lang === 'hi-IN' ? 'Read this aloud in natural, conversational Hindi as a warm, friendly young Indian woman talking to a colleague; pronounce English words the Indian way: ' : 'Read this aloud in a warm, friendly Indian English accent, natural and conversational, like a helpful colleague: ';
  for (let i = 0; i < models.length; i++) {
    const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': gk },
      payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: style + text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } } }) });
    if (res.getResponseCode() === 429) return null;
    if (res.getResponseCode() !== 200) continue;
    const part = ((((JSON.parse(res.getContentText()).candidates || [])[0] || {}).content || {}).parts || []).filter(function (p) { return p.inlineData; })[0];
    if (part) { props.setProperty('GEMINI_TTS_OK', models[i]); return { a: part.inlineData.data, m: part.inlineData.mimeType || 'audio/L16;rate=24000' }; }
  }
  return null;
}

/* ---- Google Gemini (free tier from aistudio.google.com) ----
 * The browser keeps the conversation in the same shape for every provider; here it is translated to Gemini's
 * format and back. GEMINI_MODEL (script property) can pin a model; the default alias follows Google's current Flash model.
 * Note: on the free tier Google may use requests to improve its products. */
function geminiSchema_(x) {
  if (Array.isArray(x)) return x.map(geminiSchema_);
  if (!x || typeof x !== 'object') return x;
  const o = {}; Object.keys(x).forEach(function (k) { if (k !== 'cache_control' && k !== 'additionalProperties') o[k] = geminiSchema_(x[k]); }); return o;
}
function gemini_(messages, who) {
  const props = PropertiesService.getScriptProperties(), key = props.getProperty('GEMINI_API_KEY');
  // testFasty() times the free models and saves the fastest that works (GEMINI_TUNE); GEMINI_MODEL overrides it.
  let tune = {}; try { tune = JSON.parse(props.getProperty('GEMINI_TUNE') || '{}'); } catch (e) { tune = {}; }
  const model = props.getProperty('GEMINI_MODEL') || tune.model || 'gemini-flash-lite-latest';
  const names = {};
  const contents = messages.map(function (m) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content, parts = [];
    blocks.forEach(function (b) {
      if (b.type === 'text' && b.text) parts.push({ text: b.text });
      else if (b.type === 'tool_use') { names[b.id] = b.name; const fc = { functionCall: { name: b.name, args: b.input || {} } }; if (b.sig) fc.thoughtSignature = b.sig; parts.push(fc); }
      else if (b.type === 'tool_result') { let r; try { r = JSON.parse(b.content); } catch (e) { r = { result: String(b.content) }; } parts.push({ functionResponse: { name: names[b.tool_use_id] || String(b.tool_use_id).split('__')[1] || 'tool', response: Array.isArray(r) ? { result: r } : r } }); }
    });
    return parts.length ? { role: m.role === 'assistant' ? 'model' : 'user', parts: parts } : null;
  }).filter(Boolean);
  const req = {
    systemInstruction: { parts: [{ text: ASSIST_SYSTEM + '\n\n' + who }] },
    contents: contents,
    tools: [{ functionDeclarations: ASSIST_TOOLS.map(function (t) { return { name: t.name, description: t.description, parameters: geminiSchema_(t.input_schema) }; }) }],
    generationConfig: Object.assign({ temperature: 0.3, maxOutputTokens: 900 }, tune.model === model && tune.thinking ? { thinkingConfig: tune.thinking } : {})
  };
  let res;
  try { res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: JSON.stringify(req) }); }
  catch (err) { return { ok: false, error: 'busy' }; }
  const code = res.getResponseCode(); let out = {}; try { out = JSON.parse(res.getContentText()); } catch (e) { out = {}; }
  if (code === 429 || code >= 500) return { ok: false, error: 'busy' };
  if (code !== 200) return { ok: false, error: code === 400 || code === 403 ? 'The Gemini key or model in Script properties is not valid (' + String((out.error || {}).message || code).slice(0, 120) + ').' : 'Assistant error ' + code };
  const cand = (out.candidates || [])[0];
  if (!cand || !cand.content) return { ok: true, stop_reason: (out.promptFeedback || {}).blockReason || (cand && cand.finishReason === 'SAFETY') ? 'refusal' : 'end_turn', content: [] };
  const content = [], n = Utilities.getUuid().slice(0, 8);
  (cand.content.parts || []).forEach(function (pt, i) {
    if (pt.functionCall) { const b = { type: 'tool_use', id: 'g' + n + i + '__' + pt.functionCall.name, name: pt.functionCall.name, input: pt.functionCall.args || {} }; if (pt.thoughtSignature) b.sig = pt.thoughtSignature; content.push(b); }
    else if (pt.text && !pt.thought) content.push({ type: 'text', text: pt.text });
  });
  return { ok: true, stop_reason: content.some(function (b) { return b.type === 'tool_use'; }) ? 'tool_use' : 'end_turn', content: content };
}

/** Run from the Apps Script editor (choose testFasty, then Run). It checks the key, times the free Gemini models
 *  (with thinking off where the model allows), saves the fastest that works for Fasty, then runs a full Fasty request. */
function testFasty() {
  const p = PropertiesService.getScriptProperties(), prov = assistProvider_(), gk = p.getProperty('GEMINI_API_KEY') || '';
  console.log('1. Provider: ' + prov + ' | GEMINI_API_KEY set: ' + !!gk + ' (' + gk.length + ' characters) | model setting: ' + settings_().model);
  if (prov === 'none') { console.log('No AI key found. Add GEMINI_API_KEY under Project Settings > Script properties.'); return; }
  if (prov === 'gemini') { const best = tuneGemini_(true); if (!best) return; console.log('3. Saved for Fasty: ' + best.model + (best.thinking ? ' ' + JSON.stringify(best.thinking) : '') + ' (' + best.ms + ' ms)'); }

  const t0 = Date.now();
  const res = assist_({ email: 'test@local', name: 'Test', role: 'Viewer' }, { messages: [{ role: 'user', content: [{ type: 'text', text: 'aaj kitne tasks overdue hain?' }] }] });
  console.log('4. Full Fasty request: ' + (Date.now() - t0) + ' ms: ' + JSON.stringify(res).slice(0, 400));
  console.log(res.ok ? 'Fasty is working.' : 'Fasty is NOT working: ' + res.error);
}

/* Times the free Gemini models (thinking off where allowed) and saves the fastest that works as GEMINI_TUNE. */
function tuneGemini_(log) {
  const p = PropertiesService.getScriptProperties(), gk = p.getProperty('GEMINI_API_KEY'); if (!gk) return null;
  const tries = [
    ['gemini-flash-lite-latest', { thinkingBudget: 0 }], ['gemini-flash-lite-latest', null],
    ['gemini-2.5-flash-lite', { thinkingBudget: 0 }], ['gemini-flash-latest', { thinkingBudget: 0 }],
    ['gemini-flash-latest', { thinkingLevel: 'low' }], ['gemini-2.5-flash', { thinkingBudget: 0 }], ['gemini-flash-latest', null]];
  let best = null;
  tries.forEach(function (tr) {
    if (best && best.ms < 4000) return;
    const body = { contents: [{ role: 'user', parts: [{ text: 'Reply with: ok' }] }], generationConfig: tr[1] ? { thinkingConfig: tr[1] } : {} };
    const t = Date.now(); let code = 0, txt = '';
    try { const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + tr[0] + ':generateContent', { method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': gk }, muteHttpExceptions: true, payload: JSON.stringify(body) }); code = r.getResponseCode(); txt = r.getContentText(); } catch (e) { txt = String(e); }
    const ms = Date.now() - t;
    if (log) console.log('2. ' + tr[0] + (tr[1] ? ' ' + JSON.stringify(tr[1]) : ' (default thinking)') + ': HTTP ' + code + ' in ' + ms + ' ms' + (code === 200 ? '' : ' ' + txt.slice(0, 160)));
    if (code === 200 && (!best || ms < best.ms)) best = { model: tr[0], thinking: tr[1], ms: ms };
  });
  if (best) p.setProperty('GEMINI_TUNE', JSON.stringify({ model: best.model, thinking: best.thinking, at: Date.now(), ms: best.ms }));
  else if (log) console.log('No Gemini model answered. Check the key in AI Studio (it should start with AIza) and the Rate Limit page.');
  return best;
}
/* Housekeeping on the 10-minute timer, so nobody has to run anything by hand:
 * - once: replace SESSION_SECRET and API_KEY (their values were shared in a screenshot on 10 Nov 2026; everyone signs in again);
 * - pick the fastest working Gemini model when there is none yet, then once a week. */
function maintenance_() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('ROLES_2026_11_10')) { try { seedRoles_(); p.setProperty('ROLES_2026_11_10', new Date().toISOString()); } catch (e) { console.log('roles: ' + e); } }
  if (!p.getProperty('ROTATED_2026_11_10')) {
    p.setProperty('SESSION_SECRET', newSecret_());
    p.setProperty('API_KEY', Utilities.getUuid().replace(/-/g, ''));
    p.setProperty('ROTATED_2026_11_10', new Date().toISOString());
    try { audit_([{ who: Session.getEffectiveUser().getEmail(), role: 'Script owner', action: 'Signed everyone out', details: 'Secrets replaced automatically after they were shared in a screenshot', via: 'Apps Script' }]); } catch (e) { /* log optional */ }
  }
  if (!p.getProperty('DELIV_REPAIR_2026_11_10')) { try { const r = repairDeliveredOn_(); if (r.ok) p.setProperty('DELIV_REPAIR_2026_11_10', new Date().toISOString()); console.log('delivered on repair: ' + JSON.stringify(r)); } catch (e) { console.log('delivered on repair: ' + e); } }
  if (p.getProperty('GEMINI_API_KEY')) {
    let tune = {}; try { tune = JSON.parse(p.getProperty('GEMINI_TUNE') || '{}'); } catch (e) { tune = {}; }
    if (!tune.model || !tune.at || Date.now() - tune.at > 7 * 864e5) tuneGemini_(false);
  }
  autoUpdate_(false);
}

/* ============================ Automatic updates ============================
 * Every 10 minutes the web app checks GitHub for a newer Code.gs (and appsscript.json). If there is one, it checks the
 * code parses, installs it with the Apps Script API (Config.gs, with the private links, is never touched), saves a new
 * version and points the live web app deployment at it. Nobody has to copy, paste or deploy again.
 * Needs, once: the Apps Script API switched on at script.google.com/home/usersettings, and the two script.* permissions.
 * If GitHub's appsscript.json asks for new permissions, it is not installed automatically: the System check asks the owner. */
const UPDATE_SRC = 'https://raw.githubusercontent.com/anmolpickrr/Tracker/main/apps-script/';
function updateStatus_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('UPDATE_STATUS') || '{}'); } catch (e) { return {}; } }
function hash_(t) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, t)); }
function autoUpdate_(log) {
  const p = PropertiesService.getScriptProperties(), st = updateStatus_(), say = function (m) { if (log) console.log(m); };
  const save = function (o) { p.setProperty('UPDATE_STATUS', JSON.stringify(Object.assign(st, o, { checked: Date.now() }))); };
  if (p.getProperty('AUTO_UPDATE') === 'off') { say('Automatic updates are off (script property AUTO_UPDATE = off).'); return; }
  try {
    const get = function (f) { const r = UrlFetchApp.fetch(UPDATE_SRC + f + '?t=' + Date.now(), { muteHttpExceptions: true }); if (r.getResponseCode() !== 200) throw new Error('GitHub ' + f + ': HTTP ' + r.getResponseCode()); return r.getContentText(); };
    const code = get('Code.gs'), manifest = get('appsscript.json'), h = hash_(code + manifest);
    if (h === st.hash) { say('Already up to date (' + (st.version ? 'version ' + st.version : 'no version yet') + ').'); save({ err: '' }); return; }
    // Safety: the new code must parse and still be the dashboard's web app.
    try { new Function(code); } catch (e) { if (e instanceof SyntaxError) { save({ err: 'The newest Code.gs on GitHub has an error and was not installed: ' + e.message }); say(st.err); return; } }
    if (!/function doPost\(/.test(code) || !/function doGet\(/.test(code)) { save({ err: 'The newest Code.gs on GitHub does not look complete; not installed.' }); return; }
    const token = ScriptApp.getOAuthToken(), id = ScriptApp.getScriptId(), api = 'https://script.googleapis.com/v1/projects/' + id;
    const call = function (method, path, body) {
      const r = UrlFetchApp.fetch(api + path, { method: method, contentType: 'application/json', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, payload: body ? JSON.stringify(body) : undefined });
      const t = r.getContentText(); if (r.getResponseCode() >= 300) throw new Error('Apps Script API ' + path + ': HTTP ' + r.getResponseCode() + ' ' + t.slice(0, 220)); return t ? JSON.parse(t) : {};
    };
    const content = call('get', '/content');
    const files = content.files.map(function (f) { return { name: f.name, type: f.type, source: f.source }; });
    const cur = files.filter(function (f) { return f.name === 'appsscript'; })[0];
    const scopes = function (m) { try { return (JSON.parse(m).oauthScopes || []).slice().sort().join(' '); } catch (e) { return ''; } };
    let newManifest = manifest, needsOwner = '';
    if (cur && scopes(cur.source) !== scopes(manifest)) { newManifest = cur.source; needsOwner = 'GitHub asks for new permissions. Paste appsscript.json from GitHub into Apps Script once and approve, then updates continue.'; }
    files.forEach(function (f) { if (f.name === 'Code') f.source = code; if (f.name === 'appsscript') f.source = newManifest; });
    call('put', '/content', { files: files });
    const ver = call('post', '/versions', { description: 'Automatic update from GitHub ' + Utilities.formatDate(new Date(), IST, 'd MMM yyyy, HH:mm') });
    // Point the live web app deployment (the one the dashboard uses) at the new version; the URL does not change.
    const deps = (call('get', '/deployments').deployments || []).filter(function (d) { return d.deploymentConfig && d.deploymentConfig.versionNumber && (d.entryPoints || []).some(function (e) { return e.entryPointType === 'WEB_APP'; }); });
    deps.forEach(function (d) { call('put', '/deployments/' + d.deploymentId, { deploymentConfig: { scriptId: id, versionNumber: ver.versionNumber, manifestFileName: 'appsscript', description: 'Automatic update' } }); });
    save({ hash: needsOwner ? '' : h, version: ver.versionNumber, at: Date.now(), err: needsOwner, deployments: deps.length });
    say('Installed version ' + ver.versionNumber + ' and updated ' + deps.length + ' web app deployment(s).' + (needsOwner ? ' ' + needsOwner : ''));
  } catch (e) {
    const m = String(e.message || e);
    const proj = (m.match(/project (\d+)/) || [])[1];
    save({ err: proj && /has not been used|disabled|SERVICE_DISABLED/i.test(m) ? 'Enable the Apps Script API in this script\'s Google Cloud project: https://console.cloud.google.com/apis/library/script.googleapis.com?project=' + proj + ' (click Enable, wait 2 minutes, run updateNow).' : /has not been used|disabled|SERVICE_DISABLED|User has not enabled/i.test(m) ? 'Switch on "Google Apps Script API" at script.google.com/home/usersettings so updates can install themselves.' : /insufficient|PERMISSION_DENIED|scope/i.test(m) ? 'Automatic updates need permission: open Apps Script, run updateNow once and approve.' : 'Automatic update failed: ' + m.slice(0, 200) });
    say('Automatic update failed: ' + m);
  }
}
/** Run from the editor (choose updateNow, then Run) to install the newest version from GitHub straight away. */
function updateNow() { autoUpdate_(true); }

/* ============================ Meetings for everyone ============================
 * The web app (running as the deploying account) reads the signed-in person's own Google Calendar, so nobody has to
 * connect anything. It works for everyone whose calendar shares event details inside the company (the usual Workspace
 * setting); anyone else gets "not_shared" and the dashboard offers its personal Connect button instead.
 * Only the signed-in person's own calendar is ever read for them. */
function meetings_(user) {
  const c = CacheService.getScriptCache(), k = 'mtg:' + user.email, hit = c.get(k); if (hit) return JSON.parse(hit);
  let out;
  try {
    if (typeof Calendar === 'undefined') throw new Error('service_off');
    const now = new Date(), r = Calendar.Events.list(user.email, { timeMin: new Date(now - 3600e3).toISOString(), timeMax: new Date(+now + 14 * 864e5).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 100 });
    const me = user.email.toLowerCase();
    const events = (r.items || []).filter(function (e) { return e.status !== 'cancelled' && e.start && e.start.dateTime && !(e.attendees || []).some(function (a) { return String(a.email).toLowerCase() === me && a.responseStatus === 'declined'; }); }).map(function (e) {
      const meet = e.hangoutLink || ((e.conferenceData && e.conferenceData.entryPoints) || []).filter(function (p) { return p.entryPointType === 'video'; }).map(function (p) { return p.uri; })[0] || '';
      return { id: e.id, limited: !e.summary, title: e.summary || 'Busy (details hidden)', start: e.start.dateTime, end: e.end.dateTime, meet: /^https:\/\/meet\.google\.com\//.test(meet) ? meet : '', link: /^https:\/\/www\.google\.com\/calendar\//.test(e.htmlLink || '') ? e.htmlLink : '',
        people: (e.attendees || []).filter(function (a) { return !a.resource; }).map(function (a) { return { name: a.displayName || String(a.email).split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function (x) { return x.toUpperCase(); }), email: a.email, self: String(a.email).toLowerCase() === me, rsvp: a.responseStatus }; }) };
    });
    out = { ok: true, events: events };
  } catch (e) {
    const m = String(e.message || e);
    const proj = (m.match(/project (\d+)/) || [])[1];
    out = { ok: false, error: m === 'service_off' ? 'service_off' : proj && /has not been used|disabled/i.test(m) ? 'api_off' : /not ?found|forbidden|403|404|insufficient|access/i.test(m) ? 'not_shared' : 'error', detail: m.slice(0, 160) };
    if (out.error === 'api_off') { out.enable = 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=' + proj; PropertiesService.getScriptProperties().setProperty('CAL_API_OFF', out.enable); }
  }
  try { if (out.ok) PropertiesService.getScriptProperties().deleteProperty('CAL_API_OFF'); } catch (e) { /* ignore */ }
  c.put(k, JSON.stringify(out), out.ok ? 120 : out.error === 'api_off' ? 60 : 900);
  return out;
}
/** Run from the editor (choose testMeetings, then Run): shows whose meetings the dashboard can show automatically. */
function testMeetings() {
  const people = users_().list.filter(function (u) { return u.status === 'Approved'; });
  let okN = 0;
  people.forEach(function (u) { CacheService.getScriptCache().remove('mtg:' + u.email); const r = meetings_(u); if (r.ok) okN++; console.log((r.ok ? 'OK   ' : 'NO   ') + u.email + (r.ok ? ': ' + r.events.length + ' meetings in the next 3 days' : ': ' + r.error + ' (' + (r.detail || '') + ')')); });
  const off = PropertiesService.getScriptProperties().getProperty('CAL_API_OFF'); if (off) { console.log('The Google Calendar API is switched off in this script\'s Google Cloud project. Open ' + off + ', click Enable, wait 2 minutes and run testMeetings again.'); return; }
  console.log(okN + ' of ' + people.length + ' people get their meetings automatically.' + (okN < people.length ? ' For the rest: in the Google Admin console, Apps > Google Workspace > Calendar > Sharing settings > Internal sharing: "Share all information", or each person shares their calendar with this account.' : ''));
}

/* One-time: the roles the Creative Head gave on 10 Nov 2026, written into the team list's Role column (only where it is
 * empty), and the two people not yet on the list added. "Not shown" keeps someone out of team views and workload. */
const ROLE_SEED = [
  ['Sagun', 'Designer/Editor'], ['Shubham', 'Editor'], ['Himanshu', 'Editor'], ['Ramesh', 'Editor'], ['Aman', 'Editor'], ['Rajnish', 'Editor'],
  ['Gurleen', 'Editor (Intern)'], ['Gul', 'Content Writer (Intern)'], ['Jahanvi', 'Content Writer'], ['Yashika', 'Designer'], ['Abhist', 'KAM (Design)'],
  ['Anmol Sharma', 'Creative Head (not shown)']
];
function seedRoles_() {
  const sheet = openTab_(teamSource_());
  const values = sheet.getDataRange().getValues();
  const head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const col = function (re) { for (let i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  const cName = col(/^name/), cStatus = col(/^status/), cAlias = col(/also|alias/);
  let cRole = col(/^role/);
  if (cName < 0) return;
  if (cRole < 0) { cRole = head.length; sheet.getRange(1, cRole + 1).setValue('Role'); }
  const changes = [];
  ROLE_SEED.forEach(function (pair) {
    const want = pair[0].toLowerCase(), role = pair[1];
    let idx = -1;
    for (let i = 1; i < values.length; i++) {
      const nm = String(values[i][cName]).trim().toLowerCase(), first = nm.split(/\s+/)[0];
      const al = cAlias >= 0 ? String(values[i][cAlias]).toLowerCase().split(/\s*,\s*/) : [];
      if (nm === want || first === want || al.indexOf(want) >= 0) { idx = i; break; }
    }
    if (idx < 0) {
      const row = new Array(Math.max(head.length, cRole + 1)).fill('');
      row[cName] = pair[0]; if (cStatus >= 0) row[cStatus] = 'Active'; row[cRole] = role;
      sheet.appendRow(row);
      changes.push({ action: 'Team member added', record: pair[0], field: 'Role', before: '', after: role, via: 'Apps Script' });
    } else if (!String(values[idx][cRole] || '').trim()) {
      sheet.getRange(idx + 1, cRole + 1).setValue(role);
      changes.push({ action: 'Team member updated', record: String(values[idx][cName]), field: 'Role', before: '', after: role, via: 'Apps Script' });
    }
  });
  if (changes.length) { try { audit_(changes.map(function (c) { return Object.assign({ who: Session.getEffectiveUser().getEmail(), role: 'Script owner', sheet: sheet.getParent().getName(), tab: sheet.getName() }, c); })); } catch (e) { /* log optional */ } bumpVersion_(); }
}

/* Today's status changes (IST), from the activity log: design status edits made in the sheets and task edits made on the
 * dashboard. The sheets have no "delivered on" column, so this is how the Daily To-Do knows what was delivered or started today. */
function daily_() {
  const c = CacheService.getScriptCache(), hit = c.get('daily'); if (hit) return JSON.parse(hit);
  const today = Utilities.formatDate(new Date(), IST, 'yyyy-MM-dd'), moves = [];
  const r = auditRead_({ limit: 500 });
  (r.entries || []).forEach(function (e) {
    if (Utilities.formatDate(new Date(e.when), IST, 'yyyy-MM-dd') !== today) return;
    if (!/status/i.test(e.field || '') || /content|live/i.test(e.field || '') || !e.record) return;
    const st = CODATA.stageOf(e.after || '', '')[0];
    moves.push({ id: String(e.record), to: st, raw: String(e.after || ''), at: e.when, who: e.who });
  });
  const out = { ok: true, date: today, moves: moves };
  c.put('daily', JSON.stringify(out), 60);
  return out;
}

/* ============================ Delivered On ============================
 * The sheets have no record of when a creative was actually delivered, so on-time rate and turnaround could not be
 * measured. Every 10 minutes (remindersTick) this:
 *  1. adds a "Delivered On" column to each task tab once (logged in the activity log),
 *  2. compares each task's design status with the last check (kept in the hidden "Delivery dates" tab of the access
 *     workbook) and writes today's date for tasks that have just become delivered (DONE, REJECTED, NO UPDATE),
 *     including tasks reopened and delivered again,
 *  3. on the first run, fills dates only from the activity log (status changes to DONE it recorded); older deliveries
 *     stay blank and the dashboard keeps dating them by their Design ETA. No date is ever guessed.
 * A date someone types in the column by hand is never overwritten (unless the task is reopened and delivered again). */
const DELIV_TAB = 'Delivery dates';
const DELIV_BULK = 25; // more "new" deliveries than this in one 10-minute check is a bulk change, never dated
/* Reads one task tab: header, the Delivered On column (added once if missing) and each task's key and status. */
function delivTab_(name, add, logged) {
  const kind = kindOf_(name); if (kind === 'team') return null;
  let sheet; try { sheet = openTab_(CONFIG.sources[name]); } catch (e) { return null; }
  const lastRow = sheet.getLastRow(), lastCol = Math.max(1, sheet.getLastColumn()); if (lastRow < 2) return null;
  const head = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const c = taskColumns_(kind, head.map(function (h) { return clean_(h).toLowerCase(); }));
  if (c.status < 0) return null;
  if (c.delivered < 0) {
    if (!add) return null;
    if (sheet.getMaxColumns() <= lastCol) sheet.insertColumnAfter(lastCol);
    sheet.getRange(1, lastCol + 1).setValue('Delivered On');
    c.delivered = lastCol;
    logged.push({ who: Session.getEffectiveUser().getEmail(), role: 'Script', action: 'Column added', sheet: sheet.getParent().getName(), tab: sheet.getName(), field: 'Delivered On', after: 'Column ' + (lastCol + 1), details: 'Filled automatically with the date a task becomes delivered, for on-time rate and turnaround', via: 'Dashboard' });
  }
  const width = Math.max(c.id, c.status, c.delivered) + 1;
  const vals = sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues();
  const seen = {}, rows = [];
  vals.forEach(function (v, i) {
    const id = clean_(v[c.id]); if (!id) return;
    seen[id] = (seen[id] || 0) + 1;
    rows.push({ row: i + 2, id: id, key: name + ' | ' + id + (seen[id] > 1 ? ' #' + seen[id] : ''), done: CODATA.groupOf(CODATA.stageOf(clean_(v[c.status]), '')[0]).done, value: clean_(v[c.delivered]) });
  });
  return { name: name, sheet: sheet, col: c.delivered + 1, rows: rows };
}
function delivState_(book) {
  let st = book.getSheetByName(DELIV_TAB);
  if (!st) { st = book.insertSheet(DELIV_TAB); try { st.hideSheet(); } catch (e) { /* ignore */ } }
  return st;
}
function delivSave_(st, next) {
  const keys = Object.keys(next);
  st.clearContents();
  st.getRange(1, 1, 1, 2).setValues([['Task (source | ID)', 'State']]);
  if (keys.length) st.getRange(2, 1, keys.length, 2).setValues(keys.map(function (k) { return [k, next[k]]; }));
}
/* Every 10 minutes (remindersTick). The first complete run only notes which tasks are already delivered (nothing is
 * written to the task sheets). After that, a task whose status has just become DONE or REJECTED gets that day's date.
 * "First run done" is recorded only after the state is saved, so an interrupted run can never date old tasks as new.
 * More than DELIV_BULK new deliveries in one check (a pasted status column, a restored sheet) is treated as a bulk
 * change: nothing is dated, it is logged, and the state moves on. A date typed by hand is never overwritten. */
function deliveryDates_() {
  if (!hasAccessBook_()) return { ok: false };
  const lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    const props = PropertiesService.getScriptProperties(), book = accessBook_(), st = delivState_(book);
    const init = !!props.getProperty('DELIV_INIT'), logged = [], prev = {}, next = {};
    if (init && st.getLastRow() > 1) st.getRange(2, 1, st.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0]) prev[String(r[0])] = String(r[1]); });
    const tabs = Object.keys(CONFIG.sources).map(function (n) { return delivTab_(n, true, logged); }).filter(Boolean);
    const fresh = [];
    tabs.forEach(function (t) {
      t.rows.forEach(function (r) {
        const was = prev[r.key];
        if (r.done) { next[r.key] = 'delivered'; if (init && was !== 'delivered' && (!r.value || was === 'reopened')) fresh.push({ t: t, r: r }); }
        else if (was === 'delivered' || was === 'reopened') next[r.key] = 'reopened';
      });
    });
    let stamped = 0;
    if (init && fresh.length > DELIV_BULK) {
      logged.push({ who: Session.getEffectiveUser().getEmail(), role: 'Script', action: 'Delivered On skipped', details: fresh.length + ' tasks became delivered in one check (a bulk change), so none were dated. Type their Delivered On dates by hand if needed.', via: 'Dashboard' });
    } else if (init) {
      const now = today_();
      fresh.forEach(function (x) { x.t.sheet.getRange(x.r.row, x.t.col).setNumberFormat('dd-mmm-yyyy').setValue(now); stamped++; });
      const byTab = {}; fresh.forEach(function (x) { (byTab[x.t.name] = byTab[x.t.name] || []).push(x); });
      Object.keys(byTab).forEach(function (n) { const l = byTab[n], sh = l[0].t.sheet; logged.push({ who: Session.getEffectiveUser().getEmail(), role: 'Script', action: 'Delivered On filled', sheet: sh.getParent().getName(), tab: sh.getName(), field: 'Delivered On', after: Utilities.formatDate(now, IST, 'd MMM yyyy'), details: l.length + ' task(s): ' + l.map(function (x) { return x.r.id; }).slice(0, 40).join(', '), via: 'Dashboard' }); });
    }
    delivSave_(st, next);
    if (!init) { props.setProperty('DELIV_INIT', new Date().toISOString()); logged.push({ who: Session.getEffectiveUser().getEmail(), role: 'Script', action: 'Delivered On started', details: Object.keys(next).length + ' delivered tasks noted; no dates written. From now on each delivery is dated when its status becomes DONE or REJECTED.', via: 'Dashboard' }); }
    if (logged.length) audit_(logged);
    if (stamped || logged.length) { bumpVersion_(); clearCache_(); }
    return { ok: true, first: !init, stamped: stamped, skipped: init && fresh.length > DELIV_BULK ? fresh.length : 0, tracked: Object.keys(next).length };
  } finally { lock.releaseLock(); }
}
/* One-time repair (10 Nov 2026): an interrupted first run let the next run date every delivered task with that day.
 * Clears Delivered On on any date that appears on DELIV_BULK or more rows of a tab, except where the activity log shows
 * that task's status changed to DONE/REJECTED on that date, or someone typed the date in. Then starts the state afresh. */
function repairDeliveredOn_() {
  if (!hasAccessBook_()) return { ok: false };
  const lock = LockService.getScriptLock(); if (!lock.tryLock(30000)) return { ok: false, error: 'busy' };
  try {
    const evidence = {}; // 'tab | ID | yyyy-MM-dd' → true
    const sh = accessBook_().getSheetByName('Audit');
    if (sh && sh.getLastRow() > 1) {
      const n = Math.min(sh.getLastRow() - 1, 30000);
      sh.getRange(sh.getLastRow() - n + 1, 1, n, AUDIT_HEAD.length).getValues().forEach(function (v) {
        const when = v[0] instanceof Date ? v[0] : new Date(v[0]); if (isNaN(when)) return;
        const day = Utilities.formatDate(when, IST, 'yyyy-MM-dd'), tab = String(v[5]), id = clean_(v[6]), field = clean_(v[8]), after = clean_(v[10]), who = String(v[1]);
        if (!id) return;
        const human = !/^Script$/.test(String(v[2]));
        if ((after && !/\d/.test(after) && CODATA.groupOf(CODATA.stageOf(after, '')[0]).done) || (human && /deliver/i.test(field))) evidence[tab + ' | ' + id + ' | ' + day] = true;
      });
    }
    const report = [], logged = [];
    Object.keys(CONFIG.sources).forEach(function (name) {
      const t = delivTab_(name, false, logged); if (!t) return;
      const range = t.sheet.getRange(2, t.col, t.sheet.getLastRow() - 1, 1), cells = range.getValues(), shown = range.getDisplayValues();
      const dayOf = function (v, d) { if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, IST, 'yyyy-MM-dd'); const p = CODATA.parseDate(d); return p || ''; };
      const count = {}; cells.forEach(function (c, i) { const d = dayOf(c[0], shown[i][0]); if (d) count[d] = (count[d] || 0) + 1; });
      const bulk = Object.keys(count).filter(function (d) { return count[d] >= DELIV_BULK; });
      if (!bulk.length) return;
      const idByRow = {}; t.rows.forEach(function (r) { idByRow[r.row] = r.id; });
      let cleared = 0, kept = 0;
      const out = cells.map(function (c, i) {
        const d = dayOf(c[0], shown[i][0]); if (bulk.indexOf(d) < 0) return [c[0]];
        const id = idByRow[i + 2];
        if (id && evidence[t.sheet.getName() + ' | ' + id + ' | ' + d]) { kept++; return [c[0]]; }
        cleared++; return [''];
      });
      if (cleared) range.setValues(out);
      report.push(t.sheet.getName() + ': ' + cleared + ' cleared, ' + kept + ' kept (dates ' + bulk.join(', ') + ')');
    });
    PropertiesService.getScriptProperties().deleteProperty('DELIV_INIT'); // the next check notes the current state afresh
    if (report.length) audit_([{ who: Session.getEffectiveUser().getEmail(), role: 'Script', action: 'Delivered On repaired', details: 'Bulk-written dates removed. ' + report.join('; '), via: 'Dashboard' }]);
    bumpVersion_(); clearCache_();
    return { ok: true, report: report };
  } finally { lock.releaseLock(); }
}
/** Run from the editor to set up the Delivered On column now instead of waiting for the next 10-minute check. */
function setupDeliveredOn() { Logger.log(JSON.stringify(deliveryDates_())); }
/** Run from the editor to clear bulk-written Delivered On dates again (normally done once, automatically). */
function repairDeliveredOn() { Logger.log(JSON.stringify(repairDeliveredOn_())); }

/* Only the person's own tasks (permission "scope: own"): rows whose designer/editor or content owner names them. */
function permText_(p) {
  return 'pages: ' + p.pages.join(', ') + '; edit tasks: ' + (p.edit ? 'yes' : 'no') + '; download data: ' + (p.export ? 'yes' : 'no') + '; workload and others\' work: ' + (p.load ? 'yes' : 'no') + '; manage team list: ' + (p.team ? 'yes' : 'no') + '; Fasty: ' + (p.fasty ? 'yes' : 'no') + '; tasks: ' + (p.scope === 'own' ? 'only their own' : 'all');
}
function ownDataText_(user, fresh) {
  const all = JSON.parse(dataText_(fresh));
  const names = [user.name || ''];
  try {
    const team = all.sources && Object.keys(all.sources).map(function (k) { return all.sources[k]; }).filter(function (x) { return x && x.kind === 'team'; })[0];
    if (team) { const t = CODATA.parseTeam(team); const me = t.filter(function (m) { return m.name.toLowerCase() === String(user.name || '').toLowerCase() || String(m.aliases || '').toLowerCase().split(/\s*,\s*/).indexOf(String(user.name || '').toLowerCase()) >= 0; })[0]; if (me) { names.push(me.name); String(me.aliases || '').split(',').forEach(function (a) { names.push(a); }); } }
  } catch (e) { /* names from the Google profile only */ }
  const keys = names.map(function (n) { return String(n).toLowerCase().trim(); }).filter(function (n) { return n.length > 2; });
  const first = keys.length ? keys[0].split(' ')[0] : '';
  Object.keys(all.sources || {}).forEach(function (k) {
    const src = all.sources[k]; if (!src || src.kind === 'team' || !Array.isArray(src.rows)) return;
    const head = (src.headers || []).map(function (h) { return clean_(h).toLowerCase(); });
    const cols = taskColumns_(kindOf_(k), head); cols.owner = head.findIndex(function (h) { return /content owner|^owner$/.test(h); });
    const keep = [], nums = [];
    src.rows.forEach(function (r, i) {
      const d = String(r[cols.designer] == null ? '' : r[cols.designer]).toLowerCase(), o = cols.owner >= 0 ? String(r[cols.owner] == null ? '' : r[cols.owner]).toLowerCase() : '';
      if (keys.some(function (n) { return d.indexOf(n) >= 0; }) || (first && o.split(/[ ,]+/).indexOf(first) >= 0)) { keep.push(r); if (src.rowNums) nums.push(src.rowNums[i]); }
    });
    src.rows = keep; if (src.rowNums) src.rowNums = nums;
  });
  all.scope = 'own';
  return JSON.stringify(all);
}
