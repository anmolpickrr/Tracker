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


**Edits always arrive.** Open dashboards ask every 30 seconds whether a sheet changed. Edits typed in Google Sheets show within about 30 seconds; edits the change trigger never sees (other scripts, forms, imports, the Sheets API) arrive within about 2 minutes, because the dashboard also reloads anything older than 90 seconds every 2 minutes and when you come back to the tab. Every request has a time limit, so a request that hangs (a laptop waking up, a network switch) can no longer stop the updates until a manual refresh. A part of the page that fails to draw says so with a *Reload data* link instead of staying blank, and the cause appears on the Issues page.

**Open dashboards update too.** Each release has a build number (in `index.html` and `version.txt`). Every open dashboard checks `version.txt` every 2 minutes and whenever its tab comes back to the front; when a newer build is out it reloads itself at a safe moment (no task, note or other window open and nothing half-typed; it offers *Reload now* otherwise), through a fresh address so no cached page is served. Everyone therefore runs the same build within minutes, and what each person sees still follows their own permissions, which the web app sends with every 30-second check. When releasing, bump the build number in `index.html`, the asset links and `version.txt` together.
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

**Stand-up (Nov 2026):** the Creative Head has no card in the stand-up for now (switch `SU_HEAD` in `assets/app.js` to show it again).

**Alerts on by default (Nov 2026):** notification sounds (all types), the Studio radio setting, desktop alerts and briefing emails start switched on for everyone; earlier saved choices were switched on once (`v: 2` in `co.snd`, `co.deskv2`). Browsers require a click first, so audio unlocks and the notification permission is requested on the first click. Anyone can still turn each off in the bell panel.

**Vibration (Nov 2026):** each notification or reminder vibrates (`navigator.vibrate`, Android browsers) with a pattern per type, and the bell shakes on every device. On by default; each person turns it off under bell > Sounds & music > *Vibration* (saved with their sound settings). iPhones and computers have no web vibration, so they get the bell shake only.

**Creative link → Under review (Nov 2026):** submitting or replacing a creative link always sets the design status to UNDER REVIEW (the dashboard sends it, and the server adds it when a link arrives without a status). Links changed directly in the sheet are not affected.

**Awards (Nov 2026):** up to two creatives per award (Awards tab, *Link* and *Link 2*), shown on the Hall of Fame card. Editing an award is for the owner (Creative Head) only: the *Edit* button shows only for them and the server refuses others; Admins can still feature and remove.

**Team playlist (Nov 2026):** anyone signed in suggests trending songs (song, artist, language/genre, optional YouTube/Spotify/JioSaavn link) in the *Music* tab of the access sheet; likes are stored in *Cheers* as `mu:<id>`. Up to 10 suggestions a day per person; duplicates are refused; the suggester or an Admin can remove one. Open it from the Hall of Fame pop-up (♫) or bell > Sounds & music. Endpoints: `music`, `musicAdd`, `musicDel`.

## My work (team members)

Everyone lands on **My work** showing their own work (the owner lands on the Overview). My work shows **only the signed-in person's own tasks**: there is no *View as* and no page filters (Admins see anyone's work on Tasks or Team; clicking a person on Team opens Tasks filtered to them). A **This week / This month** switch sets the period, and six status tiles count the tasks in it: **Assigned** (everything), **TBP**, **WIP** (incl. changes requested), **Under review**, **Shared** (incl. no update) and **Rejected**. Clicking a tile lists those tasks below, **grouped by Design ETA date** (today and tomorrow labelled); open work from before the period is under *Earlier, still open* and tasks without an ETA under *No Design ETA*, both first. Content writers also see **Content tasks**. The person is matched by their Google name against the team list; if a name is spelt differently, add it under *Also written as* in the team sheet. On phones My work replaces Stand-up in the bottom bar for team members.

## Brands and Waiting on client

**Brands** lists every brand with open work, work with a client or deliveries this month or last: open, late, with the client (and the oldest wait), delivered this month against the same working days last month, and the last delivery. Search, sort any column (click or Enter on the header) and click a brand for its tasks.

