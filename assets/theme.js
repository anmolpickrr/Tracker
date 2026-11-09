/* Applies the theme before the page paints: the saved choice, else dark (the studio's default look). */
try { document.documentElement.dataset.theme = localStorage.getItem('co.theme') || 'dark'; } catch (e) { document.documentElement.dataset.theme = 'dark'; }
