/* Applies the saved light/dark choice before the page paints. */
try { var t = localStorage.getItem('co.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* private mode */ }
