// Runs before the page draws, so the chosen light/dark theme applies without a flash (kept out of the page itself
// so the Content Security Policy can forbid inline scripts).
try { var t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* storage blocked */ }
