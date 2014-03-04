// This module defines a workaround for browsers that don't allow 3rd-party
// cookies in iframes.  Don't require this directly, instead require `auth.js`
// to require regular cookie-based auth, or `auth-localstorage.js` to permit
// reading auth state from localStorage where cookies are not present.
//
// The HTML in top-level page loads should create an AUTH property if the
// user is authenticated with a transmitted cookie, e.g.:
//
//      <% if(!_.isUndefined(user)) { %>
//      var AUTH = {
//          SOCK_KEY: '<%= user.getSockKey() %>',
//          USER_ID: '<%= user.id %>',
//          USER_NAME: '<%= user.get("displayName").replace("'", "\\'") %>',
//      <% } %>
// Currently, 'views/_header.ejs' does this.
// 
// Requiring this module reads that AUTH state and persists it to localStorage.
// If the AUTH state doesn't exist, localStorage is cleared (assumed to have
// logged out).  However, if AUTH doesn't exist and
// window.USE_LOCALSTORAGE_AUTH is set, instead of clearing localStorage, AUTH
// is retrieved from it.
//
// For pages that you know to be bound in iframes that may be 3rd-party embedded,
// set `UNHANGOUT_USE_LOCALSTORAGE_AUTH = true` prior to requiring this module,
// and AUTH state will be retrieved from previously set localStorage.

define(["logger"], function(logging) {
    var exports = {};
    var logger = new logging.Logger("auth");
    if (window.UNHANGOUT_AUTH) {
        // Normal operation: just set the current auth state to local storage.
        exports.SOCK_KEY = window.UNHANGOUT_AUTH.SOCK_KEY;
        exports.USER_ID = window.UNHANGOUT_AUTH.USER_ID;
        exports.USER_NAME = window.UNHANGOUT_AUTH.USER_NAME;
        localStorage.setItem("UNHANGOUT_AUTH", JSON.stringify(exports));
    } else if (window.UNHANGOUT_USE_LOCALSTORAGE_AUTH) {
        // Explicitly marked cookie-less environment: read auth from localstorage.
        try {
            exports = JSON.parse(localStorage.getItem("UNHANGOUT_AUTH")) || {};
        } catch (e) {
            logger.error("JSON error parsing or reading local storage:", e);
            exports = {};
        }
    } else {
        // Not explicit cookie-less environment, without window.AUTH: clear
        // localStorage (e.g. we've been signed out).
        localStorage.removeItem("UNHANGOUT_AUTH");
    }
    return exports;
});
