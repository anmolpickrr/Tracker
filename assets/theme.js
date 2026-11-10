/* Applies the theme before the page paints. Automatic by default: the Day (light) theme between sunrise and sunset in
   India, the Night (dark) theme after dark. Clicking the theme button overrides it until the next sunrise or sunset. */
(function () {
  // Approximate sunrise and sunset (IST, minutes after midnight) for north India, by month.
  var SUN = [[430, 1060], [418, 1085], [393, 1105], [362, 1123], [338, 1140], [327, 1155], [335, 1155], [352, 1135], [368, 1102], [383, 1068], [403, 1040], [423, 1040]];
  function ist() { var p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); return { m: +p.month - 1, mins: +p.hour * 60 + +p.minute }; }
  function autoTheme() { var t = ist(), s = SUN[t.m]; return t.mins >= s[0] && t.mins < s[1] ? 'light' : 'dark'; }
  function current() {
    try {
      var o = localStorage.getItem('co.theme'), until = +localStorage.getItem('co.themeUntil') || 0;
      if (o && until && Date.now() < until) return o;          // manual choice still valid
      if (o && !until) { localStorage.removeItem('co.theme'); } // older saved choice: go automatic
    } catch (e) { /* private mode */ }
    return autoTheme();
  }
  // Next sunrise or sunset from now, so a manual choice lasts until the light changes.
  function nextChange() { var t = ist(), s = SUN[t.m], mins = t.mins < s[0] ? s[0] - t.mins : t.mins < s[1] ? s[1] - t.mins : 1440 - t.mins + s[0]; return Date.now() + mins * 60000; }
  window.COTHEME = { autoTheme: autoTheme, current: current, nextChange: nextChange, isDay: function () { return autoTheme() === 'light'; } };
  document.documentElement.dataset.theme = current();
})();
