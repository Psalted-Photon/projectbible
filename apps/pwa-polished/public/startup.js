// Runs before the app itself, so it can report what goes wrong while the app
// is still loading. A file rather than a script written into index.html: the
// Content-Security-Policy in vercel.json does not allow scripts in the page.

// Global error handler
window.addEventListener('error', function(e) {
  document.getElementById('loading').innerHTML =
    '<h2 style="color: #f44336;">ERROR</h2>' +
    '<p style="margin-top: 20px; font-size: 16px;">' + e.message + '</p>' +
    '<p style="margin-top: 10px; font-size: 14px; color: #888;">' + e.filename + ':' + e.lineno + '</p>';
});

window.addEventListener('unhandledrejection', function(e) {
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