**Waiting on client** (at the top of the Brands page, and where the Overview's *Shared with clients* number leads) lists every piece of work that cannot move until a client replies: **creatives shared for approval** (Shared, and No update = no reply after follow-ups) and **briefs shared with the client for sign-off** (design not started, content Shared). Days waiting count from the design ETA; a brief without an ETA counts from its request date.

- **Summary:** items waiting (creatives, briefs and brands), the typical (median) and longest wait, how many have waited over 14 days, how many got no reply after follow-ups, and briefs with the client. Over 14 days, No reply and Briefs are clickable filters.
- **Age bar:** one bar split into up to 7 days (lime), 8–14 (violet), 15–30 (orange) and over 30 (ink). Each band below it shows its count and share and filters the list.
- **Toolbar:** All / Creatives / No reply / Briefs, a search (brand, creative, ID or designer), and sorting: longest wait, most waiting, or brand A–Z. The dashboard filters at the top (Internal / External, designer, brand, type) apply too. "Showing x of y" names an active filter, with *Show everything*.
- **Brands table:** one row per brand with its sheet (External / Internal), how many creatives and briefs are waiting (and how many got no reply), a strip with one square per item coloured by its age (circles are briefs), and the oldest wait. Expand a brand to see each item: title, ID, type and quantity, designer, status (Shared, No reply, Brief with client), the date it has waited since, days waiting and its creative or brief link. Click an item to open the task.
- **Copy follow-up:** copies a ready-to-send reminder for that brand ("Hi … team, a quick reminder…") listing every pending item with its date and link, to paste into WhatsApp, Slack or email.
- **Download CSV** has every waiting item with its status, dates, days waiting and link.

## What team members see

Hints and summaries about other people (who is free, what someone is working on, team-wide overdue counts) are for Admins and the owner only. Team members' Fasty tips are about their own work, Stand-up shows them no "free to take work" count or "Free to take new tasks" remarks, and the bell's team-wide alerts go to Admins.

## Stand-up cards

Every open task assigned to a person is on their card and in its count: the number on the right is all their open work (ready and waiting on content), and the chips under the name break it down: overdue and due today (when), then TBP, WIP, Changes, other and content pending (which add up to that number), plus pending approval for work with reviewers. Nothing is hidden by status and no filter is needed. Every task assigned for the day is on the person's card, including work still with the content team (content Pending, TBP, WIP or Changes): those rows show the content status as the card's usual status chip (*Content pending*, *Content in progress*…), so the row reads like every other task but nobody picks it up too early, so everyone sees what is theirs today, what is ready to pick up and what is waiting on content. Overdue and due-today work comes first; work waiting on content that is not due yet has its own list. Content writers' cards list every open content task with the same status chips (Pending, In progress, Changes, Ready to script…) and the usual late/today date colours, due work first. Each card keeps a fixed height and scrolls inside, so a long list never stretches the page.

**Filters stay yours.** Clicking a task opens it; links such as a person's name on Team or a chart bar open Tasks with a one-off *Showing …'s tasks* chip (× clears it, and it disappears when you leave Tasks). The filters at the top (Internal/External, designer, brand, type) only change when you pick them.

## Day plan (Stand-up › Day plan)

At 10:00 IST the web app saves each person's tasks for the day in the *Day plans* tab: their open tasks due today or overdue, and anything in WIP or Changes requested. Tasks that come into scope later are added and marked **New**. Each 10-minute check records every planned task's current status, so a past day keeps its end-of-day status.

Stand-up › **Day plan** shows:
- **The day at a glance**: delivered so far out of the plan with a progress meter, and five steps (All tasks, Not started, In progress, In review, Delivered) that also filter the lanes below. Under them, the points to raise at stand-up: tasks past the ETA, tasks waiting on changes, people who haven't picked anything up, tasks picked up since the morning, tasks added during the day.
- **One lane per person**: name, role, delivered out of planned and a bar by phase, then their tasks as equal-size cards (four per row on a laptop; a swipeable row on phones). Each card shows the brand, creative ID, creative type, how late it is, the first four words of the topic, the exact status and Internal or External. Click a card to edit the task. Work in progress comes first; people with the most still to do come first.

A task whose ETA is moved to a later day (in the sheet or from the dashboard) is marked *Moved to <date>*, no longer counts in the day, and can be listed with the *moved to another day* flag; a task whose ETA moves to today joins the day at once. Today's statuses are live; pick a past day from the list. Before 10:00 a preview from the live sheets is shown. Everyone sees their own day; the owner, Admins and people allowed to see others' work see everyone's.

**Matching people to the team list.** Someone given access is linked to their team-list entry by, in order: their email written under "Also written as"; their Google name or a listed spelling; the name in their email address (aman@pickrr.com → Aman, abhist.dixit@… → Abhist); a first name that fits exactly one person. So people added by email, or whose Google name differs from the sheet, still see their own work, and they are shown everywhere by their team-list name (aman@pickrr.com is "Aman"), never as a second person. If two people share a first name, add the email under "Also written as".

## Changing access at any time (Access)

**People with access** lists everyone in one row each: photo, name and email; access level (changed right there); how many sections they can open with a bar and what they can edit; whether they have access and when they last signed in; and *Permissions*, *Activity* and *Revoke* (on smaller screens these become icons). Filter by level with the chips at the top (each shows a count) or search by name or email; people without access are grouped at the bottom. *Add a person* sits above the list in one line: email, level, sections, *Give access*. *How access levels work* explains View only, Can edit and Admin. On a phone each person stacks into a compact card.

Click a person on the Access page to open their window. **Left:** who they are (sign-ins, who approved them), access level and *Revoke access*, and their recent activity (with a link to the full log). **Right:** *What they can see and do*, with a one-line summary on top and three tabs: **Sections** (Hidden, View or Edit for each section, plus Brand packages and Pricing), **Tasks** (which tasks they see, and the task fields they can edit: status, Design ETA, delivery date, designer, requirement details) and **Abilities** (reading briefs, submitting links, workload, downloads, Fasty). *Save changes* stays at the bottom, so nothing needs scrolling to find; unsaved changes survive the 30-second refresh, Undo and Reset to the role's defaults sit beside it, and every change is logged and applies within 30 seconds without signing them out. On a phone the two panes stack.

## Notes

A clean, editorial space for everyone (designers, editors, writers): neutral greys with lime, black and blue, bold sans-serif type, bento-style tiles, geometric icon stickers and status labels; motion stops for people who turn on "reduce motion".

- **Write**: the first line is the title. Type **@** to tag someone (shares the note with them), **#word** for tags, wrap text in `==…==` (Ctrl/Cmd+Shift+H) to highlight it, `**…**` (Ctrl/Cmd+B) for bold. Ctrl/Cmd+Enter saves.
- **Colours**: 8 note colours (white, lime, sage, stone, blue, orange, graphite, ink), with a night-theme version of each.
- **Stickers and tags**: the sticker tray is grouped. **Priority**: P0 (red, flame, pulses), P1 (orange), P2 (lime), P3 (grey). **Category**: Internal (violet), External (blue), VAS Group (black and lime), Client (cream). **Status**: Urgent (pulses), Important (nudges), New (shines), TBD (dashed), In review, On hold, Blocked, Approved, Done, Draft. **Fun**: the original icon stickers. Tags share one pill shape (icon, bold label, outline) so they read at a glance in light and dark; up to 4 per note; motion stops for people who turn on reduce motion.
- **Sketches**: a drawing pad with 6 pens, a highlighter, 3 sizes and undo; saved as smooth vector paths.
- **Files**: paste (Ctrl/Cmd+V), drag and drop, or attach images (PNG, JPEG, SVG, GIF, WebP), PDFs, Word, Excel, PowerPoint, text, CSV, ZIP, short videos and audio, up to 10 MB each and 12 per note. Big photos are resized before upload. Images show as thumbnails; images, PDFs, video, audio and text open in a preview; everything can be downloaded. A file can only be opened by people who can see its note.
- **Layout**: one row of view tabs with counts (All, Mine, Shared with me, Assigned to me, Reminders, Team notes for Admins) and search; below it a tool row: how many notes are shown, **Filters** (a panel: colour, pinned, with files, with sketches, author, edited, tags; active filters show as removable chips), sort and Trash. The editor is a single line until you start writing; **Discard** throws away a draft. Cards show the title (up to 3 lines), the first 5 lines of the note, the first 2 people or to-dos (+N more), and who wrote it, when, the reminder and who can see it; everything stays inside the card, long links wrap.
- **Open a note**: click any note to open it in a pop-up over the page (the page stays visible, blurred, behind it): the full text, files, sketch, tags and every to-do (tick them there). The author can **Pin to top** and **Edit** in the same pop-up; saving returns to reading it. Close with ×, Esc, or a click outside it (outside clicks are ignored while editing, so nothing typed is lost). Notes from the bell open the same way.
- **Find**: the view tabs, search across text, #tags, people and file names, and filters for colour, tag, pinned, with files, with doodles, author and date, plus sort. Pin notes to keep them on top.
- **Safe**: notes are saved in the team's private access spreadsheet (files in a hidden *Note files* tab, split into pieces, so no extra Google permissions are needed). What you are writing is kept as a draft in your browser until it is saved, so a refresh or a failed save loses nothing. Deleting moves a note to **Trash**, where you can restore it for 30 days. A copy of the whole Notes tab is made every day in a hidden *Notes backup* tab. Edits by two people at once never overwrite each other.

Design and motion references are kept in `docs/design-references.md`.

## Inactive people

Anyone marked Inactive in the team list is never shown by name, to anyone: everywhere (tables, filters, reports, CSV downloads, stand-up, notes, Fasty, emails, the activity log, the Content Owner column) they appear as **"M – Inactive User"** (their initial; a number is added if two share one). Their past work still counts under that label. Admins can still set them active again on the Team page; the team sheet itself keeps the real name.

## How numbers are counted

Everywhere on the dashboard: each **Creative ID is one creative** (the No. of Creatives column is not multiplied in). **Completed / delivered = DONE only**; Rejected, Shared, No update and Under review are counted separately, never as completed. A completed creative counts on its **completion date**, its Design ETA (or today, if the ETA is still ahead). Reports cover whatever period you pick (a day, week, month, quarter, year or a custom range) and every filter at the top applies. A creative done by two designers counts for each of them in the Designer table (a note says how many), while the total counts it once.

## Brand packages (Brands)

What brands buy, kept in the *Packages* tab. Three **package types**:

- **Fixed package**: a set number of creatives per type, bought once (for example 20 Static and 5 Videos).
- **Monthly plan**: creatives per type every month, billed every month from the start date, with an optional end date. Each billing month is counted on its own: creatives delivered beyond a month's quantity count toward the next month (shown as *carried in* / *→ next month*), while unused creatives do not carry over; the order shows this month's progress, the next bill date, what has been billed so far and a month-by-month list.
- **Custom package**: either a number of creatives (per type, or *Any type*), or an **amount** spent at a rate per creative type (for example ₹10,000 at ₹1,000 a Static and ₹3,000 a Video).

**Delivered** = completed (DONE) creatives of that brand from the purchase date (for a monthly plan, within each billing month), counted per creative type: monthly plans first, then fixed and custom packages, oldest first. **Still due** and **extra** are worked out per type and highlighted: with 20 Static and 5 Videos bought and 19 Static and 6 Videos delivered, the order shows *1 Static still due* and *1 Video extra* (in orange, on the row, the type and the *Extra delivered* summary, which lists the orders with extra when clicked). A creative type the package does not include is shown as *not in this package* and counted as extra.

Built to stay quick with thousands of orders:

- **Summary**: orders, repeat clients, creatives delivered of bought, still due, extra delivered, value (with the monthly total from running plans).
- **Brands that need a new order**: brands whose open requests go beyond what they have bought, with *Add 2nd/3rd… order* and *History*.
- **Search** by brand, order ID or notes; **filters** for package type, status (running, requests beyond package, extra delivered, complete or ended, closed), sheet and purchase date; **sort**; removable filter chips; **20, 50 or 100 per page**.
- **Orders / Brands** views; clicking a brand shows its orders.
- **Order numbers**: *1st order, 2nd order…* per brand by purchase date, worked out every time.
- **Order details**: creatives per type (delivered, due, extra), billing, notes, who added it, the brand's order history, *Edit order* and *Add next order*.
- **Repeat orders**: adding an order for a brand that already has one asks *"An order already exists for this brand. Is this a new order?"*, lists its latest orders with *Update this order*, flags a possible duplicate, and saves only after *Yes, it's a new order*. The web app checks this too.

Every order also shows a breakdown of **Final delivered** (DONE), **Shared** (awaiting client approval, including no update) and **Rejected by client**. A package can be closed to stop counting. Only the owner sees packages by default; on the Access page the owner or an Admin gives anyone *View* or *Edit*. Every change is in the activity log.

**Budget packages.** A monthly plan or a custom package can be *by budget* instead of by number of creatives (e.g. ₹50,000 a month, excluding GST). Every delivered creative is charged at its price from **Access › Pricing** (or a special rate set on that package), so any mix of types works: more videos simply use more of the budget. The order shows the budget, what was spent, the balance and roughly how many more of each type the balance covers. If a month's deliveries cost more than the budget, the extra amount and creatives are highlighted and carried into the next month (shown as *carried in*), reducing that month's balance. A delivered creative whose type has no price yet is flagged *Set a price* and not counted until it has one.

**GST.** All prices and package amounts are entered **excluding GST**. GST (18% unless an Admin changes it) is worked out separately and shown as Base, GST and Total incl. GST; balances and carry-forward always use the base amounts, never GST-inclusive ones.

## Pricing (Access › Pricing)

One price per creative type (as written in the sheets' Creative Type column), in ₹ excluding GST, plus the GST rate. For tiers, use distinct types in the sheet (e.g. "AI Video - 30s" and "AI Video - 60s"), each with its own price. Types used in the sheets without a price are listed so nothing is missed. Saving recalculates every package at once; each change is in the activity log. Admins have access by default; the owner or an Admin can give **Pricing: Manage** to anyone on the Access page (they then see Pricing on the Brands page).

## Working on a task without opening the sheet (task panel)

**Layout (Nov 2026).** The task window has four parts: the header (brand, type, topic, and status, due date and designer as small facts); the **Brief** (collapsible, with *Open in Google Docs*); **Links**; and **Manage task**. *Links* lists the **Creative link**, **Open File** and **Content** as one row each, with a count such as "1 of 3 added". A link that is missing is highlighted, with its input already open. A link that is already there is a quiet row showing what it is (Google Doc, Drive folder, Figma…) and its address, with **Open** and **Replace**; Replace opens the input, and Cancel puts it back.

**Briefs with a tab per task.** When one brief Doc has a tab for each task (for example tabs titled "SRAP460 - 1st UGC", "SRAP591 : 4th ugc"), the task window shows the tab whose title contains that task's ID (SRAP59 never matches SRAP591), and *Open in Google Docs* opens that tab. If no tab is titled with the ID, the tab named in the sheet's link (a link ending in ?tab=…) is shown, then the first tab, with a note saying so. Finding the tab by its title uses the Google Docs API; if it is switched off for the web app's Google Cloud project, the Issues page shows one item with the link to turn it on (it closes itself once on).

**Links behind labels.** Many link cells show a label ("Meta - Polo (SRAP23)", a Drive file chip, or =HYPERLINK("…","label")) with the address behind it. For the Creative Link, Open File and Creative Brief columns the dashboard reads that address, so those links count as added everywhere and open with one click. A cell that holds only text (no link behind it) says so in the task window, with its text.

**Assigning.** The Designer (or Editor, for video work) field is a picker: search by name or role, people from the team list with their role, then anyone else named in the sheets, and *Unassigned*. Admins also see how many open tasks each person has ("Free", "3 open"). Arrow keys and Enter work.

**Saving is instant.** *Save to sheet*, *Submit*, *Save* and *Replace* close the window at once and the change shows everywhere straight away, with a short "Saving to the sheet…" note and a soft pulse on the task. "Saved" follows once the sheet confirms (it now reads each task's row in one go instead of cell by cell). If it fails, the task goes back to how it was and the note says why, with **Retry** (or **Reopen** when someone changed the same cell in the sheet meanwhile); failures are also kept on the Issues page. A refresh that arrives while a save is in flight keeps showing the new values. Saving is reliable: a busy sheet, a slow answer or a network blip is retried automatically (twice) with "Google Sheets is busy, still saving…"; a retry after a slow first answer is safe, because the web app treats a value already in the sheet as saved. Only the fields you changed are sent (a task still waiting on its brief is TBP in Design Status, so assigning it never sends a status change). A real change made in the sheet meanwhile is still caught and offered as *Reopen*.

**Who can change what.** Status, Design ETA / delivery date, designer, priority and number of creatives are for Admins and for the people you give each of those permissions on the Access page; everyone else sees them as read-only facts, and the web app refuses them too (Fasty included). Submitting links follows the *Links* permission (team members submit their own work).

**Calendar.** Every date field (task ETA, Reports' From and To, brand packages, custom ranges) opens the dashboard's own calendar from its calendar button or a click on the field; typing a date still works. Monday comes first, today is marked in violet, the chosen day is filled, weekends are muted, and days outside the allowed range are crossed out. Click the month to jump between months and years. Reports shade the From–To range. *Today* and *Clear* sit at the bottom. Keyboard: arrows move by day or week, Page Up/Down by month, Enter picks, Esc closes.


Click any task to open its panel. At the top: where the task is, its title and a row of facts (status, due date and whether it is late, designer, priority, and its links). Then two steps:

1. **Read the brief.** The Google Doc in the task's **Creative Brief** cell shows inside the panel (title, text, lists, tables and images; scripts and outside content are removed). *Open in Google Docs* opens the original. The web app reads the Doc as its own Google account through the built-in Drive service and the Docs export link, so no Google Cloud API needs switching on; the Doc must be readable by that account (share it as Viewer, or keep briefs in a shared drive it can see), otherwise the panel says so and the link still works. A brief typed straight into the cell shows as text; other links open in a new tab.
2. **Submit the creative link.** Paste the finished creative's link (https://…) and click *Submit link* (or *Update link*). It is written to the **Creative Link** column and, for open work, the task moves to **Under review** in the same step, for the Creative Head to review. Team members need nothing else: they do not change the status, ETA, designer or priority by hand.

**Links by role (written straight to the sheet).** Each person sees the steps that are theirs:

- **Designers and editors**: *Submit the creative link* (Creative Link column; open work moves to **Under review**) and **Open File**: the original, editable file or its folder (Open File column), so source files are always one click away. If a sheet has no Open File column yet, the first save adds one at the end of its header row.
- **Content writers** (Jahanvi, Gul, Anmol, and anyone named in the task's **Content Owner** cell): *Submit the content*: the script or content doc goes to the **Creative Brief** column (so the designer reads it in the panel) and the **Content Status** is set to **Done** or **Shared**, whichever they pick. The sheet's own spelling is used (its dropdown first).
- Admins see every step. The web app checks each link (full https:// address), that the task is the person's own (the Content Owner for the content step), and that the sheet has not changed since the panel opened.

To find a task: My work lists everything assigned to you; on Tasks, search by ID, brand or creative and click the row.

**Task fields, one switch each (Access › a person › Task fields they can edit).** Admins and the owner have all of them; everyone else starts with none and the owner or an Admin switches on exactly what a person needs:

| Switch | Lets them change | In the sheet |
|---|---|---|
| Task status | the design status by hand | Design Status (Paid: the second Design ETA column) |
| Design ETA | the date of open work (quick buttons too) | Design ETA |
| Delivery date | the date of completed work (Delivered, Rejected) | Design ETA (the sheets have no separate delivery column; the dashboard counts a completed creative on this date) |
| Designer | who the task is assigned to | Creator / Designer |
| Brand requirement details | priority and number of creatives | Priority, No. of Creatives |

The task panel shows **Manage task** when a person has at least one of these, with every other field locked. The web app checks each field again before writing (a completed task's date needs *Delivery date*, an open one's *Design ETA*), so the rules hold wherever a change comes from: the task panel, Fasty, or a retry on the Issues page. Changes reach the sheet at once, appear on everyone's dashboard within 30 seconds, and are in the activity log; a switch changed on the Access page applies to that person within 30 seconds, without signing them out, and nobody else's access changes.

**No overwriting.** The panel remembers the status, link and ETA it showed when it opened. If the sheet changed since (someone edited the row in Google Sheets), the save is refused with *Someone changed … in the sheet to "…"*; the dashboard reloads the row so you can decide again. Every saved change is in the activity log with before and after.

## Errors & issues (Admins)

**Layout (Nov 2026, v2).** Three groups, by what to do: **Needs your action** (changes that did not reach the sheet: Retry, or *Retry all* for every failed save at once), **Fix in the sheets or settings** (duplicate IDs, packages, Google settings; each says what to change and has its fix button) and **Fixing itself** (temporary errors, folded away while something else needs attention; *Resolve all*). The counts at the top are also filters, beside how many were resolved in the last 7 days. Each issue is one row: a plain headline naming the task ("SRA2338 didn't save", with its brand and creative), what it tried to save as chips ("Status → Under review"), who and when, and its actions on the right. Click a row for the explanation, exactly what Retry will save, and the technical details. A failed save also shows **Why** in plain words (protected column, dropdown refused the value, sheets busy, took too long, task not found), mapped from the error text. A successful save of the same task closes its issue whoever reported it, and when an Admin opens Issues, any failed save whose values are already in the sheet is resolved automatically. Issues that need a Google Cloud setting (the Docs API) get a *Turn on in Google Cloud* button; the Docs API reminder is logged at most every 6 hours.

**Layout (Nov 2026).** A summary line first: how many issues need attention, split by who they affect (**Affects people**: someone could not do what they tried; **Data**: the sheets need a fix; **System**: background or temporary), and how many were resolved this week. Below: Active / Resolved / All, a search and *Check now*, then area chips with counts (click to filter). Each issue says **what it means** and **what to do** in plain words, with its area, when it was last seen, how often and who it happened to, and its actions (Retry, the fix button, Mark resolved) on the same line. The raw error is under *Technical details*. *How this works* explains the cycle: found, shown, fixed, closed.

The **Issues** page (Admin menu, with a count of open issues; the bell also shows it; Admins by default, and anyone you give it on the Access page: **View** to see issues, **Edit** to also retry, fix and resolve them) lists everything that went wrong, found automatically. At the top: how many issues need attention (pulsing while any are active), how many were resolved in the last 7 days, and which areas are affected (click an area to filter), with the four steps every issue goes through: detected, shown, fixed, closed. Each issue is a card with its area's colour and icon. Each issue shows the **area**, **what went wrong** (expand *What went wrong*), when it was first and last seen, how many times, who it happened to, and whether it is **Active** or **Resolved** (and by whom).

| Area | Found by | Closes by itself when |
|---|---|---|
| Actions: a save from the task panel failed (not a refusal for permissions) | the person's dashboard, at once | the same task is saved successfully |
| Sync: a sheet or tab could not be read | the web app, every 10 minutes | the sheet can be read again |
| Sync: someone's dashboard could not load tasks | that dashboard | it loads again |
| Data: duplicate task IDs, rows without an ID | the web app, every 10 minutes | the IDs are fixed in the sheet |
| Packages: deliveries a running package does not count, creative types without a price | an Admin's dashboard when Brands is open | fixed |
| Connection: someone's dashboard could not reach the web app for 2+ minutes | that dashboard, when it is back | recorded as resolved (for the record) |
| Screen: an error in the dashboard page | that dashboard | an Admin marks it resolved |
| Background jobs, Stand-up: the 10-minute maintenance or the day plan failed | the web app | the next run succeeds |
| Web app: automatic updates need the owner | the web app, every 10 minutes | updates work again |
| Server, Creative brief: a request failed on the server, a brief cell could not be read | the web app | an Admin marks it resolved (after checking) |

**Temporary Google errors are not issues.** Google's own services sometimes answer "busy" or "unavailable" for a few seconds (HTTP 429/500/502/503/504, timeouts). The web app retries those straight away (after 2 and 6 seconds); a sheet that cannot be read counts only when it fails two checks in a row, background jobs after three, and automatic updates only when Google has not answered for about an hour (they simply try again every 10 minutes). Each closes by itself when the next attempt works.

**What to do with an issue:** *Retry* (failed saves) shows exactly what it will write (for example *SRA2353: status → WIP*), writes it and resolves the issue. *Reload from the sheets*, *Open Data health*, *Open Brands* and *Open Pricing* take you to the fix. *Mark resolved* closes it by hand; *Reopen* and *Remove* are on resolved issues. Filters: Open / Resolved / All, area and search. The page refreshes every minute; the same problem is counted again instead of listed twice. A retry only ever carries the fields the person who hit the problem was allowed to change. Issues are kept in a hidden *Issues* tab of the access spreadsheet.

## Who can change a note

Everyone can write notes. A note is **personal** until you tag someone with @ or assign it; those people then see it too (Everyone can see shares it with the whole team). The **author** can change and delete it. **Anyone it is assigned to** can edit it too: text, checklist, reminder, colour and files, and tag more people; who can see it and who it is assigned to stay as the author set them, and only the author (or the owner) deletes it. The web app checks all of this on every save.

## What's new

The sparkle icon at the top right (for everyone, whatever their role) opens **What's new**: every update, newest first, with **what's new**, **what it does**, **how to use it** and **what changed**, an *Open* button to the feature, filters (Everything, New, Improved, Fixed) and arrow keys to move between updates. Everyone sees every update; one about a part someone cannot open says who it is for. It is not in the menu. When something is new, the icon glows and a small note pops out of it with the newest update's name and *See what's new*; it never takes focus or covers the page, closes on ×, on opening, or by itself after a few seconds, and the icon keeps its dot until the updates are read.

**Every release adds an entry** to `assets/whatsnew.js` (id, date, kind, who, title, and the four explanations), written in plain words for the people using the dashboard.

## Loading and syncing

The page shows the last data it had at once, then refreshes in the background. A load that fails retries by itself (after 4, 8, 16 and 32 seconds, then every minute) and says so; a refresh that fails while data is on screen is retried on the next 30-second check, so a manual reload is never needed. On the web app, data requests only read the sheets' text: the links behind labels are prepared by the 10-minute job, and after a save all open dashboards share one fresh copy instead of each reading the sheets.

## Design language (every section, every change)

One product, not features added over time. Every new section, control or change follows these rules (the Overview is the reference):

- **Colours:** violet (primary actions, selection, "this is applied"), lime #ddff00 (one bright highlight: today, counts on a selected tab, success moments), orange (needs attention soon), red (late or broken, sparingly), ink and warm greys (text, surfaces, structure). No gradients, no glass, no decorative colour. Light and dark mode are designed together; every colour is a theme token.
- **Shapes and spacing:** cards with large rounded corners, pill buttons, chips and inputs, quiet sunken panels for secondary groups, an 8-pixel spacing rhythm, no empty space left by layout.
- **Hierarchy:** one clear summary first (the number that matters, said in words), then filters, then the detail. What needs action is highlighted; what is fine stays quiet. Existing things (links, values) are shown plainly with an option to change them; missing things are the ones that stand out.
- **Filters:** the page filters (Sheet, Designer, Brand, Type) apply to the data pages that use them and are hidden where they do not (My work has none; Notes, Issues and Access have none). Anything applied is violet-filled and listed under **Filtering by** with one-click removal and Clear all; a page's own filters (status, members shown, search) are highlighted the same way when they are not on their default.
- **Feedback:** every action answers at once (saves show immediately, with Saving… then Saved, or a plain reason and Retry). Errors say what happened and what to do, in plain words; technical text stays one click away.
- **Permissions:** people only see the controls they may use; the web app checks every write again.
- **Contrast (both themes):** body text and labels at least 4.5:1 against what is behind them, large text and icons at least 3:1, placeholders 4.5:1. Counts inside a selected (violet) tab or chip are lime with ink text; alert badges are ink on orange; orange is a fill, never small text (warnings use the deeper orange). Faded states use the muted colour, not transparency. Dark note colours (Ink) give their buttons and chips dark surfaces, so nothing turns light-on-white. Every change is checked with an automated contrast scan of every section, pop-up and hover state in light and dark.
- **Quality floor:** works on phones (no sideways scrolling), keyboard and screen-reader friendly, reduced motion respected, tested in both themes.

## Rescheduling and reassigning (Admins only)

Changing a task's **ETA** or **who it is assigned to** is for Admins (and the owner) only, from any screen; the web app refuses it for everyone else, and the task editor shows those fields locked with a note. Team members finish a task by submitting its creative link, which moves it to Under review; changing the status by hand is for Admins and anyone the owner gives *Change design status*. In the editor, Admins have quick buttons: *Today*, *Tomorrow*, *Next working day* (Monday to Friday) and *+1 week*. A rescheduled or reassigned task moves at once: it leaves the day it was planned for (*Moved to 16 Nov*, or *Now with Yashika*), joins the new person's list, and shows in the Day plan's *Coming up* preview for its new day. The sheets themselves are shared in Google Sheets, so who can edit the ETA and designer columns there is set with the sheet's own sharing and protected ranges.

## Content tasks (briefs, scripts, content)

Counted separately from design and editing, never mixed with creatives. A content task belongs to everyone named in its **Content Owner** cell (shared cells such as "Anmol, Jahanvi" count for each). **Content Status** decides where it is: **open** (in the writer's bucket) = UNDER REVIEW, WIP, CHANGES, INCOMPLETE BRIEF, TBP; **with the client** = SHARED; **completed** = DONE, dated by the Design ETA (else the request date, never later than today); **on hold** = HOLD. Dropped (Deprioritised) tasks are not open content work.

Content writers: Jahanvi and Gul (content only: they appear under Content tasks, not in design counts or workload unless they hold open design work), anyone with the *Content Writer* role, and the Creative Head (Anmol), whose own design work also shows in Stand-up, Team and workload. Shown in Stand-up (a Content tasks block per writer, plus the total open), Team › Content tasks (open, by status, with client, on hold, completed this and last month) and My work.

## Access levels and sections

- Everyone except **Admins** and the owner sees and manages **only their own tasks** by default (tasks assigned to them by their name on the team list, or whose brief they own); this includes **Can edit** since November 2026, when existing Can edit users were switched to their own tasks. Admins and the owner see everyone's work, brands and workload. The owner or an Admin can give anyone access to others' tasks (*Tasks they can see → All tasks*).
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
| TBP or blank, content UNDER REVIEW / INCOMPLETE BRIEF / TBP / WIP / SHARED / CHANGES | Awaiting brief (says which: brief under review, incomplete brief, ready for scripting, brief in progress, brief with client, brief changes requested) | The brief isn't approved, so not design workload and never overdue. The Content Owner's work |
| HOLD, or design not started and content HOLD | Hold | Parked, never overdue |
| DEPRIORITIZED | Deprioritised | No longer required |
| anything else | shown as typed, flagged in Data health | Open |

Content Status names match the sheets: **Under review** (was Pending, both sheets) and **TBP** (Internal's TBD is now TBP). Rows that still say Pending or TBD, such as older tabs, are read as the new names.

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

## Studio (Nov 2026)

The team's creative corner, controlled per person on the Access page (section **Studio**; on for everyone until the owner turns it off).

- **Characters.** Everyone builds a clay-toy character in the browser (`assets/chars.js`: layered SVG, original artwork). Parts: skin, eyes, mouth, brows, beard/freckles, 12 hairstyles and colours, 7 outfits and colours, glasses, headwear, background, and up to 3 tools of the trade (role-aware suggestions: video editors get headphones and a clapperboard first, designers a tablet and sketchbook, writers a book and coffee). *Surprise me* makes a random one. The character is the person's avatar everywhere (`CO.av`), and initials stay until they make one. Open the builder by clicking your name at the bottom of the sidebar, or from Studio.
- **From a photo.** The builder's *From a photo* tab sends a downsized photo (768 px) to Google Gemini's image model (`gemini-2.5-flash-image`, with fallbacks) using the `GEMINI_API_KEY` in Script properties (the one Fasty uses). It asks for a clay-toy version that keeps the person recognisable, wearing the outfit, colours and gear they picked. The photo is not stored; the result is shrunk to 384 px WebP and kept only when saved (hidden *Character images* tab, in pieces). Limit: 8 a day per person.
- **Hall of Fame.** A clay retro TV (cream in Light mode, charcoal in Dark) flips through spotlights every 7 seconds, and its knobs switch channel. It shows active awards first, then **last week's stars** worked out from the sheets for the last full Monday–Sunday: Top shipper (creatives), Video star, Design machine (statics), Every-day shipper (3+ days), Many-brand hero (3+ brands). Sticky notes give the week in numbers. Below it: **Last week's podium** (top 3 by creatives), the **Awards** wall (swatch cards; Admins give, edit and remove awards with a person, a preset tag or a custom name, a reason, an optional creative link, and how long it shows: 1 week, 1 month or until removed), **The crew** (everyone's character, role, tagline, this week's count and badges) and **Fresh off the press** (a reel of the last 7 days' deliveries, paused on hover).
- **Cheers.** Anyone with Studio can cheer an award or a star (toggle), with counts kept in the *Cheers* tab.
- **Overview strip.** A compact TV with this week's spotlights and *Open Studio*.
- **Storage** (access book): *Profiles* (email, team name, character JSON, image id, tagline), *Character images*, *Awards*, *Cheers*. Only your own profile can be saved, under your own team name. Awards are Admin-only, enforced on the server.

## Sounds, mentions and announcements (Nov 2026)

- **Ask first.** `assets/sound.js` makes every sound live with the Web Audio API (no audio files, nothing to license). Sounds and music are off until the person answers a small "Turn on sounds?" card, shown once about 12 seconds after sign-in (never over an open window) or when they press play on the radio. The choice is saved per person (Profiles tab, Prefs column) and follows them to every device. They can change it any time under bell > *Sounds & music*: on/off, volume, each kind on/off with a Play preview, and the radio.
- **Kinds.** Reminders (soft two-note bell), mentions (bright pluck), task updates (gentle pop), achievements (rising sparkle) and announcements (warm chord). New notifications that arrive while the dashboard is open play the sound of the most important kind (at most one per second), ring the bell and slide in a card (Open, or dismiss; it stays while hovered). What was already there when the page opened stays quiet. In the bell, each row has a colour stripe for its kind, and new ones are highlighted.
- **Mentions and announcements.** Bell > *Mention* (or the @ on any notification, or *Share with a teammate* in What's new) opens a composer: tag people with access, write a note, and optionally link what it is about (opening it goes there). Admins can tick *Send to everyone as an announcement*. Awards arrive for everyone as achievements. Stored in the hidden *Notify* tab of the access book; each person sees the last 30 days.
- **Studio radio.** A lo-fi instrumental (82 bpm, Fmaj7–Em7–Dm7–Cmaj7, soft keys, bass, brushed drums, vinyl crackle, random melody), with play/pause, mute and volume. It plays only on Studio and pauses when you leave the page or the tab.

## 3D characters (Nov 2026)

- **Engine.** `assets/char3d.js` (an ES module, loaded only when Studio or the builder opens) builds every figure from rounded shapes with three.js 0.160 (MIT) from jsdelivr. Everything is original and procedural: no models, textures or licensed assets. The joints are hips, spine, chest, neck, head, shoulders, elbows, hands with four fingers and a thumb, thighs, knees and feet.
- **Looks.** Clay (matte), Vinyl toy (clear-coat), Plush (sheen), Toon (cel shading with outlines), Blocky (rounded boxes) and Bean (round body), inspired by 2000–2020 cartoons and toys, none copied. Every face, hair, outfit and gear option works in every look. Added: trousers, shoes, cartoon gloves and big (anime-style) eyes.
- **Moves** (`MOVES`, 19 of them, procedural and smoothed): Chill, Wave, Peace sign, Thumbs up, Heart hands, Clap-along, Dab, Floss, Robot, Disco point, Bhangra, Shoulder shimmy, Running man, Moonwalk, Horse ride, Fast feet, Fist pump, Victory jump and Spin. Each person picks a signature move. Figures blink, breathe and look around. Reduced-motion settings keep them still.
- **Gear around the figure.** Up to 4 tools float in fixed slots beside the person: laptop, tablet and stylus, camera, clapperboard, mic, mug, sketchbook, book stack, typewriter, notebook, colour palette, film reel, plant. Earphones, a pencil on the ear and a backpack are worn. Suggestions follow the role: writers get a typewriter, book and notebook; designers a tablet, palette and sketchbook; editors a clapperboard, camera and headphones.
- **Celebrations.** An award adds a pulsing ring in the award's colour, a light beam, a trophy and confetti. Best Performer also gets a crown. A weekly star gets the lime version.
- **Studio.** The Hall of Fame is a 3D desk: a retro computer whose screen shows the spotlight (name, award, reason), clickable knobs, a keyboard, a mug with eyes (click it), and the spotlight person doing their move (click them for another). The camera follows the pointer slightly. On desktop, the crew are live figures drawn on one shared canvas (one WebGL context for everyone, clipped under the top bar); hover plays their signature move. Phones, low-power devices and reduced motion get pictures instead.
- **Avatars.** Saving renders a 256 px head-and-shoulders picture, stored like photo characters (Profiles, *Snapshot* column), so avatars show everywhere without loading 3D.
- **Fallback.** Without WebGL, or with software rendering (no graphics chip), Studio and the builder use the 2D SVG characters (`assets/chars.js`), and everything else works the same.

## Hall of Fame widget (Nov 2026)

Studio is no longer a menu section or an Overview strip, and it is no longer an Access setting. It is automatic for everyone signed in, as a small widget just left of the clock (`data-draw="hof"`, in `assets/studio.js`):
- **What it shows.** A tiny character with no box or background, plus one line with the award (with a colour dot) and the name. It shows active awards first, then last week's stars, rotating every 6.5 seconds (paused while hovered, while its details are open, or with reduced motion). Scrolling over it flips through them. Awards add twinkling sparkles in the award colour, and Best Performer wears a crown.
- **The character.** On computers with graphics acceleration, a live 3D figure (`CO_3D.view(..., { mini: true })`: no props or floor, just the person doing their signature move, Victory jump for awards or Disco point for stars). three.js loads quietly 2.5 seconds after the dashboard opens. Elsewhere it shows their saved picture, gently bobbing, or the 2D character. With nothing to celebrate, it shows your own character waving, or invites you to make one.
- **Click for details.** A small popover with a bigger live figure, its props and celebration, the award and reason, Cheer, Previous/Next, *Edit my character*, *Give an award* (Admins) and *Hall of Fame* (the full page, still at `#studio`). It closes on Escape or a click outside.
- **Phones.** The top bar's controls get their own row under the title, and the widget sits on the left of that row.
- **Older web app.** If the web app has not updated yet (`unknown_action`), the widget shows your own character, and the popover says awards will appear in a few minutes. It retries once a minute.

## Personas and the Hall of Fame pop-up (Nov 2026, v3)

- **Characters are personas** (`assets/hof.js`, art in `assets/chars/`). There are 18 original personas, each inspired by a general flavour of 2000–2020 cartoons and never a copy of a named character: Hoodie Kid, Grumpy Genius, Big Specs, Beanie Boss, Coffee Cap, Track Star, Puffer Pro, Street Style, Groovy Kid, Baby Gorilla, Snuggle Bunny, Fuzzy Bear, Pip Penguin, Smart Duck, Panda Pal, Little Dragon, Sporty Squirrel, Lilac Blob, Thumbs Up and DJ Chill (v4 set, styled after soft 3D toy references, all original). Each is drawn three times, as a designer (tablet and stylus), video editor (headphones and clapperboard) and copywriter (notebook and pencil). Each image is a 384 px transparent WebP, plus a 128 px face crop used as the avatar.
- **How the art was made (free).** The images came from Pollinations.ai (free, no account; same seed per persona for consistency), were cut out with rembg (the open-source isnet model) and cropped. To add a persona: generate it the same way, cut it out, add a row to `PERSONAS` in `assets/hof.js`, and add its default move. Credit: "Art made free with Pollinations.ai".
- **Moves** are CSS, applied to the image and its contact shadow: Bounce, Wiggle, Jump for joy, Groove, Side shuffle, Backflip, Turnaround, Happy shake, Float, Power stomp, Strut, Nod along, Zoom and Power up. With reduced motion, the characters stand still.
- **Everyone has one.** Until someone picks, a persona is chosen for them from their name, and their craft comes from their role. Their avatars elsewhere stay as initials until they pick. Saving stores `{ v: 3, persona, prof, move }` in Profiles.
- **Widget (beside the clock).** The persona does its move, with a soft glow in the award colour, sparkles, and a crown for Best Performer. It rotates every 6.5 seconds through awards, then last week's stars; with neither, it shows this week's top deliverers. Click it to open the pop-up.
- **Pop-up (under the widget, fixed, so the page layout never moves).** It shows every active teammate, one card at a time: their character on a soft glow (click it for another move), name, role, persona, award and star badges, the award note, this week, last week and awards counts, Cheer (per person per week), and a link to the creative. Browse with the arrows, the keyboard arrows or by swiping sideways (scroll snap). Award winners come first, then stars, then by this week's output. The footer has Choose/Change my character and, for Admins, Give an award.
- **Choose your character** (also from your name at the bottom of the sidebar): pick a persona, your craft and your move, with a live preview, plus a tagline.
- The earlier 3D engine (`assets/char3d.js`) and the 2D builder stay in the code but are no longer used for the Hall of Fame.

## The Creative Head's own work is private (Nov 2026)

- **In the web app** (`privateText_`), every signed-in person except the owner gets the owner's tasks anonymised before the data is sent. Brand becomes "Private", designer becomes "Private", the ID becomes `PVT-…`, and title, links, brief, notes and every other detail are blanked. Status, dates, quantity, creative type and sheet stay, so totals, reports, monthly counts and team metrics still include them exactly (same number of rows). A task shared with someone else stays visible to that person, with the owner's name removed. Briefs of the owner's tasks are refused for everyone else.
- **On the dashboard**, anonymised rows count in Overview, Reports and Brands totals but are never listed: not in Tasks, Stand-up, My work, Needs attention, the Today widget, Waiting on client or the Hall of Fame. The owner is left out of people lists (stand-up cards, team views, content writers, stars) for everyone else.
- **Not covered:** Admins' activity log (Access) and Fasty read the sheets directly and can still mention the owner's tasks. Restrict those Admin permissions if needed.

## Free-only (Nov 2026)

The dashboard runs only on free services. Code paths that could cost money are switched off in `Code.gs`:
- `ANTHROPIC_API_KEY` (Claude for Fasty) is never read; Fasty uses Gemini's free tier.
- `GOOGLE_TTS_KEY` (Cloud Text-to-Speech, which needs billing) is never read; voice uses Gemini's free speech model.
- Photo-to-character (`charMake_`) is off, because Gemini's image models have no free tier.

| Service | Used for | Cost | Free limits |
|---|---|---|---|
| GitHub (public repo + Pages) | Hosting the site, code updates | Free | Pages: 1 GB site, 100 GB/month bandwidth |
| Google Apps Script | The web app (data API, saves, reminders, self-update) | Free | Workspace: 6 min per run, 30 min/day of triggers per user, 100k URL fetches/day, 1,500 emails/day |
| Google Sheets / Drive | All data, access, notes, issues, characters | Free | 10M cells per spreadsheet |
| Google Sign-In (Identity Services) | Login | Free | None in practice |
| Google Calendar API | Meetings | Free | 1M queries/day |
| Google Docs API | Brief tab lookup | Free | 300 reads/min per project |
| Apps Script API | Self-update from GitHub | Free | 50k calls/day |
| Google Chat webhook (optional) | Briefing messages | Free | 1 message/s per space |
| Gemini API, free tier (optional) | Fasty answers and voice | Free while the key's Google Cloud project has **no billing account** | Per-model per-minute/day caps (e.g. Flash: ~10 req/min, ~250/day); prompts may be used by Google to improve products |
| jsdelivr CDN | d3, Motion, anime.js, three.js | Free (open-source, MIT/ISC) | None in practice |
| Google Fonts | Outfit, Inter, IBM Plex Mono | Free (OFL) | None |
| Character art | Made once with Pollinations.ai and rembg, shipped as files | Free, no runtime calls | None |
| Sounds and music | Made live in the browser (Web Audio) | Free | None |
