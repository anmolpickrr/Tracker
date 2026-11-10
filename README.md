# Creative Ops Tracker

A live dashboard for the Fastrr creative team: the daily stand-up, who is working on what, deadlines, workload, and monthly delivery reports. It reads the team's Google Sheets directly, so there is nothing to update by hand.

**Live site:** https://anmolpickrr.github.io/Tracker/

## What it shows

Navigation is a sidebar on desktop and a bottom tab bar on phones (More opens the rest).

| Page | For |
| --- | --- |
| **Overview** | Open, overdue, due-today, in-progress, under-review and delivered-this-month counts (each opens the matching task list). **Needs attention**: overdue, due today or tomorrow and changes requested, with a bar showing the mix, filter chips and one row per task (hover for Brief and Creative links). **Unassigned**: work nobody has picked up, oldest and overdue first. **Pipeline** by design status, **workload** per designer, and what is **coming up** in the next 14 days. |
| **Stand-up** | One card per active team member for the daily meeting: overdue, due today, in progress, changes requested and up next, with a summary strip on top. |
| **Tasks** | Every task from both sheets. One-click status chips with counts (Not delivered, Open, Overdue, Due this week, No ETA, Pending approval, Delivered this month, All), search, sorting, CSV. Click a task to open or edit it. On phones each task is a card. |
| **Team** | Scorecard per person (open, overdue, due in 7 days, in review, delivered this month and last, monthly average, main brands, type mix), a designer-by-month delivery grid, and Active / Inactive switches (admins). |
| **Reports** | Creatives delivered for any month, quarter, year or custom range, compared with the period before: monthly chart (total or by type), by brand, by designer, by creative type. CSV. |
| **Data health** | Rows that make tracking unreliable (no ETA, no designer, unknown status, mistyped dates, duplicates) and the connection status of every sheet. |
| **Notes** | A team notebook: meeting minutes, discussions and personal notes with @mentions, action items (assignee and due date), follow-ups and reminders. See [Notes](#notes). |
| **Access** (admins) | Access requests, people and their access level, and the activity log of every change. |

FASTRR look: **FASTRR blue (#6037D7) is the primary colour** for buttons, the current page, selected tabs and toggles; the brand palette (Pantone Sun Glare #DDFF00, Exuberant Orange #FF5A26, Blue Violet 2725 C #685BC7, Cloud Dancer #F0EEE9, Darkest Hour #1E1E1E) in a Day (light) and Night (dark) theme that follow sunrise and sunset (see [Live clock, Day and Night](#live-clock-day-and-night)). The two-strip logo icon is always FASTRR blue (#6037D7) and the sidebar shows only the animated icon. The loading screen shows the original FASTRR logo with "Creative Ops" in small italic beneath it. Outfit for headings and numbers. Green and red appear only on change chips (better or worse). Category colours in charts are a validated colour-blind-safe set, and every chart value is also available as a label, tooltip or table. Secondary table columns appear only on screens wide enough for them; everything is still in the task dialog and the CSV exports.

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

## Today (sidebar)

The **Today** card in the sidebar (at the top of the Overview on phones) shows the day's progress ring (delivered ÷ pick up + in progress + delivered) and four tiles: **Pick up** (to be planned or changes requested, due today or the next working day), **In progress** (WIP), **Delivered** today and **Carried over** (open and past its ETA). Click a tile to see its tasks in a panel beside the sidebar (inline on phones); click a task to open it, or **Open stand-up** for the per-person view. Delivered today comes from the activity log: any design status changed to DONE today, in the sheet or on the dashboard; a delivered task with today's ETA also counts.

## Meetings (Google Calendar)

The Overview's Meetings card shows the next meeting with a countdown, who is in it, a Join Google Meet button and a Take notes button (which starts a meeting note with the title and attendees filled in), plus the rest of today and the next two days. Each person connects their own calendar once, read-only; the access lasts for the browser session and is never sent to the web app or stored in the sheets.

**Automatic for everyone:** the web app reads the signed-in person's own calendar, so team members see their meetings with no setup, as long as calendars share event details inside the company (Google Admin console → Apps → Google Workspace → Calendar → Sharing settings → Internal sharing options: *Share all information*). Run `testMeetings` in Apps Script to see who is covered. Anyone whose calendar isn't shared sees a **Connect Google Calendar** button instead (needs the Google Calendar API enabled in the "Creative Ops Tracker" Google Cloud project).

Every meeting shows its name, date, time, duration and a Join link. If the calendar only shares free/busy times with the web app, meetings appear as "Busy (details hidden)" with a **Show names & Meet links** button: one click connects the person's own calendar (read-only, this browser session) and the full details replace the busy blocks. Changing the sharing setting above fixes it for everyone.

## Who's online (admins)

Admins see, under **Access**, who has the dashboard open, which page they are on, the task they are editing (if any) and when they were last active; the header shows the faces of people online now. Nothing else is collected: no keystrokes, no screen contents, no location. Everyone sees a notice about this in the bell menu, and an admin can switch it off under Reminders and notifications. "Last active" is saved in the Users tab at most every 10 minutes.

## Live clock, Day and Night

The clock in the header always shows India Standard Time, whatever the computer's own time zone. Click it to switch between 12-hour and 24-hour; the choice is remembered on that device.

The theme follows the sun: **Day** (light) from sunrise and **Night** (dark) after sunset, using north-India sunrise and sunset times for the month. By day the clock is orange with a small sun rising over its edge; at night it turns violet with a moon and twinkling stars. The switch is a soft circular reveal. The sun/moon button picks the other theme until the next sunrise or sunset, then it goes back to automatic. Animations stop for anyone who has reduced motion turned on.

## Fasty, the voice assistant

The small blue buddy (round eyes, a smile and a lime-tipped antenna) at the bottom right (or **Alt+A**) opens **Fasty**, a voice and chat helper that knows the whole dashboard. Ask in Hindi, English, Hinglish or mixed sentences, by voice (tap the lime microphone) or by typing:

**Fast replies, voice in step with the text:** the voice for the first sentence is made in the same request as the answer, so the reply appears and Fasty starts speaking at the same moment; the rest of the speech is made in parallel while the first sentence plays, so there is no pause between sentences. If natural speech is busy (Gemini's free voice has low limits), the device's own voice starts straight away instead, so there is never a silent wait. A new question stops the previous answer's voice. For even faster natural speech, add a Google Cloud Text-to-Speech key as `GOOGLE_TTS_KEY` in Script properties (paid by characters spoken; premium voices cost roughly ₹2,500 per million characters, about ₹500 per thousand replies; see Google Cloud pricing).

Small tips pop up next to Fasty one at a time (each for about 2.5 seconds, with a pause between) with ideas of what to ask and live counts such as tasks overdue. They pause while Fasty is open or the pointer is on a tip; the × hides them for the rest of the day.

- "Yashika ke kitne tasks overdue hain?", "What is due tomorrow for Huggler?", "SRAP372 ka status kya hai?"
- "Is mahine kitne creatives deliver hue, internal vs external?", "Who delivered most last month?", "Team ka progress batao"
- "Last month ka external report dikhao", "Open Gurleen's stand-up", "How do I add an action item?"
- "SRAP372 ko under review kar do" (Editors and Admins)

How it works:

- **Answers come from the live data** you can already see, never from guesses. Matching tasks appear in the chat and open with a click. If something is unclear (two people with the same first name, an unclear period) Fasty asks one short question. Follow-ups such as "aur pichle mahine?" keep the context.
- **Actions:** Fasty opens pages and sets filters directly. To change a task (status, ETA, designer, priority) Fasty says what will change, and the change is saved only after you press **Save change** on the card; it goes through the same save as the task editor, is checked against your access level by the web app and appears in the activity log. View-only users are told who can make the change.
- **Voice:** speech is turned into text by the browser (Chrome, Edge and Safari; Firefox can type). The language button switches between English (which also understands Hinglish) and हिन्दी. Replies are spoken in a female voice: Google's natural Chirp 3 HD voice when set up (below), else the most natural female voice on the device. The speaker button turns voice replies off. When a reply ends with a question, Fasty listens again automatically.
- **Privacy:** your question and the dashboard rows needed to answer it are sent to Claude (Anthropic) through the web app; nothing is stored by the dashboard. The API key stays in Apps Script and never reaches a browser. Each person can ask about 40 questions every 10 minutes.

**Setup (owner, once, about 10 minutes):**

1. **Update the web app.** On GitHub open `apps-script/Code.gs` → *Raw* → select all, copy. In Apps Script, open `Code.gs`, select all, paste, save. Then **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The URL stays the same.
2. **Free AI (recommended): Google Gemini.** Signed in as design.tools@pickrr.com, open aistudio.google.com → **Get API key → Create API key** (pick the "Creative Ops Tracker" project). In Apps Script: **Project Settings (⚙) → Script properties → Add script property**: name `GEMINI_API_KEY`, value the key → **Save**. No redeploy needed.
3. **Check:** reload the dashboard. The System check no longer says "basic mode", and Fasty's panel says "Answers use Google Gemini".
4. *Optional, paid:* `ANTHROPIC_API_KEY` for Claude (see costs below), and `GOOGLE_TTS_KEY` for Google's natural voice. `GEMINI_MODEL` pins a specific Gemini model (default `gemini-flash-latest`, which follows Google's current Flash model).

**Which AI answers:** Access → Reminders and notifications → *Fasty, the assistant*. **Automatic** (default) uses free Gemini when its key is set, otherwise Claude Haiku 5.5. When Gemini's free daily or per-minute limit is reached, Fasty answers that question in basic mode and says so, instead of failing.

**About the free tier:** Google charges nothing, but limits requests per minute and per day (shown in AI Studio, and changed from time to time) and **may use free-tier requests to improve its products**. The questions and the task rows Fasty looks up (brands, creative titles, designer names, dates) are sent. If that is not acceptable for client work, use Claude Haiku 5.5 (about ₹900 a month for the team; Anthropic does not train on API data) or turn on billing for the Gemini key (paid tier data is not used for training).

Without any AI key, Fasty runs in **basic mode**: it still answers the common questions (overdue, due today or open work for anyone, deliveries this month, opening pages) in English or Hinglish, and says so at the bottom of the panel. Fasty runs at low effort for quick spoken replies. An admin picks the model under **Access → Reminders and notifications** (the change is logged): Claude Haiku 5.5 (fast, lowest cost), Claude Sonnet 5.5 (balanced) or Claude Opus 5.5 (most capable, the default). Sonnet and Opus use Anthropic's automatic fallback if a request is declined.

### Cost (estimate)

A question usually takes two calls to Claude (look up the data, then answer). Per question that is roughly 6,000 input tokens sent fresh (the conversation and the data found), 6,000 read from the cache (Fasty's instructions and tools, about 2,700 tokens, reused) and 700 output tokens. For 20 people × 20 questions = 400 questions a working day, 22 working days a month:

| Model | Price per million tokens (input / output) | Per question | Per day | Per month |
| --- | --- | --- | --- | --- |
| Claude Haiku 5.5 | $0.10 / $0.50 | about $0.001 | about $0.45 | about $10 (≈ ₹900) |
| Claude Sonnet 5.5 | $2 / $10 | about $0.02 | about $8.50 | about $190 (≈ ₹17,000) |
| Claude Opus 5.5 | $4 / $20 | about $0.04 | about $17 | about $380 (≈ ₹34,000) |

Long back-and-forth conversations cost more (the conversation is resent), short ones less; allow ±50%. Speech-to-text is done by the browser and is free. The optional Google natural voice costs about $30 per million characters after a free allowance: 400 spoken answers × ~200 characters ≈ 1.8 million characters a month, about $25–55 (≈ ₹2,000–4,500); without it, the device voice is free.

Limits: each person can make 40 assistant calls (about 20 questions) and 80 voice replies every 10 minutes, which is far above normal use; the Anthropic account's own rate limits are well above 400 questions a day. Set a monthly spend limit in the Anthropic console to cap costs.

## Notes

The **Notes** page is a sticky-note board for meeting notes, daily updates, ideas and personal notes.

- **Quick capture:** type in the sticky at the top and press **Enter**. The first line becomes the title; lines starting with `[]` become to-dos for you; **Shift+Enter** adds a line. Pick **Meeting**, **Idea / discussion** or **Personal** first (personal notes are private; the others are visible to the team).
- **The board:** stickies are coloured by kind (meetings violet, ideas lime, personal orange, stand-ups cream with lime tape), pinned ones first, then this week, then earlier. Tick to-dos right on the sticky; hover a sticky to **pin** or **delete** it. Pinned stickies come first. Search and the filters above narrow the board.
- **Open a note:** click a sticky to open it as a large sticky over the board: title, text (type `@` to mention someone), action items with an owner and due date, and **Details** (date, brand, category, who can see it, sharing, follow-ups, email reminder). **Save & close** (or Ctrl/⌘+S) saves; **Esc** closes.
- **Templates:** **Stand-up** pre-fills attendees, updates, blockers, decisions and today's overdue list.
- **Who sees a note:** Only me; people I mention or add (plus anyone with an action item); or everyone with access. Admins can see every note. Only the author or an admin can edit or delete; anyone with an action item can tick it.
- **Instant:** adding, ticking, pinning, saving and deleting update the board at once and save in the background (a sticky shows "Saving…" until it is stored). If a save fails, the change is undone and a message says why. Deleting shows **Undo** for 5 seconds.
- **Storage:** the *Notes* tab of the access spreadsheet. Every create, edit, delete and tick is in the activity log; deleted notes stay in the spreadsheet, marked deleted. Unsaved writing is kept as a draft in the browser, and saving over someone else's newer edit is refused.

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

## Fast start

On a device that has signed in before, the dashboard opens at once from a copy of the last data saved in the browser (IndexedDB, for that person only), shows "Saved copy · updating…" and swaps in the live data a few seconds later. It skips the settings and sign-in round trips (the data request checks the session), and loads notes, history, the activity feed, settings and the briefing check only after the data has arrived. Signing out, or losing access, deletes the saved copy.

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
- **Open** = To be planned + WIP + Changes requested (plus any status the dashboard doesn't recognise). **Overdue** = open with a Design ETA before today.
- **Delivered** = design status DONE/Delivered, dated by **Delivered On** if the sheet has it, else the Design ETA (else the request date), and never later than today.
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
- **Monthly report bars and "vs prev." columns:** each complete month against the month before; the current month against the same days of the previous month. Bars for months outside the chosen range are faded and striped.
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

| In the sheet | Shown as | Open work (workload, overdue) | Notes |
| --- | --- | --- | --- |
| TBP, blank | To be planned | yes | |
| WIP | WIP | yes | |
| Changes | Changes requested | yes | |
| Shared, Pending approval, Review | Pending approval | no | Waiting for the client. Never overdue, not in workload; shown as "Pending approval · Nd" since the ETA. |
| DONE, Delivered | Delivered | no | |
| Rejected | Delivered | no | Counted as completed ("rejected by client"). The redesign is a new task (new row). |
| No update | Delivered | no | Shared with no response: counted as shared and completed ("no client update"). |
| HOLD, Paused | Hold | no | Never overdue. |
| Deprioritized, Cancelled | Deprioritised | no | Never overdue. |
| blank/TBP with content WIP | Incomplete brief | no | The content writer's work in progress ("content WIP"); counts in the writer's load, not the designer's. |
| blank/TBP with content Incomplete brief, Pending or TBD | Incomplete brief | no | |
| anything else | shown as typed, flagged in Sheet health | yes | |

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
tools/inline-data.js   copies assets/data.js into Code.gs (run after changing data.js), so reminders count exactly like the dashboard
assets/logo.svg        the FASTRR mark on a transparent background (notifications)
assets/favicon.svg     browser-tab icon: #111114 bars on light tabs, white on dark tabs
apps-script/appsscript.json  its permissions
```

The page sets a Content Security Policy: scripts only from this site, jsDelivr (d3) and Google sign-in, and data only from the Apps Script web app.

No build step: edit and push to `main`, and GitHub Pages publishes the site.
