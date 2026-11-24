/*
 * Public settings for this site. The web app address is not a secret: it serves no data
 * to anyone who has not signed in with an approved Google account (see README → Access and sign-in).
 */
window.CO_CONFIG = {
  // The dashboard served by Apps Script (shared with "Anyone within" the organisation). When set, this GitHub Pages
  // address forwards everyone there (add ?stay to the address to stay here, e.g. for testing).
  appUrl: 'https://script.google.com/a/macros/pickrr.com/s/AKfycbx8xvohhaB7jNREyFxOT-7hC5tza6-iQUqTDNOlHcKPmQVchiph_fPlIXeorFmxEX0D/exec',
  webApp: 'https://script.google.com/macros/s/AKfycbzP5nZqk8GDs57IhDH5wKMGQukca6Kh55EtcmCnJ2frOUpEzl3wOXO6SI0j3E3TXmba/exec'
};

(function () {
  try {
    var c = window.CO_CONFIG || {};
    if (c.appUrl && !window.CO_GAS && !/[?&]stay\b/.test(location.search)) location.replace(c.appUrl);
  } catch (e) { /* stay here */ }
})();
