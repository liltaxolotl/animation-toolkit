// ============================== FIGURE 3D: loader ==============================
// The 3D figure is an ES module with real 3D files, which browsers only load from a server. The first time the
// Figure 3D tab opens (or another tab asks for the figure), this loads app/js/figure-ui.mjs. window.Fig3D appears then.
const FigureTab = (() => {
  let loading = null;
  function load() {
    if (loading) return loading;
    if (location.protocol === 'file:') {
      const off = $('#fOff'); off.style.display = 'flex';
      off.innerHTML = '<b>The 3D figure needs the toolkit shortcut</b>Browsers will not load 3D models from a double-clicked file.<br>Open the app with the Animation Toolkit shortcut, or run <b>python serve.py</b> in the toolkit folder.<br>Everything else works from here as usual.';
      return (loading = Promise.resolve(null));
    }
    return (loading = import(new URL('app/js/figure-ui.mjs', location.href).href).then(m => m.start()).catch(e => {
      const off = $('#fOff'); off.style.display = 'flex'; off.innerHTML = '<b>The 3D figure did not load</b>' + String(e && e.message || e).replace(/</g, '&lt;'); console.error(e); return null;
    }));
  }
  $('#tabs .tab[data-mode="figure"]').addEventListener('click', () => load());
  return { load };
})();
