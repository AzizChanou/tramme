// The key vault's page has its own storage: the editor tells it, in its
// address, the language and the theme to show the keys in, and its layout
// (the frame is narrower than the window). Imported first, before the texts
// are chosen.

if (new URLSearchParams(location.search).get('layout') === 'compact') document.documentElement.classList.add('compact');

try {
  const q = new URLSearchParams(location.search), key = 'tramme.preferences';
  const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
  const language = q.get('lang'), theme = q.get('theme');
  localStorage.setItem(key, JSON.stringify({ ...saved, ...(language ? { language } : {}), ...(theme ? { theme } : {}) }));
} catch { /* no storage: the browser's language, the default theme */ }
