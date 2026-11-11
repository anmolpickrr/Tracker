# Creative Ops Tracker

A live dashboard for the Fastrr creative team: the daily stand-up, who is working on what, deadlines, workload, and monthly delivery reports. It reads the team's Google Sheets directly, so there is nothing to update by hand.

**Live site:** https://anmolpickrr.github.io/Tracker/

## What it shows

Navigation is a sidebar on desktop and a bottom tab bar on phones (More opens the rest).

| Page | For |
| --- | --- |
| **Overview** | Open, overdue, due-today, in-progress, under-review and delivered-this-month counts (each opens the matching task list). **Needs attention**: overdue, due today or tomorrow and changes requested, with a bar showing the mix, filter chips and one row per task (hover for Brief and Creative links); **Minimise** shrinks it to one line with the counts (the cards beside it move into two columns underneath), **Expand** brings the list back, and the choice is remembered on each device. **Unassigned**: work nobody has picked up, oldest and overdue first. **Pipeline** by design status, **workload** per designer, and what is **coming up** in the next 14 days. |
| **Stand-up** | One card per active team member for the daily meeting: overdue, due today, in progress, changes requested and up next, with a summary strip on top. |
| **Tasks** | Every task from both sheets. One-click status chips with counts (Not delivered, Open, Overdue, Due this week, No ETA, Pending approval, Delivered this month, All), search, sorting, CSV. Click a task to open or edit it. On phones each task is a card. |
| **Team** | Scorecard per person (open, overdue, due in 7 days, in review, delivered this month and last, monthly average, main brands, type mix), a designer-by-month delivery grid, and Active / Inactive switches (admins). |
| **Reports** | Creatives delivered for any month, quarter, year or custom range, compared with the period before: monthly chart (total or by type), by brand, by designer, by creative type. CSV. |
| **Data health** | Rows that make tracking unreliable (no ETA, no designer, unknown status, mistyped dates, duplicates) and the connection status of every sheet. |
| **Notes** | A team notebook: meeting minutes, discussions and personal notes with @mentions, action items (assignee and due date), follow-ups and reminders. See [Notes](#notes). |
| **Access** (admins) | Access requests, people and their access level, and the activity log of every change. |

FASTRR look ("Studio"): a Cloud Dancer canvas with white cards and no outlines, an ink sidebar, and **FASTRR blue (#6037D7) for actions and the current page**. Pastel fills carry meaning everywhere: **lavender = open / to do**, **lime = delivered** (Sun Glare on the one hero number), **soft orange = late**; orange is used only for lateness, and there is no green or red text. The clock is an ink capsule with lime digits by day and violet at night. Day and Night themes follow sunrise and sunset (see [Live clock, Day and Night](#live-clock-day-and-night)). The two-strip logo icon is FASTRR blue. Outfit for headings and numbers. The system check is a single line that opens on demand (it opens by itself only when something is broken). Category colours in charts are a colour-blind-safe set, and every chart value is also available as a label, tooltip or table. Secondary table columns appear only on screens wide enough for them; everything is still in the task dialog and the CSV exports.

**Internal and External:** everything from the *Paid (client)* sheet is shown as **External** and everything from the *Marketing team* sheet as **Internal**, in filters, tags, tables, reports and CSV files. This is a display label only: the sheets keep their names, so the import is unchanged. The Reports card for External work shows the ₹ symbol.

**Graph periods:** the Delivery trend, Top brands and the Reports chart each have **Day, Week, Month, Quarter, Year** and **Custom** buttons (custom dates pick a sensible grouping for the span). The choice is remembered per graph. A period still running (today, this week, …) is compared with the same elapsed days of the one before.

Filters for Internal/External, designer, brand and creative type sit above every data page (on phones behind **Filters**) and apply to all of it. Active filters are highlighted.

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

## Updates install themselves

Changes pushed to GitHub reach everyone without anyone copying code:

- **Dashboard** (this site): GitHub Pages publishes it within a minute or two.
- **Web app** (Apps Script): every 10 minutes it checks GitHub for a newer `apps-script/Code.gs`. If there is one, it makes sure the code is complete and has no errors, installs it with the Apps Script API, saves a new version and points the live web app at it (same URL). `Config.gs`, with the private sheet links, is never touched. If a new `appsscript.json` asks for extra Google permissions, it is not installed by itself: the System check asks the owner to approve it once.
- Run `updateNow` in the Apps Script editor to install straight away. Set the script property `AUTO_UPDATE` to `off` to pause updates.

One-time setup (owner): switch on **Google Apps Script API** at script.google.com/home/usersettings, paste this `Code.gs` and `appsscript.json` one last time, run `updateNow` and approve the two new permissions (manage this script's code and deployments), then deploy a new version.

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

## Indian standards

Numbers use Indian grouping (1,00,000), and dates, "today", "overdue" and every time shown follow India Standard Time, wherever the dashboard is opened. The sheets have no money columns today; when one is added, the dashboard's `inr()` formatter shows it as ₹1,25,000 (or ₹2.4 L and ₹1.2 Cr in compact places).

## Daily briefings (IST)

- **10:00 IST, morning briefing:** today's tasks, assignments and priorities. It covers overdue work, work due today, unassigned work, items in review, your own tasks (when your name is on the team list) and your action items from notes.
- **18:00 IST, evening wrap-up:** completed work, pending tasks, delivery status and what is due tomorrow.

Each briefing arrives three ways:
- **By email** to everyone with access, sent by the web app within 10 minutes of the hour. Each person can turn the emails off from the bell menu.
- **On the dashboard,** as a card on the Overview and an item in the notification bell. If the dashboard is open at that moment, the briefing also opens on its own.
- **As a desktop alert,** if the person turns that on in the bell menu (only while the dashboard is open in a tab).

- **In Google Chat (optional),** as a phone notification even when nobody has the dashboard open. In Google Chat, open the team space, then Apps & integrations, Webhooks, Add webhook, and paste the link under Access > Reminders and notifications. Only `https://chat.googleapis.com/v1/spaces/...` links are accepted, and the saved link is never shown again in full.

Admins change the times, the emails and the Chat space under **Access > Reminders and notifications**; each change is recorded in the activity log. The web app checks every 10 minutes, so a briefing goes out within 10 minutes of the time set, once per day. Config.gs `reminders: {...}` only sets the starting values. To email yourself a sample, run `sendTestReminder` in Apps Script.

Browsers cannot show a dashboard alert when no dashboard tab is open (that would need a separate push server), which is why email and Google Chat carry the briefings in that case.

## Notifications (bell)

The bell lists, for the signed-in person: their overdue tasks and tasks due today or tomorrow; for admins, team overdue and unassigned totals; new requirements since yesterday; status, sheet and team changes made by others in the last 48 hours; note mentions and action items; meetings starting within 15 minutes; and the two daily briefings. Every item opens the task, note or page it is about. Emails are not read: the dashboard has no access to anyone's inbox.

## My work (team members)

Everyone lands on **My work** showing their own work (the owner lands on the Overview). My work always opens on your own tasks, including the 183 assigned to the Creative Head in the sheets, plus *Waiting for your review* (UNDER REVIEW) for the Creative Head; *View as* switches to someone else and *Back to my work* returns. It shows four tiles (overdue, due today, in progress, delivered this week) and four lists: **Focus now** (overdue and due today), **Up next** (open work by ETA), **With the client** (shared and waiting for approval, with days waiting) and **Delivered this week**. Content writers also see **Content to write**: briefs whose content they own and are still writing. The person is matched by their Google name against the team list; if a name is spelt differently, add it under *Also written as* in the team sheet. On phones My work replaces Stand-up in the bottom bar for team members.

## Brands and Waiting on client

**Brands** lists every brand with open work, work with a client or deliveries this month or last: open, late, with the client (and the oldest wait), delivered this month against the same working days last month, and the last delivery. Search, sort any column (click or Enter on the header) and click a brand for its tasks.

**Waiting on client** (below it, and where the Overview's *Pending approval* number now leads) opens with how long approvals take: the typical (median) and longest wait, then bars for up to 7 days, 8–14, 15–30 and over 30 days (orange = over 14 days), each with its count and share. Click a bar (or press Enter on it) to list only those tasks; click again for all. Below that it groups everything shared and waiting for approval by brand, longest wait first, with **Download CSV** to send to KAMs. Days are counted from the design ETA, the closest thing the sheets have to a "shared on" date. More than 14 days is marked orange.

## Access levels and sections

- **View only** sees only their own work by default (tasks assigned to them by their name on the team list, or whose brief they own). **Can edit**, **Admin** and the owner see everyone's work, brands and workload. The owner or an Admin can change this per person.
- "Own work" matches people by their team-list name. Someone not on the team list (a KAM, for example) would see nothing, so the Access page warns when that would happen, and the person's dashboard explains it instead of staying blank.
- **Sections:** when you add someone, approve a request or give access back, the *Sections they can open* dropdown picks one, several or all sections; the rest are hidden from their menu and cannot be opened. Click a name on the Access page to change it later. My work is always included.
- **Admins** (and the owner) manage access and see the activity log and live team activity. Admins cannot change the owner's access or their own. Settings stay owner-only.
- Every role sees the same layout and design; only which sections and controls appear changes.

## Live team activity (owner and Admins)

The owner and Admins see **who is online**: a status dot (green = active, amber = idle for 2+ minutes, grey = away/offline), the page they are on, what they are doing there, their last action and how long they have been online. Below it, an **Activity** feed lists everyone's recent dashboard actions as they happen: pages opened, buttons clicked, boxes ticked, filters chosen, searches, tasks opened and updates saved (*Updates only* narrows it to changes). Dashboards report every 15 seconds and a few seconds after an action; the view refreshes every 5 seconds. Times use the server clock. Nothing typed in notes is sent. Everyone is told about this in the privacy notice; it is kept 30 minutes and can be switched off in Settings.

## Notes

Quick sticky notes. Type a note; **@name** tags someone and shares the note with them; **Assign** gives it to teammates (each gets a tick box on the sticky and a bell notification until it is done); **Remind** sets a reminder (in 1 hour, today 6 pm, tomorrow 10 am, Monday 10 am or any time), shown in the bell and emailed. Who can see a note is shown on it: only you, you and the people tagged or assigned, or everyone (*Everyone can see*). Private notes are visible to their author and to Admins: the owner and Admins see every note on the team (a *Team notes* tab, each marked *Visible to you as Admin*, read-only), and the composer tells everyone so ("Only you and Admins can see this"). Click your own sticky to edit it in place; tabs filter All, Mine, Shared with me, Assigned to me and Reminders. Changes by others appear within 30 seconds.

## Fasty: languages, voice and speed

Fasty detects the language of each question (English, Hindi, Hinglish, Marathi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Punjabi) and replies, listens and speaks in it for the rest of the conversation until you switch (also selectable in the header). Voice replies always use the same natural female voice (Google Chirp 3 HD Aoede, or Gemini's Aoede), in every language; if natural speech is unavailable, the device's female voice is used.


Simple questions whose every word Fasty understands (what is overdue / due today / tomorrow, someone's open work, deliveries this month, "open Tasks") are answered instantly from the data already on screen, with no AI round trip. Everything else goes to the AI with today's headline numbers attached, so count questions need no extra lookup; if the AI takes over 20 seconds, Fasty answers in basic mode.

## Delivery date and turnaround

Completed work (DONE or REJECTED) is dated by its **Design ETA**, which the team keeps as the actual delivery date once a task is done (else the request date, and never later than today). No extra column is needed.

**Reports → Turnaround** shows working days from the request date to the Design ETA for work completed in the period: the median, the time 9 in 10 tasks fall within, and the share done within 3 working days. It appears once 10 such tasks fall in the period.

*History:* a "Delivered On" column was added to the task tabs on 10 Nov 2026 and dated old tasks wrongly after an interrupted first run. It was removed the same day: a one-time clean-up deletes that column (header exactly "Delivered On", nothing else) and its hidden "Delivery dates" tab, logged as *Delivered On removed*.

**Dashboard → sheet:** click any task (in Today, Stand-up, All tasks or Sheet health) to change its **design status, Design ETA, designer or priority**, and **No. of Creatives** once that column exists. **Save to sheet** writes into that task's row, found by its ID. Status values are written in the sheet's own spelling (its dropdown's options, else the values already used: `WIP`, `TBP`, `DONE`, `Shared`…). Team Active/Inactive switches and **Add a team member** write to the team list sheet.

Rows without an ID, or whose ID appears twice in a tab, are not edited from the dashboard: the dialog says so, and they can be fixed in the sheet.

## How the numbers are worked out

- **One row = one task.** Rows with no brand, creative type or creative are not tasks; they are listed in Sheet health as "Incomplete row, not counted", so nothing drops out unseen.
- **Same task in two tabs** (for example a task carried into a new year's sheet with the same ID): counted once, from the tab listed first.
- **Two different tasks with the same ID** in one tab: both are counted, and both are flagged "Duplicate ID" so the ID can be fixed.
- **Creatives** = sum of "No. of Creatives" when that column exists, else 1 per task.
- **Open** = To be planned + WIP + Changes requested (plus any status the dashboard doesn't recognise). **Overdue** = open with a Design ETA before today. Under review, Shared, No update, Awaiting brief and Hold are never overdue.
- **Completed** = design status DONE (Delivered, approved) or REJECTED, dated by its **Design ETA** (else the request date), and never later than today. Shared and No update are shared work, not completed.
- **Mistyped years** (e.g. a February 2026 request typed as 2025, or "0206") are corrected using the tab's normal date range, the neighbouring rows and the other date on the row. Every correction is listed in Sheet health; no date is changed silently.
- Brand and creative-type spellings that differ only in case or a plural "s" are merged ("Gif"/"GIF", "Listings"/"Listing").
- A task shared by two designers counts once in team totals and once for each designer in per-person views.

### Working days (Monday to Friday)

Every rate and every comparison uses **working days, Monday to Friday**; Saturdays and Sundays are never counted, so a month has 20 to 23 working days (usually 21 or 22). Public holidays are not taken out.

- **Rates:** Reports shows *Per designer, per working day* (creatives ÷ people who delivered ÷ working days in the period up to today). The Team page shows *Per work day* (this month's creatives ÷ working days so far). Multiply by about 21.7 for a typical month.
- **Comparisons of a period still running** use the same number of working days: on 10 November (7 working days in) the month is compared with the first 7 working days of October (1 to 9 October). Weeks compare Monday-to-date with the same weekdays.
- **Day view in graphs** shows working days only; anything dated on a Saturday or Sunday counts on the Friday before.
- Notes on the Team and Reports pages, and tooltips on the numbers, show the working days used.

### System check (Overview)

A strip at the top of the Overview checks the dashboard every refresh and every minute: that the data loaded and every sheet could be read, that live sync is current, that the web app is up to date, the Google Calendar and assistant set-up (admins), rows that cannot be counted, and a calculation self-check that works out key numbers two independent ways (open work, overdue, delivered this month, workloads, working days) and compares them. When everything is fine it shows one green line; otherwise it lists each problem with what to do and, where possible, a button to fix or open it. People who cannot change a setting only see what affects them.

### Change colours (green is better, red is worse)

Every comparison shows the change as a coloured chip: **green when the number moved the good way, red when it moved the bad way**, and grey for no change. The good way depends on the measure: more delivered is green, but **fewer open, fewer overdue and fewer unassigned is green** and more of them is red. Pending approval has no good or bad direction and stays grey. The shade deepens with the size of the change and reaches full strength at a 50% change, so a small wobble stays pale.

What each comparison is against:
- **Delivered this month, Top brands, Team "This month":** the same days of last month (1 to 9 November against 1 to 9 October), so a month in progress is never compared with a full month.
- **Monthly report chart and "vs prev." columns:** each complete month against the month before; the current month against the same days of the previous month. The chart shows plain bars, the report period in FASTRR blue and other months in lavender; hover a bar for its change, which the tables also show.
- **Delivery trend:** the last complete week against the week before. The current week is drawn faintly and never counted as a drop.
- **Open, Overdue, Pending approval:** against the daily snapshot closest to 7 days ago. These are counts at a moment in time, so the web app saves one snapshot a day after 09:00 IST in the History tab; the comparison appears once a week of snapshots exists and only while no filters are applied.

## Managing the team

- **Roles** live in the *Role* column of the team sheet: Designer, Editor, Designer/Editor, Content Writer, KAM (Design), with "(Intern)" where it applies. They show on the Team page and in Today. A role containing "not shown" (the Creative Head) keeps the person out of team views.
- **Estimated load (admins only):** open work in hours, by creative type (Static 1.5 h, Carousel/GIF ~2–3 h, Video 4 h, AI video 5 h, in-house shoot/video 6 h, …), half for changes requested, ×1.3 for interns, and 1 h for each content-in-progress task a content writer owns. Divided by 7 working hours a day it gives days of work: green under 2.5 days, amber to 5, red above. It is a planning guide, not a performance score, and only admins see it (Team page and Today).

- Admins switch people between **Active** and **Inactive** on the **Team** tab, or edit the Status column of the *Creative Team List (Dashboard)* sheet directly. Inactive people leave the stand-up and workload views; their past work stays in reports.
- Anyone new who appears as a designer in the task sheets shows up automatically, marked **New**. Click **Add to team** to put them on the list.
- **Also written as** in the team sheet holds other spellings (for example "Yashika" for "Yashika Agrawal").

## How the sheets are read

**Design status → dashboard status**

Design Status is the primary field. Content Status only decides whether a task whose design has not started is ready to be picked up. Every task is counted in exactly one of these:

| Design status (content status) | Shown as | Counts as |
| --- | --- | --- |
| TBP or blank (content DONE or blank) | To be planned | **Open** design work: workload, overdue once the Design ETA has passed |
| WIP | WIP | **Open** |
| CHANGES | Changes requested | **Open** (shared, revisions asked) |
| UNDER REVIEW | Under review | Team finished it; the Creative Head hasn't reviewed it yet. Not workload, never overdue |
| SHARED | Shared | **Shared** work: with the client or another team for approval. Never overdue |
| NO UPDATE | No update | **Shared** work: no reply despite follow-ups. Never overdue, not an approved delivery |
| DONE | Delivered | **Completed**, approved |
| REJECTED | Rejected | **Completed** for bandwidth and productivity (the time was spent), **not** an approved delivery; a redo is a new task |
| TBP or blank, content PENDING / INCOMPLETE BRIEF / TBP / WIP / SHARED / CHANGES | Awaiting brief (says which: pending discussion, incomplete brief, ready for scripting, brief in progress, brief with client, brief changes requested) | The brief isn't approved, so not design workload and never overdue. The Content Owner's work |
| HOLD, or design not started and content HOLD | Hold | Parked, never overdue |
| DEPRIORITIZED | Deprioritised | No longer required |
| anything else | shown as typed, flagged in Data health | Open |

**Units:** status counts (open, overdue, shared, under review, awaiting brief) are **tasks**; completed output (this month, reports, per designer per day) is **creatives** (the *No. of Creatives* quantity, 1 per task if blank). The Overview's *Completed this month* shows how many were approved and how many rejected.

**Who a task belongs to:** only the people named in Designer/Editor (External) or Creator (Internal). A task with nobody named is **Unassigned (not allotted)** and is never counted for any person. A task shared by two people counts once in team totals and appears in both people's own views. The Team table ends with an *Unassigned* row, a *Not shown here* row (people hidden or not on the team list) and an *All tasks (each counted once)* row that matches the Overview.

**Creative_ID:** SRAP = External (Paid) sheet, SRA = Internal (Marketing) sheet. Missing IDs, IDs in the wrong sheet and repeated IDs are listed in Data health.

**Designers** come from *Designer/Editor* (Paid) and *Creator* (Marketing). Several names in one cell ("Rajnish Shubham Rana", "Yashika Agrawal, Sagun") are split into each person, and a task shared by two people counts for both.

**Dates** like `20-Apr-2026`, `22 April 2026`, `23-10-2026` and `6/3/2026` are all understood. Obvious year typos (`0206`, `2025` for a 2026 task) are corrected for counting and listed in Sheet health.

### Two columns worth adding to both task sheets

The dashboard picks these up automatically by their header name:

- **`No. of Creatives`**: how many creatives a task asks for. Without it, each row counts as one.

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
tools/inline-data.js   copies assets/data.js into Code.gs (run after changing data.js), so reminders count exactly like the dashboard
assets/logo.svg        the FASTRR mark on a transparent background (notifications)
assets/favicon.svg     browser-tab icon: #111114 bars on light tabs, white on dark tabs
apps-script/appsscript.json  its permissions
```

The page sets a Content Security Policy: scripts only from this site, jsDelivr (d3) and Google sign-in, and data only from the Apps Script web app.

No build step: edit and push to `main`, and GitHub Pages publishes the site.
