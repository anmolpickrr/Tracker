/* What's new: every dashboard update, newest first. Add an entry with each release (see README, "What's new").
   id: unique and stable (it marks what each person has seen). date: YYYY-MM-DD (IST). kind: new | improved | fixed.
   who: 'all', or 'page:<section>' (only people who can open that section), or 'perm:<permission>', or 'admin'.
   go: the section the "Open" button takes you to (optional). Write for the people using the dashboard: plain words. */
window.CO_WHATSNEW = [
  {
    id: '2026-11-27-trishla', date: '2026-11-27', kind: 'fixed', who: 'page:access', title: 'Trishla Raj set up as an Editor',
    what: 'Trishla Raj (also written as Trishla) is now on the team list as an Editor, with the same access as the rest of the team.',
    does: 'She is listed by her team-list name instead of her Google profile name, and sees only the tasks assigned to her.',
    how: 'Nothing to do. It applies automatically within about 10 minutes.'
  },
  {
    id: '2026-11-27-team-default', date: '2026-11-27', kind: 'improved', who: 'page:access', title: 'One standard access for the team',
    what: 'Team members, including new joiners you approve or add, now get the same access automatically.',
    does: 'My work, Overview, Tasks, Notes and Brands; only their own tasks; read briefs, submit creative links and use Fasty. Abhist, Sagun, Manuj and Manorama keep their own settings.',
    how: 'Approve requests or use Add a person as usual. Change anyone one by one under Permissions.'
  },
  {
    id: '2026-11-26-smooth', date: '2026-11-25', kind: 'improved', who: 'all', title: 'No more jumping back to the top',
    what: 'The dashboard no longer reloads itself while you are working, and live updates keep your place.',
    does: 'When a new version is out, an Update ready button appears next to Refresh: click it when it suits you. Live data updates keep your scroll position, scrolled lists and open sections.',
    how: 'Nothing to do. Click Update ready whenever you like.'
  },
  {
    id: '2026-11-26-accuracy', date: '2026-11-25', kind: 'improved', who: 'all', title: 'My work shows today, and clearer numbers',
    what: 'My work now opens on Today: every task assigned to you with today\'s ETA, whatever its status (content still pending included), plus anything overdue.',
    does: 'The Overview has a new "This month at a glance" strip with a How we count panel. Messages now appear at the top of the screen in front of any pop-up, and buttons show a spinner while saving.',
    how: 'Open My work for your day; on the Overview, click How we count for exact definitions.'
  },
  {
    id: '2026-11-25-backend-all', date: '2026-11-25', kind: 'fixed', who: 'page:issues', title: 'Marketing tasks save to the Backend tab',
    what: 'Creative links, status and Open File links for Marketing (SRA) tasks failed because the 2026 (Mkt Team) tab is locked.',
    does: 'Every change to a Marketing task is now saved on its row in the Backend tab, and the sheet copies it across as usual.',
    how: 'Nothing to do. Failed saves on the Issues page can be retried.'
  },
  {
    id: '2026-11-25-paid-colp', date: '2026-11-25', kind: 'fixed', who: 'page:issues', title: 'PAID sheet: Open File links stay in the Open File column',
    what: 'For external (PAID) tasks, the Open File link you save goes into the Open File column (column O) of the 2026 tab.',
    does: 'The dashboard reads it from the same column and never adds columns to that sheet.',
    how: 'Open your task > Links > Open File > paste the link > Save.'
  },
  {
    id: '2026-11-25-domain-access', date: '2026-11-25', kind: 'new', who: 'page:access', title: 'Give a whole company access at once',
    what: 'Access now has Whole-domain access: switch @shiprocket.com (or @pickrr.com) to View only or Can edit.',
    does: 'Everyone signing in with that kind of work account gets in straight away with that level, no request needed. People you removed or declined stay out, and you can still change anyone one by one.',
    how: 'Access > People with access > Whole-domain access. Only the Creative Head can switch it.'
  },
  {
    id: '2026-11-24-protected', date: '2026-11-24', kind: 'fixed', who: 'page:issues', title: 'Clearer Issues: protected columns and old errors',
    what: 'A save refused by a protected column now names the exact sheet, tab and column, and lists it under Fix in the sheets.',
    does: 'Server errors that have not come back for 3 hours close by themselves (the Maximum call stack ones were fixed this morning).',
    how: 'Issues page: open the protected-column item and follow its steps.'
  },
  {
    id: '2026-11-24-backend-file', date: '2026-11-24', kind: 'fixed', who: 'page:issues', title: 'Open File links go to the Backend tab',
    what: 'For the Marketing sheet, Open File links you submit are now saved on its Backend tab, on your task\'s row.',
    does: 'The sheet\'s own script then copies them to the 2026 (Mkt Team) tab as before; the dashboard no longer writes there directly.',
    how: 'Open a task > Links > Open File > paste the link > Save.'
  },
  {
    id: '2026-11-24-org-pick', date: '2026-11-24', kind: 'improved', who: 'all', title: 'Pick your company once',
    what: 'The usual link now asks once whether you use a Pickrr or Shiprocket Google account, then always opens the right dashboard.',
    does: 'Each company has its own company-only copy of the dashboard, with the same tasks, people and settings.',
    how: 'Choose your company the first time. To change it later, open the link with ?switch at the end.'
  },
  {
    id: '2026-11-24-gas-host', date: '2026-11-24', kind: 'improved', who: 'all', title: 'The dashboard is moving to a company-only address',
    what: 'The dashboard can now also open from a Google Apps Script address that only @pickrr.com and @shiprocket.com accounts can reach.',
    does: 'Google signs you in with your company account, so there is no separate sign-in step. Everything else works as before; the old link will forward you there.',
    how: 'Keep using your usual link. If it opens the Apps Script home page instead, your browser is signed in to several Google accounts: use a window or Chrome profile where your company account is the first (or only) one signed in.'
  },
  {
    id: '2026-11-24-studio-off', date: '2026-11-24', kind: 'improved', who: 'page:issues', title: 'The Studio page is retired',
    what: 'The old Studio page can no longer be opened, even from an old link or notification.',
    does: 'Award notifications and old Studio links now open the Hall of Fame pop-up beside the clock instead.',
    how: 'Click the Hall of Fame beside the clock.'
  },
  {
    id: '2026-11-24-hof-v5', date: '2026-11-24', kind: 'improved', who: 'all', title: 'Hall of Fame card: tighter and cleaner',
    what: 'The card is about a third shorter.',
    does: 'Edit and Remove are small icons beside the name, reactions sit on the same line as the award date, stats are one slim line and the two creatives sit side by side.',
    how: 'Click the Hall of Fame beside the clock.'
  },
  {
    id: '2026-11-24-hof-perm', date: '2026-11-24', kind: 'improved', who: 'page:access', title: 'Choose who manages the Hall of Fame',
    what: 'The Access page has a Hall of Fame row for each person: View, Feature or Full control.',
    does: 'View: see, cheer and react. Feature: give and remove awards. Full control: also edit awards and their creatives. Nobody but the Creative Head has Feature or Full control until you grant it, Admins included.',
    how: 'Access > a person > Permissions > Sections > Hall of Fame, then Save changes.'
  },
  {
    id: '2026-11-24-rx-names', date: '2026-11-24', kind: 'improved', who: 'all', title: 'See who reacted, and preview songs',
    what: 'Reactions now show who reacted, with names highlighted (yours flashes when you react). Each song shows who suggested it.',
    does: 'Tap ▶ on a song with a YouTube link to hear its first 5 seconds; Spotify links open Spotify\'s own preview. The playlist only accepts clean songs: explicit, vulgar or adult titles are refused.',
    how: 'Hall of Fame > ♫ for the playlist; reactions are under each award message and creative.'
  },
  {
    id: '2026-11-24-reactions', date: '2026-11-24', kind: 'new', who: 'all', title: 'React with emojis in the Hall of Fame',
    what: 'React to award messages and to each showcased creative with ❤️ 🔥 😂 😍 👏 🎉 💯 🙌.',
    does: 'Tap the smiley to open the picker; your emoji floats up and the count pops. Tap a reaction again to undo. Double-click a message for a quick ❤️. Every showcased creative is listed, with its own reactions.',
    how: 'Click the Hall of Fame beside the clock.'
  },
  {
    id: '2026-11-24-hof-compact', date: '2026-11-24', kind: 'improved', who: 'all', title: 'Hall of Fame pop-up: smaller and tidier',
    what: 'The pop-up is narrower and shorter, with the stats in one line and actions on one row.',
    does: 'It never grows past the screen; long content scrolls inside it.',
    how: 'Click the Hall of Fame beside the clock.'
  },
  {
    id: '2026-11-24-award-two', date: '2026-11-24', kind: 'improved', who: 'all', title: 'Awards can showcase two creatives',
    what: 'A Hall of Fame award can now link up to two creatives.',
    does: 'They appear on the card as Creative 1 and Creative 2. Only the Creative Head can edit an award after it is given.',
    how: 'When featuring someone, fill in Creatives (up to 2).'
  },
  {
    id: '2026-11-24-playlist', date: '2026-11-24', kind: 'new', who: 'all', title: 'Team playlist: suggest trending songs',
    what: 'Anyone can suggest a trending song, in Hindi, Punjabi, English, Tamil, Telugu and more, or a genre like Lo-fi.',
    does: 'Add the song, artist, language and a YouTube or Spotify link. Everyone can like songs; the most liked rise to the top, and you can filter by language.',
    how: 'Hall of Fame (beside the clock) > the ♫ button, or bell > Sounds & music > Team playlist.'
  },
  {
    id: '2026-11-24-hof-polish', date: '2026-11-24', kind: 'improved', who: 'all', title: 'Hall of Fame card, polished',
    what: 'The reason for an award is now a proper quote card in the award\'s colour, with the award name and date.',
    does: 'The count at the top matches who is shown, a dot indicator replaces "1 / 1", and the buttons are tidier.',
    how: 'Click the Hall of Fame beside the clock.'
  },
  {
    id: '2026-11-23-award-preview', date: '2026-11-23', kind: 'improved', who: 'all', title: 'A proper preview when featuring someone',
    what: 'The Hall of Fame dialog now previews the award with the person\'s own character, in the award\'s colour.',
    does: 'The name, the reason (as you type) and how long it stays featured all update live.',
    how: 'Hall of Fame > Feature someone.'
  },
  {
    id: '2026-11-23-link-review', date: '2026-11-23', kind: 'improved', who: 'all', title: 'A new creative link always moves the task to Under review',
    what: 'Submitting or replacing a creative link now always sets the design status to Under review.',
    does: 'It applies to every task, including ones already Delivered or Shared, so the Creative Head reviews each new version. There is no checkbox to skip it any more.',
    how: 'Open a task, paste the link under Creative link and press Submit or Replace.'
  },
  {
    id: '2026-11-23-online-pill', date: '2026-11-23', kind: 'fixed', who: 'page:access', title: 'Cleaner "online" pill',
    what: 'The faces in the online pill overlapped with a big dot on each one.',
    does: 'Faces are now solid and evenly stacked, with one live dot beside the count.',
    how: 'Click the pill to jump to Live team activity.'
  },
  {
    id: '2026-11-23-haptic', date: '2026-11-23', kind: 'new', who: 'all', title: 'Vibration when a notification arrives',
    what: 'Notifications and reminders now give a short vibration, each type with its own pattern.',
    does: 'Phones that support vibration (most Android phones) buzz; on computers and iPhones the bell gives a short shake instead. It follows the per-type switches, and works even with sounds off.',
    how: 'On by default. Turn it off any time: bell > Sounds & music > Vibration.'
  },
  {
    id: '2026-11-23-wn-hero', date: '2026-11-23', kind: 'fixed', who: 'all', title: "What's new: the top card shows again",
    what: "The dark summary card at the top of What's new could stay invisible, leaving an empty gap.",
    does: 'Its entrance animation no longer hides it, and any animation that stalls now snaps to its end state.',
    how: 'Nothing to do.'
  },
  {
    id: '2026-11-23-alerts-on', date: '2026-11-23', kind: 'improved', who: 'page:issues', title: 'Sounds and alerts are now on for everyone',
    what: 'Notification sounds, desktop alerts, reminders and briefing emails are switched on by default.',
    does: 'Your browser may ask once to allow notifications after your first click: choose Allow. The Studio radio still plays only when you press play.',
    how: 'Turn anything off from the bell > Sounds & music, or the switches below the notifications.'
  },
  {
    id: '2026-11-23-su-nohead', date: '2026-11-23', kind: 'improved', who: 'page:standup', title: 'Stand-up: Creative Head card hidden',
    what: 'The Creative Head no longer has a card in the daily stand-up.',
    does: 'Stand-up shows only the team. Totals elsewhere are unchanged.',
    how: 'Nothing to do.'
  },
  {
    id: '2026-11-23-mywork-v3', date: '2026-11-23', kind: 'improved', who: 'all', title: 'My work: all your tasks, by week or month',
    what: 'My work now lists every task assigned to you: Assigned, TBP, WIP, Under review, Shared and Rejected.',
    does: 'Switch between This week and This month; tasks are grouped by Design ETA date, with open work from earlier and undated tasks first. Tap a status to see only those.',
    how: 'Open My work. It shows only your own tasks; the filters and View as are gone from this page.'
  },
  {
    id: '2026-11-23-open-file-col', date: '2026-11-23', kind: 'fixed', who: 'page:issues', title: 'Open File links now save on every sheet',
    what: 'Saving an Open File link failed on sheets that had no Open File column.',
    does: 'The save now says clearly when a sheet has no Open File column. (The dashboard never adds columns to the sheets.)',
    how: 'Nothing to do. Failed saves on the Issues page can simply be retried.'
  },
  {
    id: '2026-11-23-new-crew', date: '2026-11-23', kind: 'improved', who: 'all', title: 'A brand-new crew of characters',
    what: '20 new characters in a soft 3D toy style: comfy hoodie kids, a grumpy genius, a DJ, plus a fuzzy bear, baby gorilla, penguin, panda, little dragon and more.',
    does: 'Each comes as a designer, video editor or copywriter, with plush textures, big expressive eyes and attitude. All are our own originals.',
    how: 'Click the character beside the clock, then Change my character. If you had picked one before, you now have its closest new match; pick again any time.',
    changed: 'Replaces the earlier set of 18 characters.'
  },
  {
    id: '2026-11-22-personas', date: '2026-11-22', kind: 'new', who: 'all', title: 'Pick your character: 18 fun personas',
    what: 'Characters are now glossy 3D-style personas with real personality, from Gadget Kid and Ninja Rookie to Snack Buddy, Space Cadet and Cool Cat, each drawn as a designer, video editor or copywriter.',
    does: 'Your persona is your avatar and shows in the Hall of Fame beside the clock with your move (bounce, backflip, groove and more). Award winners get a crown, sparkles and a glow. Everyone starts with one picked for them until they choose.',
    how: 'Click the character beside the clock, then Choose my character. Click it again any time to browse the whole team with the arrows or by swiping sideways, and cheer for anyone.',
    changed: 'All characters are original (inspired by classic cartoons, not copies of any) and the art is made with free tools.'
  },
  {
    id: '2026-11-22-hof-widget', date: '2026-11-22', kind: 'improved', who: 'all', title: 'The Hall of Fame, next to the clock',
    what: 'A tiny animated character beside the clock celebrates whoever won an award or was a star last week, for everyone.',
    does: 'It rotates every few seconds between award winners (Best Performer, Best Creative and more) and last week\'s stars, each doing a move, with sparkles for awards and a crown for Best Performer.',
    how: 'Click it to see why they are celebrated, cheer for them, flip through everyone, edit your own character or, for Admins, give an award. Hover it to pause.',
    changed: 'Studio is no longer in the menu or on the Overview; it is all in this small widget (and the full Hall of Fame page it links to).'
  },
  {
    id: '2026-11-22-3d', date: '2026-11-22', kind: 'new', who: 'all', title: 'Characters in 3D, with dance moves',
    what: 'Your character is now a full 3D figure with hands, shoes and depth, and the Hall of Fame is a 3D desk with a retro computer.',
    does: 'Pick one of six looks (clay, vinyl toy, plush, toon, blocky, bean), trousers, shoes and cartoon gloves, and a signature move from 19 (wave, peace sign, dab, floss, robot, bhangra, moonwalk and more). The tools of your craft float around you: a typewriter for writers, a palette for designers, a camera and clapperboard for editors. Award winners get a crown, a trophy, a spotlight and confetti.',
    how: 'Open Studio. Hover a teammate to see their move, click to try another. On the desk, click the computer\'s knobs to change channel, click the person to change their move, and click the mug to make it jump. Edit yours under Make my character > Look and Moves.',
    changed: 'Your 3D picture becomes your avatar everywhere. Computers without graphics acceleration keep the earlier 2D characters, so the dashboard stays fast.'
  },
  {
    id: '2026-11-22-sounds', date: '2026-11-22', kind: 'new', who: 'all', title: 'Mentions, announcements and soft sounds',
    what: 'Tag teammates from the bell, from any notification and from What\'s new. Notifications now arrive with a gentle animation, and optional sounds.',
    does: 'Each kind has its own colour and sound: reminders, mentions, task updates, achievements (awards) and announcements. New ones ring the bell and slide in a small card you can open or dismiss. Admins can send an announcement to everyone. Studio has an optional radio: soft, endless instrumental music made live.',
    how: 'Click the bell, then Mention to tag people, or the @ on any notification to share it. In What\'s new, use Share with a teammate. Sounds stay off until you say yes. Change them any time under bell > Sounds & music (volume, which kinds, the radio).',
    changed: 'Sounds and music never play without your permission, and the radio only plays on the Studio page when you press play.'
  },
  {
    id: '2026-11-22-studio', date: '2026-11-22', kind: 'new', who: 'all', title: 'Studio: your character and the Hall of Fame',
    what: 'A new Studio page where the team is celebrated, and a clay-toy character for everyone that becomes your avatar across the dashboard.',
    does: 'Build your character (skin, face, hair, outfit, glasses, headwear and the tools of your craft, like headphones, a tablet or a clapperboard), or turn a photo into one with Gemini. The retro TV shows awards from the Creative Head and last week\'s stars, worked out from the sheets. You also get the podium, the awards wall, the whole crew and a reel of fresh deliveries.',
    how: 'Click your name at the bottom left (or Studio > Make my character). Pick parts, press Surprise me for ideas, add a tagline and save. On the TV, turn the knobs to change channel, and press Cheer to say well done.',
    changed: 'Initials avatars are replaced by characters as people make them. Admins give awards (Best Performer, Best Creative, Top Contributor and more) from Studio. The Overview has a small Hall of Fame strip.'
  },
  {
    id: '2026-11-21-my-day', date: '2026-11-21', kind: 'new', who: 'page:mine', go: 'mine', title: 'Your day, in five buckets',
    what: 'My work now opens with a breakdown of your day: Done, Under review, In progress, Not picked up and Overdue.',
    does: 'Each bucket shows how many tasks (and creatives) are in it. Click one to see exactly which tasks they are, with their ETA and status.',
    how: 'Open My work and click a bucket. On Done, switch between Today and This week. Click any task to open it and update its status or ETA.',
    changed: 'Replaces the Focus now, Up next and Delivered this week lists. A task past its ETA shows under Overdue and also in its own stage.'
  },
  {
    id: '2026-11-21-brief-reason', date: '2026-11-21', kind: 'improved', who: 'all', go: 'tasks', title: 'Clearer brief preview and status field',
    what: 'When a brief shows the Doc\'s first tab instead of the task\'s own tab, the preview now says why.',
    does: 'The design status list uses short names (TBP, WIP, Under review…) that fit the field, with what each means written underneath.',
    how: 'Open any task. If the note above the brief says the tabs could not be listed, use Open in Google Docs and pick the tab with the task ID.',
    changed: 'Before, "TBP: ready to be picked up" was cut off, and a wrong brief tab gave no explanation.'
  },
  {
    id: '2026-11-21-issues-why', date: '2026-11-21', kind: 'improved', who: 'page:issues', go: 'issues', title: 'Failed saves say why',
    what: 'Each save that did not reach the sheet now shows the reason on its row, in plain words.',
    does: 'For example "That column is protected in the sheet" or "Google Sheets was busy". A failed save whose value is in the sheet now (because someone saved it later) closes by itself.',
    how: 'Open Issues and read the "Why" line under a failed save. Fix what it says, then click Retry. Items that need a Google Cloud setting have a button that opens it.',
    changed: 'The Google Docs API reminder is logged at most every 6 hours instead of on every brief.'
  },
  {
    id: '2026-11-20-notes-assignees', date: '2026-11-20', kind: 'new', who: 'page:notes', go: 'notes', title: 'Edit notes assigned to you',
    what: 'If a note is assigned to you, you can now edit it, not only tick your item.',
    does: 'You can change its text, checklist, reminder, colour and files, and tag more people (they can then see it). Who can see it and who it is assigned to stay as the author set them, and only the author can delete it.',
    how: 'Open a note under "Assigned to me" and click Edit. Write your own notes the same way as always: a note is personal until you tag someone with @ or assign it, and then those people see it too.',
    changed: 'Before, only the person who wrote a note could change it.'
  },
  {
    id: '2026-11-20-sync', date: '2026-11-20', kind: 'fixed', who: 'all', title: 'Faster syncing, and the page never gets stuck',
    what: 'Updates reach your screen much faster, and a page that cannot load now recovers by itself.',
    does: 'The web app no longer does slow work on every refresh. When the sheets are busy, the dashboard tries again on its own instead of waiting for you to reload.',
    how: 'Nothing to do. If a load fails you will see "Trying again in a few seconds" and the page fills in by itself. The refresh button still works any time.',
    changed: 'Link details from the sheets are prepared in the background every 10 minutes. After a save, all open dashboards share one fresh copy of the data instead of each reading the sheets.'
  },
  {
    id: '2026-11-20-whatsnew', date: '2026-11-20', kind: 'new', who: 'all', go: 'whatsnew', title: 'What\'s new, for everyone',
    what: 'Every update to the dashboard, explained in one place, for every role.',
    does: 'Lists new features, improvements and fixes, newest first, with what each does and how to use it. Updates for parts of the dashboard you do not have say who they are for.',
    how: 'Click the sparkle icon at the top right. When something is new, the icon glows and a small note pops out of it; click "See what\'s new" or dismiss it. Use the arrow keys to move between updates and Open to go to a feature.',
    changed: 'It lives behind the icon at the top right, not in the menu, and the note never covers your work.'
  },


  {
    id: '2026-11-19-brief-tabs', date: '2026-11-19', kind: 'fixed', who: 'perm:briefs', go: 'tasks', title: 'Briefs show the right tab for each task',
    what: 'When one brief Doc has a tab for each script, the task window shows the tab for that task\'s ID.',
    does: 'It finds the tab whose title contains the task ID (for example "SRAP591 : 4th ugc"), and "Open in Google Docs" opens that tab.',
    how: 'Open any task. Name each tab with its ID, or link the tab itself in the sheet (its link ends in ?tab=…).',
    changed: 'Before, the preview always showed the Doc\'s first tab, which could be another script\'s brief.'
  },
  {
    id: '2026-11-19-labels', date: '2026-11-19', kind: 'fixed', who: 'all', go: 'tasks', title: 'Links written as names are recognised',
    what: 'Creative, Open File and content links that show a name in the sheet (like "Meta - Polo (SRAP23)") now count as added.',
    does: 'The dashboard reads the link behind the name, whether it is a hyperlink, a Drive file chip or a HYPERLINK formula.',
    how: 'Nothing to do. In the task window, a cell with only text and no link says "Text only in the sheet", so you know to add the link.',
    changed: 'Before, these tasks showed "No link in the sheet" and "0 of 3 added".'
  },
  {
    id: '2026-11-19-contrast', date: '2026-11-19', kind: 'improved', who: 'all', title: 'Easier to read in Light and Dark mode',
    what: 'Every text, button, icon and label was checked for contrast in both themes, and the weak ones were fixed.',
    does: 'Buttons on dark notes, counts on selected tabs, badges, placeholders and faded text are all clearly readable now.',
    how: 'Switch themes with the sun or moon button at the top; both are designed together.',
    changed: 'Ink-coloured notes no longer show light buttons on white. Gradients on cards were replaced with flat colours.'
  },
  {
    id: '2026-11-19-saves', date: '2026-11-19', kind: 'fixed', who: 'all', go: 'tasks', title: 'Saving task changes is reliable',
    what: 'Assigning a task, changing its ETA or status, and every other task edit now saves first time.',
    does: 'Only what you changed is sent. If Google Sheets is busy, the dashboard retries by itself and tells you "still saving".',
    how: 'Edit a task and click Save to sheet. The window closes at once and the change shows straight away; "Saved" confirms it.',
    changed: 'Assigning a task that was waiting on its brief used to fail with "changes were not saved". That is fixed.'
  },
  {
    id: '2026-11-19-filters', date: '2026-11-19', kind: 'improved', who: 'all', title: 'Filters you can always see',
    what: 'Any filter that is on is highlighted in violet and listed under "Filtering by".',
    does: 'Each filter can be removed with one click, or all at once with Clear all. Each section uses only the filters that apply to it.',
    how: 'Pick a sheet, designer, brand or type at the top of a page. Remove it with the × on its chip.',
    changed: 'My work is never emptied by a Designer filter left on elsewhere, and Notes, Issues and Access have no filter bar.'
  },
  {
    id: '2026-11-19-issues', date: '2026-11-20', kind: 'improved', who: 'page:issues', go: 'issues', title: 'Issues, grouped by what to do',
    what: 'The Issues page now sorts problems into three groups: Needs your action, Fix in the sheets or settings, and Fixing itself.',
    does: 'Each issue is one short row that names the task and shows what it tried to save (for example "Status → Under review"), with Retry or the fix next to it.',
    how: 'Click a group at the top to see only that group. Use Retry on a row, or "Retry all" for every failed save at once. Click a row for the full explanation. Temporary errors are folded away under Fixing itself.',
    changed: 'Before, every problem was a large card with technical wording and a long code line.'
  },

  {
    id: '2026-11-19-waiting', date: '2026-11-19', kind: 'new', who: 'page:brands', go: 'brands', title: 'Waiting on client, rebuilt',
    what: 'Everything that cannot move until a client replies: creatives shared for approval and briefs shared for sign-off.',
    does: 'Shows how long each item has waited, which brands have the oldest waits and who has not replied, with filters and search.',
    how: 'Open Brands: it is at the top of the page. Click a brand to see its items. Use "Copy follow-up" to copy a ready-to-send reminder with every pending item and link.',
    changed: 'Replaces the long list of brand boxes with one compact table and an age bar.'
  },
  {
    id: '2026-11-18-task-window', date: '2026-11-18', kind: 'improved', who: 'all', go: 'tasks', title: 'A cleaner task window',
    what: 'The task window is shorter and easier to scan.',
    does: 'Links are one list: missing ones are highlighted with their box open; added ones show quietly with Open and Replace.',
    how: 'Click any task. Paste a missing link and press Submit, or click Replace on an existing one.',
    changed: 'The brief can be collapsed, and status, ETA and designer sit in one row.'
  },
  {
    id: '2026-11-18-assign', date: '2026-11-18', kind: 'new', who: 'perm:assign', go: 'tasks', title: 'Assign with a people picker',
    what: 'Choose the designer or editor from a searchable list instead of typing a name.',
    does: 'Shows everyone on the team with their role. Admins also see how much open work each person has.',
    how: 'In a task, click the Designer field, type to search, and pick a name. Save to sheet.',
    changed: 'No more misspelled names that the sheet refuses.'
  },
  {
    id: '2026-11-18-calendar', date: '2026-11-18', kind: 'new', who: 'all', title: 'A new calendar for every date',
    what: 'One calendar for every date field: task ETAs, report ranges and packages.',
    does: 'Weeks start on Monday, today is marked, and report ranges are shaded. Quick picks: Today and Clear.',
    how: 'Click a date field or its calendar icon. Arrow keys move by day, Page Up and Down by month, Enter picks.',
    changed: 'Replaces the browser\'s own date picker, so it looks the same everywhere.'
  },
  {
    id: '2026-11-18-content-status', date: '2026-11-18', kind: 'improved', who: 'all', title: 'Content status names match the sheets',
    what: 'Content status "Pending" is now "Under review", and Internal\'s "TBD" is now "TBP".',
    does: 'The dashboard uses the same names as both sheets, everywhere.',
    how: 'Nothing to do. Older rows that still say Pending or TBD are read as the new names.',
    changed: 'Stand-up, the content writers\' counts and the status definitions all use the new names.'
  },
  {
    id: '2026-11-17-access', date: '2026-11-17', kind: 'improved', who: 'page:access', go: 'access', title: 'People with access, redesigned',
    what: 'A clearer list of everyone who can sign in.',
    does: 'Shows each person\'s level, how many sections they can open, and when they last signed in, with filters and search.',
    how: 'Open Access. Change a level in the row, or click Permissions to fine-tune sections and abilities.',
    changed: 'Adding a person is one line: email, level, sections, Give access.'
  }
];
