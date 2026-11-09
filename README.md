# Creative Ops Tracker

A live dashboard for the Fastrr creative team: the daily stand-up, who is working on what, deadlines, workload, and monthly delivery reports. It reads the team's Google Sheets directly, so there is nothing to update by hand.

**Live site:** https://anmolpickrr.github.io/Tracker/

## What it shows

Navigation is a sidebar on desktop and a bottom tab bar on phones (More opens the rest).

| Page | For |
| --- | --- |
| **Overview** | Open, overdue, due-today, in-progress, under-review and delivered-this-month counts (each opens the matching task list). **Needs attention**: overdue, due soon and changes requested. **Unassigned**: work nobody has picked up, oldest and overdue first. **Pipeline** by design status, **workload** per designer, and what is **coming up** in the next 14 days. |
| **Stand-up** | One card per active team member for the daily meeting: overdue, due today, in progress, changes requested and up next, with a summary strip on top. |
| **Tasks** | Every task from both sheets. One-click status chips with counts (Not delivered, Open, Overdue, Due this week, No ETA, Under review, Delivered this month, All), search, sorting, CSV. Click a task to open or edit it. On phones each task is a card. |
| **Team** | Scorecard per person (open, overdue, due in 7 days, in review, delivered this month and last, monthly average, main brands, type mix), a designer-by-month delivery grid, and Active / Inactive switches (admins). |
| **Reports** | Creatives delivered for any month, quarter, year or custom range, compared with the period before: monthly chart (total or by type), by brand, by designer, by creative type. CSV. |
| **Data health** | Rows that make tracking unreliable (no ETA, no designer, unknown status, mistyped dates, duplicates) and the connection status of every sheet. |
| **Access** (admins) | Access requests, people and their access level, and the activity log of every change. |

Light and dark themes. Chart colours are a validated colour-blind-safe set, and every chart value is also available as a label, tooltip or table.

Filters for sheet, designer, brand and creative type sit above every data page (on phones behind **Filters**) and apply to all of it. Active filters are highlighted.

## How it works

```
Google Sheets ──► Apps Script web app (runs as design.tools, checks who is asking) ──► this page (GitHub Pages)
```

