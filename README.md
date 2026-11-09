# Creative Ops Tracker

A live dashboard for the Fastrr creative team: the daily stand-up, who is working on what, deadlines, workload, and monthly delivery reports. It reads the team's Google Sheets directly, so there is nothing to update by hand.

**Live site:** https://anmolpickrr.github.io/Tracker/

## What it shows

| Tab | For |
| --- | --- |
| **Today** | Open, in-progress, overdue and due-today counts; a "Needs attention" list; workload per designer; the pipeline by design status; what is coming up in the next 14 days. |
| **Stand-up** | One card per active team member for the daily meeting: overdue, due today, in progress, changes requested and up next. Green cards have no open work. |
| **All tasks** | Every task from both sheets, searchable and sortable, with links to the brief, creative and source file. Click a task to edit it. Download as CSV. |
| **Team** | Scorecard per person (open, WIP, overdue, delivered this month and last, monthly average, type mix), a designer-by-month delivery grid, and Active / Inactive switches. |
| **Reports** | Creatives delivered for any month, quarter, year or custom date range, compared with the period before, broken down by brand, designer and creative type. Download as CSV. |
| **Sheet health** | Rows that make tracking unreliable: open work with no ETA or designer, unknown statuses, mistyped dates, delivered work with no link. |

Filters for sheet, designer, brand and creative type apply to every tab.

## How it works

```
Google Sheets ──► Apps Script web app (runs as you, needs a key) ──► this page (GitHub Pages)
```

This repository and the site are public, but they contain **no data**. The page asks for the web app URL and key once, keeps them in that browser only, and loads the sheets through it. Edits made on the dashboard go back through the same web app into the sheets.

Sources read by the web app (`apps-script/Code.gs`, `CONFIG`):

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
| People using the dashboard | Any browser, no Google sign-in | They only need the web app URL and key, entered once per browser. |

**Do Apps Script work in a browser profile signed into design.tools@pickrr.com only.** Apps Script misbehaves when one browser is signed into several Google accounts: scripts end up authorised or run as the wrong account, which shows as "Action not allowed" or "You do not have permission to access the requested document". A separate Chrome profile for design.tools avoids this permanently.

## Connect the dashboard to the sheets (once, about 5 minutes)

Do this in a browser profile signed into **design.tools@pickrr.com only** (see above). That account needs Editor access to both requirement sheets.

1. Go to https://script.google.com and click **New project**. Name it "Creative Ops Tracker API".
2. Delete the sample code and paste in the script:
   - from the private file **"Creative Ops Tracker – Apps Script code v2"** in design.tools' Google Drive, which already has your sheet links filled in, or
   - from [`apps-script/Code.gs`](apps-script/Code.gs), then replace the four `PASTE_…` placeholders in `CONFIG` with the links to your sheets. Keep the real links in Apps Script only: this repository is public.
3. Save, pick **setup** in the function menu at the top, and click **Run**. Allow the permissions it asks for (read and edit your spreadsheets, run triggers). Open **Execution log**: it lists the rows found in each sheet, the account the web app runs as, which sheets have change detection, and your **key**.
4. Click **Deploy → New deployment**, type **Web app**, **Execute as: Me**, **Who has access: Anyone**. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
5. Open https://anmolpickrr.github.io/Tracker/, click **Connect**, paste the URL and the key, and click **Save and load**.

To give someone else access, send them the site link plus the URL and key (privately). Anyone without the key gets nothing. Anyone with the key can also edit tasks through the dashboard, so share it only with the team.

**If you edit the script later**, use **Deploy → Manage deployments → Edit → Version: New version** so the URL stays the same.

**To revoke access**, run `createKey` (old keys stop working) and share the new key with the people who should still have it.

## Live sync

- **Sheet → dashboard:** `setup()` installs edit triggers on the sheets. Every edit bumps a version number, and open dashboards check that number every 30 seconds, reloading only when something changed. The header shows **Live** when this is on. A full reload also runs every 10 minutes and whenever you come back to the tab, which catches edits the triggers can miss (for example, rows added by other scripts or forms).
- **Dashboard → sheet:** click any task (in Today, Stand-up, All tasks or Sheet health) to change its **design status, Design ETA, designer or priority**, and **No. of Creatives** once that column exists. **Save to sheet** writes into that task's row, found by its ID. Status values are written in the sheet's own spelling: the dropdown's options if the column has one, otherwise the values already used (for example `WIP`, `TBP`, `DONE`, `Shared`). Marking a task Delivered also fills **Delivered On** when that column exists and is empty.
- Team Active/Inactive switches and **Add a team member** write to the team list sheet.
- The **Sheet health** tab shows which account the web app runs as, whether live change detection is on, and whether each sheet can be read and edited.
- Rows without an ID, or with an ID that appears twice in the sheet, are not edited from the dashboard: the dialog says so, and they can be fixed in the sheet.

## Managing the team

- Switch people between **Active** and **Inactive** on the **Team** tab, or edit the Status column of the *Creative Team List (Dashboard)* sheet directly. Inactive people leave the stand-up and workload views; their past work stays in reports.
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

## Changing sources

Sheet links and tab names live in `CONFIG` in your Apps Script project (the copy in this repository has placeholders). If a tab is renamed, update it there and deploy a new version.

## Files

```
index.html          page structure
assets/style.css    Fastrr look, light and dark themes
assets/data.js      turns sheet rows into one clean task list (statuses, designers, dates)
assets/app.js       views, filters, charts, connection, team edits
apps-script/Code.gs the data API that runs in Google Apps Script
```

No build step: edit and push to `main`, and GitHub Pages publishes the site.
