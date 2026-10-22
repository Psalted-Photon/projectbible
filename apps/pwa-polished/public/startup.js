// Runs before the app itself, so it can report what goes wrong while the app
// is still loading. A file rather than a script written into index.html: the
// Content-Security-Policy in vercel.json does not allow scripts in the page.

// The launch splash's first frame (#boot-splash in index.html) is drawn from
// the page itself, so something is on screen the moment the page is — Android
// keeps its own splash, the app icon on a square, up until the page draws.
// This runs before that frame and settles two things for it and for
// src/lib/launchSplash.ts, which takes it over:
//   data-ground  cream before noon, night after: the grounds of the wordmark
//                schedule in src/lib/wordmark.ts
//   data-boot    "skip" when the app was closed under two seconds ago (a fold
//                handing the app to the other screen): no splash at all
(function() {
  var root = document.documentElement;
  root.dataset.ground = new Date().getHours() < 12 ? 'cream' : 'night';
  try {
    var raw = localStorage.getItem('projectbible_session');
    var savedAt = raw ? JSON.parse(raw).savedAt : null;
    if (typeof savedAt === 'number' && Date.now() - savedAt < 2000) root.dataset.boot = 'skip';
  } catch (e) {
    // Blocked storage: the splash plays.
  }
})();

function hideBootSplash() {
  var boot = document.getElementById('boot-splash');
  if (boot) boot.remove();
}

// Global error handler
window.addEventListener('error', function(e) {
  hideBootSplash();
  document.getElementById('loading').innerHTML =
    '<h2 style="color: #f44336;">ERROR</h2>' +
    '<p style="margin-top: 20px; font-size: 16px;">' + e.message + '</p>' +
    '<p style="margin-top: 10px; font-size: 14px; color: #888;">' + e.filename + ':' + e.lineno + '</p>';
});

window.addEventListener('unhandledrejection', function(e) {
  hideBootSplash();
  document.getElementById('loading').innerHTML =
    '<h2 style="color: #f44336;">PROMISE ERROR</h2>' +
    '<p style="margin-top: 20px; font-size: 16px;">' + e.reason + '</p>';
});

// Hide loading message - check repeatedly until app mounts
var checkInterval = setInterval(function() {
  var app = document.getElementById('app');
  var loading = document.getElementById('loading');
  if (app && app.children.length > 0) {
    if (loading) loading.style.display = 'none';
    clearInterval(checkInterval);
  }
}, 100);

// Fallback: hide after 5 seconds regardless
setTimeout(function() {
  clearInterval(checkInterval);
  var loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';
}, 5000);

// Anything the Content-Security-Policy stops, or while it is report-only would
// have stopped, is written to the console once, starting "[CSP]". Eruda opens
// after launch, so App.svelte prints this list again once it is there.
window.__cspViolations = [];
document.addEventListener('securitypolicyviolation', function(e) {
  var line = '[CSP] ' + (e.disposition === 'report' ? 'would block ' : 'blocked ') +
    (e.blockedURI || 'inline code') + ' (' + e.effectiveDirective + ')' +
    (e.sourceFile ? ' from ' + e.sourceFile + ':' + e.lineNumber : '');
  if (window.__cspViolations.indexOf(line) !== -1) return;
  window.__cspViolations.push(line);
  console.warn(line);
});
