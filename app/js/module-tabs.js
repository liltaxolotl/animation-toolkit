// ============================== MODULE TABS: loader ==============================
// Tabs written as ES modules (Pose match first; the board, redline and fix-it tabs use the same door) load the first
// time they open, or when another tab asks for one. Like the 3D figure they need the toolkit server, because browsers
// do not load modules from a double-clicked file.
//   ModTabs.get('pose') -> Promise of that tab's API (what its start(section) returns), or null with a note on the tab.
// Each module exports start(sectionEl), builds its own markup inside #mode-<name>, and is started only once.
const ModTabs = (() => {
  const FILES = { pose: 'app/js/pose-tab.mjs', redline: 'app/js/redline-tab.mjs' };
  const loading = {};
  const note = (sec, title, body) => { sec.innerHTML = '<div class="soon" style="display:flex;flex-direction:column;justify-content:center"><b>' + title + '</b>' + body + '</div>'; };
  function get(mode) {
    if (loading[mode]) return loading[mode];
    const sec = $('#mode-' + mode), file = FILES[mode];
    if (!sec || !file) return Promise.resolve(null);
    if (location.protocol === 'file:') {
      note(sec, 'This tab needs the toolkit shortcut', 'Browsers will not load it from a double-clicked file.<br>Open the app with the Animation Toolkit shortcut, or run <b>python serve.py</b> in the toolkit folder.<br>Every other tab works from here as usual.');
      return (loading[mode] = Promise.resolve(null));
    }
    return (loading[mode] = import(new URL(file, location.href).href).then(m => m.start(sec)).catch(e => {
      note(sec, 'This tab did not load', String(e && e.message || e).replace(/</g, '&lt;')); console.error(e); return null;
    }));
  }
  for (const mode in FILES) { const t = $('#tabs .tab[data-mode="' + mode + '"]'); if (t) t.addEventListener('click', () => get(mode)); }
  return { get, FILES };
})();