This repository and the site are public, but they contain **no data**: the page is only a shell. All data comes from the web app, which gives it only to people who have signed in with an approved Google work account (see [Access and sign-in](#access-and-sign-in)). Edits made on the dashboard go back through the same web app into the sheets, and each one is recorded in the activity log.

Sources read by the web app (`CONFIG` in `apps-script/Config.gs`):

| Source | Sheet | Tab |
| --- | --- | --- |
| Paid (client) requests | Design Requirements (PAID) | `2026` |
| Marketing team requests | Design Requirements | `2026 (Mkt Team)` |
| Marketing history | Design Requirements | `2025` (optional) |
| Team list | Creative Team List (Dashboard) | first tab |

## Accounts and ownership

One Google account runs the whole integration, so nothing depends on which account a person happens to be signed into.

| What | Account | Why |
| --- | --- | --- |
| Apps Script web app (owner and "Execute as") | **design.tools@pickrr.com** | A team account, not a person's: the dashboard keeps working if people change roles. Dashboard edits show as "design tools" in each sheet's version history. |
| Team list sheet | design.tools@pickrr.com | Owned by the same account that edits it. |
| Requirement sheets | Owned by anmol.sharma@pickrr.com; **design.tools must stay an Editor** | If that access is removed, the dashboard can no longer read or save. Sheet health shows it. |
| GitHub repository and Pages site | anmolpickrr | Code only: no keys, sheet links or data. |
| People using the dashboard | Their own @pickrr.com / @shiprocket.com Google account | Each person signs in with Google and gets the role an admin gave them. |
| Access list and activity log | design.tools@pickrr.com | A spreadsheet that `setup()` creates, *Creative Ops Tracker – Access & Audit Log*. Only the web app writes to it; the owners can view it. |

**Do Apps Script work in a browser profile signed into design.tools@pickrr.com only.** Apps Script misbehaves when one browser is signed into several Google accounts: scripts end up authorised or run as the wrong account, which shows as "Action not allowed" or "You do not have permission to access the requested document". A separate Chrome profile for design.tools avoids this permanently.

## Connect the dashboard to the sheets (once, about 5 minutes)

Do this in a browser profile signed into **design.tools@pickrr.com only** (see above). That account needs Editor access to both requirement sheets.

1. Go to https://script.google.com and click **New project**. Name it "Creative Ops Tracker API".
2. The project has two script files:
   - **Code.gs**: delete the sample code and paste in [`apps-script/Code.gs`](https://raw.githubusercontent.com/anmolpickrr/Tracker/main/apps-script/Code.gs) from this repository, unchanged. It holds no links or keys.
   - **Config.gs**: click **+ → Script**, name it `Config`, and paste the private Drive file **"Creative Ops Tracker – Config.gs"**. That copy already has your sheet links and owner filled in. Alternatively, paste [`apps-script/Config.gs`](apps-script/Config.gs) and replace its `PASTE_…` placeholders. Keep the real links in Apps Script only: this repository is public.
3. Save, pick **setup** in the function menu at the top, and click **Run**. Allow the permissions it asks for (read and edit your spreadsheets, run triggers). Open **Execution log**: it lists the rows found in each sheet, the account the web app runs as, which sheets have change detection, and your **key**.
4. Click **Deploy → New deployment**, type **Web app**, **Execute as: Me**, **Who has access: Anyone**. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
5. Open https://anmolpickrr.github.io/Tracker/, click **Connect**, paste the URL and the key, and click **Save and load**.

**To update the script later**, replace Code.gs only; Config.gs keeps your settings. Then use **Deploy → Manage deployments → Edit → Version: New version** so the URL stays the same.

Until Google sign-in is switched on, the dashboard uses the older shared key: anyone with the URL and key can see and edit everything, and nobody's changes can be told apart. Switch sign-in on (next section) to end that.

## Access and sign-in

### Who can do what

Nobody sees any data until an admin approves them.

| Role | Can |
| --- | --- |
| *(not approved)* | See the sign-in screen. Nothing else: the web app gives no data without an approved sign-in. |
| **View only** | See every tab and download CSVs. Task details open read-only. |
| **Can edit** | View only, plus change tasks: design status, Design ETA, designer, priority and number of creatives. |
| **Admin** | Can edit, plus the team list (Active / Inactive, add members), the **Access** tab (approve, change roles, revoke), the activity log and the integration checks on Sheet health. |
| **Owner** | Admin who can never be revoked or demoted from the dashboard (`CONFIG.access.owners`), so you can't be locked out. |

The web app checks the role on **every** request. Hiding buttons on the page is only for convenience, so changing the page's code gains nothing. Role changes and revocations reach open dashboards within 30 seconds. A revoked person's screen is cleared, they are signed out, and they cannot sign back in.

### How a person gets in

1. They open the site and choose **Sign up**: they enter their team and an optional note, then continue with their work Google account. Choosing **Log in** without having access does the same, just without the team and note. Either way, all they get is a request, and no data.
2. Only Google Workspace accounts on **@pickrr.com** or **@shiprocket.com** are accepted (`CONFIG.access.domains`). Personal Google accounts and other domains are refused, and the refusal is logged.
3. The admins get an email. The request appears under **Access → Access requests**.
4. An admin picks **View only**, **Can edit** or **Admin** and clicks **Approve**, or clicks **Reject**. The person gets an email and can then **Log in**.

Everything about access is managed on the **Access** tab, with no need to open Google Sheets or Apps Script:

- The tab reads **Access (n waiting)** when requests are open.
- Click anyone's name to open their **profile**: Google photo, name, email, team, note, when they asked, who decided and when, last sign-in, and their own activity. From the profile you can approve, reject, change their access level, revoke, or give access again.
- **People with access** lists everyone, with an access-level menu, a **Revoke** button and an **Activity** link that filters the log to that person.
- **Give access** adds someone directly by email, without them asking first.
- Rejected and revoked people can't get back in by signing up again. Their attempts appear in the log as "Sign-in blocked".

A sign-in lasts 12 hours on a browser (`sessionHours`), then Google signs the person back in with one click. To end every session at once, run `signOutEveryone` in Apps Script.

### Activity log

**Access → Activity log** lists every change, newest first: when, who (and their role), what, which task or record, which column, the value **before and after**, and where (sheet, tab, row). You can search it by task ID, person, brand or value, filter it by kind, and download it as CSV. Opening a task and clicking **Change history** shows that task's entries.

| Recorded | Who is recorded | Before and after |
| --- | --- | --- |
| Task edits made on the dashboard | The signed-in person | Yes, every cell written |
| Edits typed into the sheets (tabs the dashboard reads) | The Google account, when Google reports it (it usually does inside your company; otherwise "Not reported by Google") | Yes for single cells. For pastes and fills, Google only gives the new values; the sheet's version history has the old ones |
| Rows or columns added or deleted in the sheets | As above | Google doesn't say which rows; see version history |
| Team list changes, access requests, approvals, role changes, revocations | The admin, or the person asking | Yes |
| Sign-ins, sign-outs, refused sign-ins | The person | — |

The log is kept in the *Creative Ops Tracker – Access & Audit Log* spreadsheet in design.tools' Drive. Only the web app writes to it, and its tabs are protected. Owners can view it but nobody can edit or delete entries through the dashboard. Edits made by other scripts and integrations (they don't fire Google's edit triggers) still sync to the dashboard, but they are not in this log; the sheet's version history has them.

The dashboard controls who can use the **dashboard**. It doesn't change who can open the **Google Sheets** themselves: that is still set by each sheet's Share settings. The requirement sheets are currently editable by everyone at pickrr.com. Edits made there are logged as above.

### Switching sign-in on (once, about 10 minutes)

Do this in the browser profile signed into **design.tools@pickrr.com** only.

**1. Create the Google sign-in client** at https://console.cloud.google.com

1. Create a project named **Creative Ops Tracker** (top bar → project picker → **New project**).
2. Go to **Google Auth Platform** (search for "Google Auth Platform", or open **APIs & Services → OAuth consent screen**) and click **Get started**:
   - App name **Creative Ops Tracker**; support email design.tools@pickrr.com.
   - Audience **External**. Users from both @pickrr.com and @shiprocket.com have to sign in, and the web app enforces the two domains itself.
   - Contact email design.tools@pickrr.com. Agree, then click **Create**.
3. **Audience → Publish app → Confirm.** Sign-in only uses the basic name and email scopes, so Google doesn't review the app.
4. **Clients → Create client**:
   - Type **Web application**, name **Tracker site**.
   - **Authorised JavaScript origins:** `https://anmolpickrr.github.io`
   - Leave redirect URIs empty and click **Create**.
5. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). It is not a secret.

**2. Update the web app** at https://script.google.com, project *Creative Ops Tracker API*:

1. Replace everything in **Code.gs** with [this repository's `Code.gs`](https://raw.githubusercontent.com/anmolpickrr/Tracker/main/apps-script/Code.gs). Then add a second file: **+ → Script**, named `Config`, holding the Drive file *Creative Ops Tracker – Config.gs*. In Config.gs, paste the client ID over `PASTE_GOOGLE_CLIENT_ID`.
2. **Project Settings → Show "appsscript.json"**, then paste [`apps-script/appsscript.json`](apps-script/appsscript.json) over it. It adds permission to check sign-ins with Google and to send the approval emails.
3. Save, run **setup** and allow the permissions. The log prints the address of the access list and log, and says *Sign-in is ON*.
4. **Deploy → Manage deployments → Edit → Version: New version → Deploy.** The URL stays the same.

From then on, the shared key no longer works. Everyone, including you, signs in with Google at https://anmolpickrr.github.io/Tracker/. Ask the team to sign up, then approve them under **Access**.

## Live sync

Open dashboards ask the web app **every 30 seconds** whether anything changed, and reload only when it has:

- **Edits typed in the sheets** are caught by the edit triggers that `setup()` installs.
- **Edits made by other scripts, forms and integrations** (the Marketing sheet has two automation accounts writing to it) don't fire edit triggers, so the web app also checks each sheet's Google Drive "last modified" time. This needs the read-only Drive permission in [`apps-script/appsscript.json`](apps-script/appsscript.json): in Apps Script, **Project Settings → Show "appsscript.json" manifest file**, paste that file over it, save, and run `setup` once.
- The web app keeps one cached copy of the sheets and serves it only while nothing has changed, so many open dashboards don't slow it down, and nobody sees a stale copy after a change.
- A full reload also runs every 5 minutes and when you return to the tab. "Overdue" and "due today" move at midnight on their own.
- The header shows **Live · data from <time> · checked <n>s ago**. **Sheet health** shows which account the web app runs as and whether both kinds of change detection are on.

**Dashboard → sheet:** click any task (in Today, Stand-up, All tasks or Sheet health) to change its **design status, Design ETA, designer or priority**, and **No. of Creatives** once that column exists. **Save to sheet** writes into that task's row, found by its ID. Status values are written in the sheet's own spelling (its dropdown's options, else the values already used: `WIP`, `TBP`, `DONE`, `Shared`…). Marking a task Delivered also fills **Delivered On** when that column exists and is empty. Team Active/Inactive switches and **Add a team member** write to the team list sheet.

Rows without an ID, or whose ID appears twice in a tab, are not edited from the dashboard: the dialog says so, and they can be fixed in the sheet.

## How the numbers are worked out

- **One row = one task.** Rows with no brand, creative type or creative are not tasks; they are listed in Sheet health as "Incomplete row, not counted", so nothing drops out unseen.
- **Same task in two tabs** (for example a task carried into a new year's sheet with the same ID): counted once, from the tab listed first.
- **Two different tasks with the same ID** in one tab: both are counted, and both are flagged "Duplicate ID" so the ID can be fixed.
- **Creatives** = sum of "No. of Creatives" when that column exists, else 1 per task.
- **Open** = To be planned + In progress + Changes requested (plus any status the dashboard doesn't recognise). **Overdue** = open with a Design ETA before today.
- **Delivered** = design status DONE/Delivered, dated by **Delivered On** if the sheet has it, else the Design ETA (else the request date), and never later than today.
- **Mistyped years** (e.g. a February 2026 request typed as 2025, or "0206") are corrected using the tab's normal date range, the neighbouring rows and the other date on the row. Every correction is listed in Sheet health; no date is changed silently.
- Brand and creative-type spellings that differ only in case or a plural "s" are merged ("Gif"/"GIF", "Listings"/"Listing").
- A task shared by two designers counts once in team totals and once for each designer in per-person views.

## Managing the team

- Admins switch people between **Active** and **Inactive** on the **Team** tab, or edit the Status column of the *Creative Team List (Dashboard)* sheet directly. Inactive people leave the stand-up and workload views; their past work stays in reports.
- Anyone new who appears as a designer in the task sheets shows up automatically, marked **New**. Click **Add to team** to put them on the list.
- **Also written as** in the team sheet holds other spellings (for example "Yashika" for "Yashika Agrawal").

## How the sheets are read

**Design status → dashboard status**

| In the sheet | Shown as | Counts as open work |
| --- | --- | --- |
| TBP, blank | To be planned | yes |
| WIP, In progress | In progress | yes |
| Changes | Changes requested | yes |
| Under review, Review, Shared | Under review | no |
| DONE, Delivered | Delivered | no |
| HOLD, On hold, No update | On hold | no |
| Deprioritized, Rejected, Cancelled | Dropped | no |
| blank/TBP with content Incomplete brief, Pending, WIP or TBD | Awaiting brief | no |
| anything else | shown as typed, flagged in Sheet health | yes |

**Designers** come from *Designer/Editor* (Paid) and *Creator* (Marketing). Several names in one cell ("Rajnish Shubham Rana", "Yashika Agrawal, Sagun") are split into each person, and a task shared by two people counts for both.

**Dates** like `20-Apr-2026`, `22 April 2026`, `23-10-2026` and `6/3/2026` are all understood. Obvious year typos (`0206`, `2025` for a 2026 task) are corrected for counting and listed in Sheet health.

### Two columns worth adding to both task sheets

The dashboard picks these up automatically by their header name:

- **`No. of Creatives`**: how many creatives a task asks for. Without it, each row counts as one.
- **`Delivered On`**: the date the creative was actually delivered. Without it, delivered work is dated by its Design ETA, so monthly reports are close but not exact.

## Adding a sheet or tab (for example, a new year)

Every sheet tab the dashboard reads is one line in `CONFIG.sources` in the **Config.gs** file of the Apps Script project (in the design.tools browser profile):

```js
mkt2027: { sheet: 'https://docs.google.com/spreadsheets/d/…/edit', tab: 'Sheet1', kind: 'mkt' },
```

- `kind` is the tab's layout: `'mkt'` for the Marketing layout, `'paid'` for the Paid layout, `'team'` for the team list.
- Put the newest tab of each kind **first**. If a task is copied into the new year's sheet with the same ID, the first listed copy is the one shown and edited, so it is never counted twice.
- Make sure design.tools@pickrr.com is an **Editor** of the new sheet.
- Save, then run **setup** once (it adds change detection for the new sheet). No redeploy and no dashboard change are needed: the dashboard reads every tab the web app reports.
- To stop reading an old tab, delete its line, save and run setup.

## Files

```
index.html             page structure, sign-in screen
assets/config.js       the web app address (public; it serves nothing without sign-in)
assets/theme.js        applies the saved light/dark theme before the page paints
assets/style.css       Fastrr look, light and dark themes
assets/data.js         turns sheet rows into one clean task list (statuses, designers, dates)
assets/app.js          views, filters, charts, sign-in, roles, access and activity log
apps-script/Code.gs    the data API that runs in Google Apps Script: reads, edits, sign-in, roles, audit log
apps-script/Config.gs  its settings: sheet links, sign-in client ID, owners, domains (placeholders here)
apps-script/appsscript.json  its permissions
```

The page sets a Content Security Policy: scripts only from this site, jsDelivr (d3) and Google sign-in, and data only from the Apps Script web app.

No build step: edit and push to `main`, and GitHub Pages publishes the site.
