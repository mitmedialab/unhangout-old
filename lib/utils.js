var _ = require("underscore"),
    sanitizer = require("caja-sanitizer"),
    toobusy = require("toobusy"),
    options = require("./options"),
    logger = require("./logging").getLogger();

// Configure maximum latency in the event loop.  See
// https://github.com/lloyd/node-toobusy for more.
toobusy.maxLag(options.MAX_EVENT_LOOP_LAG);

module.exports = {
    // Provide this access to our maxLag-configured instance of `toobusy`.
    toobusy: function() {
        return toobusy();
    },
    // Return 503's if we're over capacity.
    tooBusyMiddleware: function() {
        return function(req, res, next) {
            // whitelist URLs involved in setting up and maintaining sesions,
            // to ensure that the hangout app starts in those.
            if (/^\/(facilitator|session|hangout)/.test(req.path)) {
                next();
            }
            if (toobusy()) {
                res._errorReason = "over capacity";
                res.send(503, "Sorry, we're over capacity! Please try back later.");
            } else {
                next();
            }
        }
    },
    // redirect to login if unauthenticated.
    ensureAuthenticated: function (req, res, next) {
        if (req.isAuthenticated()) { return next(); }
        req.session["post-auth-path"] = req.path;
        res.redirect('/auth/google');
    },
    // send Permission Denied if unauthenticated.
    rejectUnlessAuthenticated: function (req, res, next) {
        return req.isAuthenticated() ? next() : res.send(403);
    },
    rejectUnlessSuperuser: function (req, res, next) {
        return req.user && req.user.isSuperuser() ? next() : res.send(403);
    },
    ensureSuperuser: function (req, res, next) {
        if(req.user.isSuperuser()) {
            next();
        } else {
            res._errorReason = "Not a superuser";
            res.send(401, "Permission denied");
        }
    },
    ensureAdmin: function (req, res, next) {
        if(req.user.isSuperuser() || req.user.isAdminOfSomeEvent()) {
            next();
        } else {
            res._errorReason = "Not an admin";
            res.send(401, "Permission denied");
        }
    },
    ensurePerm: function(perm) {
        return function(req, res, next) {
            if (req.isAuthenticated() && req.user.hasPerm(perm)) {
                next();
            } else {
                res._errorReason = "Lacks permission `" + perm + "`.";
                res.send(401, "Permission denied");
            }
        };
    },
    // Use this if we want to add CORS support for some reason in the future.
    // We used to do it for HTTP POST polling strategy for hangout session
    // apps, but not anymore (we now use socket connections).
    allowCrossDomain: function(domain) {
        return function(req, res, next) {
            res.header('Access-Control-Allow-Origin', domain);
            res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type');

            next();
        }
    },
    getSession: function(sessionKey, events, permalinkSessions) {
        // this is a bit silly, but we don't maintain a separate dedicated list of sessions,
        // and there's no easy way to map back from a session id to that session's event.
        // so, create a temporary list of sessions to look up against.
        // logger.debug("sessionKey: " + sessionKey);
        var allSessions = _.flatten(events.map(function(event) {
            var arr = event.get("sessions").toArray();
            if (event.get("hoa")) {
                arr.push(event.get("hoa"));
            }
            return arr;
        })).concat(permalinkSessions.toArray());

        return _.find(allSessions, function(session) {
            return session.get("session-key") === sessionKey;
        });
    },
    // Sanitize user-supplied HTML.  This uses a node packaging of Google's
    // Caja sanitizer.  
    sanitize: function(dirty) {
        return sanitizer.sanitize(dirty,
              // Allow all URI's, just pass-through.
              function uriPolicy(uri, effects, ltype, hints) {
                  // "effects" is a description of whether the URI loads in the
                  // same document, or a new document, or doesn't get loaded at
                  // all.  If it's the same document (e.g. an img embed)
                  // enforce that we don't mess up SSL with mixed content.
                  // effects values defined in html4.ueffects = {
                  //   'NOT_LOADED': 0,
                  //   'SAME_DOCUMENT': 1,
                  //   'NEW_DOCUMENT': 2
                  // };
                  if (effects == 1 && options.UNHANGOUT_USE_SSL && uri.getScheme() != "https") {
                      return null;
                  }
                  return uri;
              },
              // Prefix id/name/class tokens so that we don't break our local ID's.
              function tokenPolicy(tokens) {
                  return tokens.replace(/([^\s]+)(\s+|$)/g, function(_, id, spaces) {
                      return "userhtml-" + id + (spaces ? ' ' : '');
                  });
              },
              function logPolicy(msg, detail) {
                  if (detail.change === "removed") {
                      logger.warn("HTML sanitizer: " + msg, detail);
                  }
              }
        );
    }
}



