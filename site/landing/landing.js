// The landing page's one script, external because the site runs under
// `script-src 'self'` (site/build.mjs refuses an inline one).
//
// Two jobs:
//
// 1. Old links keep working. Every link published before the landing page
//    existed pointed at the site root with the simple page's own vocabulary:
//    `?sc=iso&lat=2#ch-clocks`, `?pm=perf&lag=45#ch-app`, a `#cfg=` payload.
//    The root is a choice now, not a page, so a URL that carries a query or a
//    fragment is forwarded to the simple version with both intact -- the page
//    those links were written for. A bare `/` stays here and offers the choice.
//
// 2. The theme. Both versions store the reader's light/dark choice under the
//    same localStorage key and stamp it on <html data-theme>; this page does
//    the same so switching between them does not flash the other scheme.
(function () {
  var search = location.search;
  var hash = location.hash;
  if ((search && search !== '?') || (hash && hash !== '#')) {
    location.replace('simple/' + search + hash);
    return;
  }
  try {
    var theme = localStorage.getItem('dg-theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (e) {
    // private-mode Safari throws on localStorage; the system scheme is fine.
  }
})();
