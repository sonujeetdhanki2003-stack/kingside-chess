// Kingside Chess - itch.io browser build.
// The game files come from itch.io; online play, accounts and tournaments talk to the live server.
(function () {
  var SITE = 'https://sonujeet-chess.sites.tab.bot';
  window.__kingsideItch = true;
  window.__kingsideSite = SITE;
  document.documentElement.classList.add('in-app', 'in-itch');
  var f = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      if (typeof input === 'string' && input.indexOf('/api/') === 0) input = SITE + input;
      else if (input && typeof input === 'object' && input.url && input.url.indexOf(location.origin + '/api/') === 0) input = new Request(SITE + input.url.slice(location.origin.length), input);
    } catch (e) {}
    return f(input, init);
  };
  if (navigator.sendBeacon) {
    var sb = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (u, d) { if (typeof u === 'string' && u.indexOf('/api/') === 0) u = SITE + u; return sb(u, d); };
  }
})();
