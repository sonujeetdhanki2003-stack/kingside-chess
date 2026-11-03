// Kingside Chess Android app: connects the page to the phone (share sheet, clipboard, back button).
(function () {
  var N = window.KingsideNative;
  if (!N) return;
  document.documentElement.classList.add('in-app');
  try {
    Object.defineProperty(navigator, 'share', { configurable: true, value: function (d) {
      d = d || {};
      N.share([d.text, d.url].filter(Boolean).join(' '));
      return Promise.resolve();
    } });
  } catch (e) {}
  try {
    var clip = { writeText: function (t) { N.copy(String(t)); return Promise.resolve(); } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clip });
  } catch (e) {}
  // Back button: close the topmost open sheet / promotion picker / draw-offer bar. Returns true if it closed something.
  window.__kingsideBack = function () {
    var promo = document.getElementById('promo');
    if (promo && !promo.hidden) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    }
    var open = Array.prototype.filter.call(document.querySelectorAll('.sheet-backdrop'), function (b) { return !b.hidden; });
    if (open.length) {
      var top = open[open.length - 1];
      var close = top.querySelector('[id$="-close"], [id$="-cancel"], [id$="-done"], #confirm-no');
      if (close) close.click(); else top.hidden = true;
      return true;
    }
    // full-screen views (review, puzzles, profile, quick-match search) step back first
    if (window.__kingsideViewBack && window.__kingsideViewBack()) return true;
    // the Tournaments screen steps back inside itself, then closes
    if (window.__kingsideTBack && window.__kingsideTBack()) return true;
    return false;
  };
})();
