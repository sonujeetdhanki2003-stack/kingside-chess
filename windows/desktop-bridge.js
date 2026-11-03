// Kingside Chess for Windows: marks the page as the desktop app (hides the web-only Google button and "Get the app" row).
(function () {
  document.documentElement.classList.add('in-app', 'in-desktop');
  window.__kingsideDesktop = true;
})();
