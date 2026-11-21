/* What's new: every dashboard update, newest first. Add an entry with each release (see README, "What's new").
   id: unique and stable (it marks what each person has seen). date: YYYY-MM-DD (IST). kind: new | improved | fixed.
   who: 'all', or 'page:<section>' (only people who can open that section), or 'perm:<permission>', or 'admin'.
   go: the section the "Open" button takes you to (optional). Write for the people using the dashboard: plain words. */
window.CO_WHATSNEW = [
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
