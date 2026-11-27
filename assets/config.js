/*
 * Public settings for this site. The web app addresses are not secrets: they serve no data
 * to anyone who has not signed in with an approved Google account (see README → Access and sign-in).
 */
window.CO_CONFIG = {
  // Data API used by the GitHub Pages copy (the old "Anyone" deployment; no longer reachable under the Workspace rule).
  webApp: 'https://script.google.com/macros/s/AKfycbzP5nZqk8GDs57IhDH5wKMGQukca6Kh55EtcmCnJ2frOUpEzl3wOXO6SI0j3E3TXmba/exec',
  // The dashboard served by Apps Script, one company-only copy per Google organisation (README → Company-only hosting).
  // This GitHub Pages address asks once which account the person uses and forwards them (?stay keeps you here).
  apps: [
    { org: 'Pickrr', domain: 'pickrr.com', url: 'https://script.google.com/a/macros/pickrr.com/s/AKfycbx8xvohhaB7jNREyFxOT-7hC5tza6-iQUqTDNOlHcKPmQVchiph_fPlIXeorFmxEX0D/exec' },
    { org: 'Shiprocket', domain: 'shiprocket.com', url: 'https://script.google.com/a/macros/shiprocket.com/s/AKfycbxzeJ9hQqM6d-BB4F8FfMbqMlxhJTqwMBJsrsrLbovwi0WAlxXs2IJyL1jG6xcOObR9/exec' }
  ]
};
(function () {
  try {
    var c = window.CO_CONFIG || {}, apps = (c.apps || []).filter(function (a) { return a.url; });
    if (window.CO_GAS || !apps.length || /[?&]stay\b/.test(location.search)) return;
    var KEY = 'co.org', saved = ''; try { saved = localStorage.getItem(KEY) || ''; } catch (e) { saved = ''; }
    var hit = apps.filter(function (a) { return a.domain === saved; })[0];
    if (/[?&]switch\b/.test(location.search)) hit = null;
    if (hit) { location.replace(hit.url); return; }
    // Ask once: which Google account do you use for work?
    var go = function () {
      document.documentElement.setAttribute('data-org-pick', '1');
      var box = document.createElement('div'); box.className = 'org-pick'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Choose your company account');
      var h = '<div class="org-card"><b class="org-t">Open Creative Ops</b><p class="org-s">Which Google account do you use for work? We will remember your choice on this device.</p><div class="org-btns">';
      (c.apps || []).forEach(function (a) { h += '<button type="button" class="org-b" data-d="' + a.domain + '"' + (a.url ? '' : ' disabled') + '><span>' + a.org + '</span><small>@' + a.domain + (a.url ? '' : ' · coming soon') + '</small></button>'; });
      h += '</div><p class="org-n">Pick the company of the Google account you sign in with (@pickrr.com or @shiprocket.com). Picked the wrong one, or see "Sorry, unable to open the file"? Open this page with ?switch at the end of the address to choose again. Opens best in a window where your work account is the first Google account signed in.</p></div>';
      box.innerHTML = h; document.body.appendChild(box);
      box.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.org-b'); if (!b || b.disabled) return; var a = (c.apps || []).filter(function (x) { return x.domain === b.getAttribute('data-d'); })[0]; try { localStorage.setItem(KEY, a.domain); } catch (er) { /* ignore */ } location.replace(a.url); });
      var f = box.querySelector('.org-b:not([disabled])'); if (f) f.focus();
    };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  } catch (e) { /* stay here */ }
})();
