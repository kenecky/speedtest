// Kleine Bedien-Helfer: Einstellungen schließen, Pull-to-Refresh.

/** Schließt <details> bei Klick/Tipp außerhalb (der Klick löst sonst nichts aus) und mit Esc. */
export function closeOnOutsideClick(details) {
  let swallow = false;
  document.addEventListener('pointerdown', e => {
    swallow = details.open && !details.contains(e.target);
    if (swallow) details.open = false;
  }, true);
  // den zugehörigen Klick schlucken, damit z. B. „Start“ nicht ungewollt losgeht
  document.addEventListener('click', e => {
    if (!swallow) return;
    swallow = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && details.open) details.open = false;
  });
}

/**
 * Nach unten wischen lädt die Seite neu – aber nur, wenn der Finger
 * im oberen Viertel des Bildschirms aufgesetzt wird.
 */
export function pullToRefresh(indicator, { zone = 0.25, threshold = 70, max = 110, canStart = () => true, onRefresh }) {
  let start = null;   // {x, y}
  let pull = 0;
  let active = false;

  const paint = () => {
    indicator.style.transform = `translateY(${pull - 50}px) rotate(${pull * 3}deg)`;
    indicator.style.opacity = Math.min(1, pull / (threshold * 0.6));
    indicator.classList.toggle('ready', pull >= threshold);
  };

  const reset = () => {
    indicator.classList.add('back');
    indicator.classList.remove('ready');
    indicator.style.transform = '';
    indicator.style.opacity = '';
    pull = 0;
  };

  addEventListener('touchstart', e => {
    start = null;
    if (e.touches.length !== 1 || !canStart(e)) return;
    const t = e.touches[0];
    if (t.clientY > innerHeight * zone) return;
    start = { x: t.clientX, y: t.clientY };
    active = false;
    indicator.classList.remove('back');
  }, { passive: true });

  addEventListener('touchmove', e => {
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (!active) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) { start = null; return; } // seitlich -> ignorieren
      if (dy < 8) return;
      active = true;
    }
    pull = Math.max(0, Math.min(max, dy * 0.55)); // Widerstand
    paint();
  }, { passive: true });

  const end = () => {
    if (!start) return;
    start = null;
    if (active && pull >= threshold) {
      indicator.classList.add('back', 'spin');
      indicator.style.transform = 'translateY(24px)';
      indicator.style.opacity = '1';
      setTimeout(onRefresh, 250);
    } else {
      reset();
    }
    active = false;
  };
  addEventListener('touchend', end);
  addEventListener('touchcancel', () => { start = null; active = false; reset(); });
}
