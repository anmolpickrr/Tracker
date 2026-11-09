/**
 * Creative Ops Tracker – settings
 *
 * Keep this file next to Code.gs in the Apps Script project. Code.gs holds the logic and can be
 * replaced with a newer version from GitHub at any time; your links and settings stay here.
 * The copy of this file on GitHub has placeholders: keep real links in Apps Script only.
 */

/* The links to your sheets (the full URL from the browser is fine). */
const CONFIG = {
  /*
   * One line per sheet tab the dashboard reads. `kind` says how the tab is laid out:
   *   'paid' – the client (Paid) sheet layout   'mkt' – the Marketing team layout   'team' – the team list
   * To add a new sheet or tab (for example a 2027 sheet), copy a line, give it a new name,
   * paste the sheet link and the tab name, then save and run setup() again. No redeploy needed.
   * List the newest tab of each kind first: if the same ID appears in two tabs, the first one listed wins.
   */
  sources: {
    // Client creative requests ("Design Requirements (PAID)"), tab "2026".
    paid: { sheet: 'PASTE_PAID_SHEET_LINK', tab: '2026', kind: 'paid' },
    // Marketing team requests ("Design Requirements"), tab "2026 (Mkt Team)".
    mkt: { sheet: 'PASTE_MARKETING_SHEET_LINK', tab: '2026 (Mkt Team)', kind: 'mkt' },
    // Earlier marketing history (Nov 2024 – Dec 2025) from the same sheet. Delete this line to leave it out.
    mkt2025: { sheet: 'PASTE_MARKETING_SHEET_LINK', tab: '2025', kind: 'mkt', optional: true },
    // Example for next year (remove the // to use it):
    // mkt2027: { sheet: 'PASTE_2027_SHEET_LINK', tab: 'Sheet1', kind: 'mkt' },
    // Team list: Name, Status (Active / Inactive), Role, Also written as, Notes. First tab.
    team: { sheet: 'PASTE_TEAM_LIST_SHEET_LINK', tab: '', kind: 'team' }
  },
  cacheSeconds: 600, // a cached copy is only used while the sheets are unchanged

  access: {
    // OAuth client ID (Google Cloud → Google Auth Platform → Clients → Web application). Not a secret.
    // While this still says PASTE_…, sign-in is off and the shared key is used instead.
    clientId: 'PASTE_GOOGLE_CLIENT_ID',
    // Always Admin; cannot be removed or demoted from the dashboard, so you can never be locked out.
    owners: ['PASTE_OWNER_EMAIL'],
    // Only Google accounts from these domains can sign in or ask for access.
    domains: ['pickrr.com', 'shiprocket.com'],
    // true: the account must be managed by the company's Google Workspace (not a personal Google account using a work address).
    workspaceOnly: true,
    sessionHours: 12, // how long a sign-in lasts on one browser
    emailAdmins: true, // email the admins when someone asks for access, and the person when they are approved
    dashboardUrl: 'https://anmolpickrr.github.io/Tracker/'
  }
};
