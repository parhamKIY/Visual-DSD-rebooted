const storageKey = 'visual-dsd.panes.v1';

export function installPaneLayout(workbench, divider) {
  let requested = 50, dragging = null;
  try { const saved = Number(localStorage.getItem(storageKey)); if (saved >= 20 && saved <= 80) requested = saved; } catch { /* Layout remains usable without browser storage. */ }
  const desktop = matchMedia('(min-width: 951px)');
  function limits() {
    const available = workbench.getBoundingClientRect().width - divider.getBoundingClientRect().width;
    const min = Math.min(50, Math.max(20, 280 / Math.max(1, available) * 100));
    return [min, 100 - min];
  }
  function apply(percent = requested, save = false) {
    if (!desktop.matches) return;
    const [min, max] = limits(), actual = Math.min(max, Math.max(min, percent));
    workbench.style.setProperty('--editor-share', `${actual}fr`);
    workbench.style.setProperty('--result-share', `${100 - actual}fr`);
    divider.setAttribute('aria-valuemin', String(Math.ceil(min)));
    divider.setAttribute('aria-valuemax', String(Math.floor(max)));
    divider.setAttribute('aria-valuenow', String(Math.round(actual)));
    if (save) { requested = actual; try { localStorage.setItem(storageKey, String(actual)); } catch { /* Optional preference. */ } }
  }
  function move(event) {
    const box = workbench.getBoundingClientRect(), grip = divider.getBoundingClientRect().width;
    apply((event.clientX - box.left - grip / 2) / (box.width - grip) * 100, true);
  }
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !desktop.matches) return;
    dragging = event.pointerId; divider.setPointerCapture(dragging); workbench.classList.add('resizing'); move(event);
  });
  divider.addEventListener('pointermove', event => { if (dragging === event.pointerId) move(event); });
  function stop(event) { if (dragging === event.pointerId) { dragging = null; workbench.classList.remove('resizing'); } }
  divider.addEventListener('pointerup', stop); divider.addEventListener('pointercancel', stop); divider.addEventListener('lostpointercapture', stop);
  divider.addEventListener('dblclick', () => apply(50, true));
  divider.addEventListener('keydown', event => {
    const value = Number(divider.getAttribute('aria-valuenow'));
    const next = { ArrowLeft: value - 5, ArrowRight: value + 5, Home: 20, End: 80, Enter: 50 }[event.key];
    if (next !== undefined) { event.preventDefault(); apply(next, true); }
  });
  new ResizeObserver(() => apply()).observe(workbench);
  desktop.addEventListener('change', () => apply()); apply();
}
