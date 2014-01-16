var _ = require("underscore"),
    logger = require("./logging").getLogger();

module.exports = {
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
    // an express middleware that we apply to the entire site.
    // for some reason, that works better than applying it just to the
    // resources that actually need to be accessed cross domain.
    allowCrossDomain: function(domain) {
        return function(req, res, next) {
            res.header('Access-Control-Allow-Origin', domain);
            res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type');

            next();
        }
    },
    getSession: function(sessionId, events, permalinkSessions) {

        // logger.debug("sessionId: " + sessionId);
        // this is a bit silly, but we don't maintain a separate dedicated list of sessions,
        // and there's no easy way to map back from a session id to that session's event.
        // so, create a temporary list of sessions to look up against.
        var sessions = _.flatten(events.map(function(event) {
            return event.get("sessions").toArray();
        }));
        
        // add in the permalink sessions.
        sessions = _.union(sessions, permalinkSessions.toArray());
        var session = _.find(sessions, function(session) {

            if(_.isNull(session.get("session-key")) || _.isUndefined(session.get("session-key"))) {
                // logger.debug("ignoring session without a session key");
                return false;
            } else {
                // logger.debug("id: " + session.id + "; key: " + session.get("session-key") + " title: " + session.get("title"));
                // logger.debug(".id===id: " + (session.id===parseInt(sessionId) + "") + " : session-key===id: " + ("" + (session.get("session-key")===sessionId)));
            }

            // TODO try just doing the second clause here. why does the first one even exist?
            // return session.id===parseInt(sessionId) || session.get("session-key")===sessionId;
            return session.get("session-key")===sessionId;
        });

        // logger.debug("returning session: " + JSON.stringify(session));
        
        return session;
    }
}



