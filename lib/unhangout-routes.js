var _ = require("underscore"),
    passport = require("passport"),
    logger = require("./logging").getLogger(),
    models = require("./server-models"),
    farming = require('./hangout-farming.js'),
    utils = require("./utils"),
    googleapis = require('googleapis'),
    moment = require("moment-timezone");
    mandrill = require("mandrill-api");
    async = require("async");

var ensureAuthenticated = utils.ensureAuthenticated;

module.exports = {

    route: function(app, db, options) {
        var followup = require("./followup-emails")(db, options);

        // Local middleware to check if someone is an event admin.
        function ensureEventAdmin(req, res, next) {
            var event = db.events.get(req.params.id)
            if (!event) {
                return res.send(404, "Not found");
            }
            if (req.user.isAdminOf(event)) {
                return next();
            }
            res._errorReason = "not an admin of event";
            return res.redirect(302, "/")
        }
        // routing for the homepage
        app.get("/", function(req, res) {
            res.render('index.ejs', {
                user: req.user,
                spreadsheetKey: options.UNHANGOUT_EVENTS_SPREADSHEET
            });
        });

        app.get("/events/", function(req, res) {
            res.render('events.ejs', {
                user: req.user,
                spreadsheetKey: options.UNHANGOUT_EVENTS_SPREADSHEET
            });
        });

        app.get("/about/", function(req, res) {
            res.render('about.ejs', {user: req.user});
        });

        app.get("/faq/", function(req, res) {
            res.render('faq.ejs', {user: req.user});
        });

        app.get("/how-to-unhangout/", function(req, res) {
            res.render('how-to-unhangout.ejs', {user: req.user});
        });

        // routing for events
        // make sure they're authenticated before they join the event.
        app.get("/event/:id", function(req, res) {
            // we'll accept either event ids OR shortName fields, for more readable
            // urls.
            var event, context;
            event = db.events.get(req.params.id) || db.events.findWhere({
                shortName: req.params.id
            });
            if (!event) {
                return res.send(404, "404 Not Found");
            }
            context = {user: req.user, event: event, title: event.get("title")};

            var template;
            var isOverflowed = event.get("connectedUsers").length >= event.get("overflowUserCap");
            var wantsOverflow = !!req.query.overflow;
            var isOpen = event.get("open");
            var isAuthenticated = req.isAuthenticated();
            var isAdmin = isAuthenticated && req.user.isAdminOf(event);
            if ((isAdmin && wantsOverflow) || (!isAdmin && isAuthenticated && isOpen && isOverflowed)) {
                // Show overflow if it's an admin requesting to see it
                // explicitly, or if they're logged in, the event is running, and
                // it's overflowed.
                context.title += " - Overflow";
                res._errorReason = "overflow";
                template = "event-overflow.ejs";
            } else if (isAdmin || (isAuthenticated && isOpen)) {
                // Show the regular event page if it's an admin or they're
                // authed and the event is running.
                template = "event.ejs";
            } else {
                // Show the static event page to unauthenticated people or if
                // the event is closed.
                template = "event-static.ejs";
            }

            return res.render(template, context);
        });

        // Call this route to explicitly log in for an event. That way event
        // pages can show an un-authenticated "about" page (without using
        // "ensureAuthenticated" middleware), but the big login button there
        // can return them to the event.  This is safer than using a
        // user-provided redirect url.
        app.get("/event/:id/auth/", function(req, res) {
            var event = db.events.get(req.params.id) || db.events.findWhere({
                shortName: req.params.id
            });

            if (!event) { return res.send(404, "Not found"); }
            if (req.isAuthenticated()) {
                return res.redirect(302, event.getEventUrl());
            } else {
                req.session["post-auth-path"] = event.getEventUrl();
                return res.redirect(302, "/auth/google");
            }
        });

        app.get("/event/:id/create-hoa/", ensureAuthenticated, ensureEventAdmin, function(req, res) {
            // Set up a YouTube data API request to determine the Google Plus
            // ID associated with a user's youtube channel.  If they don't have
            // one, Google will prompt them to create one in the next step.
            // The ONLY reason we're doing this dance is so users can choose a
            // YouTube channel distinct from their personal account with which
            // to create the hangout, if they have one.  Users who don't have
            // any channel associated with G+ will be prompted to create one
            // with reasonably clear instructions.
            var oauth2Client = new googleapis.OAuth2Client(
                options.UNHANGOUT_GOOGLE_CLIENT_ID,
                options.UNHANGOUT_GOOGLE_CLIENT_SECRET,
                options.baseUrl + "/event/create-hoa/callback");
            var url = oauth2Client.generateAuthUrl({
                acess_type: 'offline',
                scope: 'https://www.googleapis.com/auth/youtube.readonly'
            });
            // Temporarily store the oauth client and event ID on the user
            // object, for retrieval by the callback.  Google's oauth
            // implementation requires every callback URI to be registered
            // -- and this includes query args, so we can't put the event ID
            // in the URL.
            req.user._oauth2Client = oauth2Client;
            req.user._eventId = req.params.id;
            res.redirect(302, url);
        });
        app.get("/event/create-hoa/callback", utils.rejectUnlessAuthenticated, function(req, res) {
            // Retrieve the oauth2client / eventID state, and un-set it from
            // the user object, so we can query YouTube about the user's
            // channels.
            var oauth2Client = req.user._oauth2Client;
            delete req.user._oauth2Client;
            var eventId = req.user._eventId;
            delete req.user._eventId;

            if (!eventId) {
                return res.send(400, "Missing event ID.");
            }
            if (!oauth2Client) {
                // Go back to oauth land if we don't have an oauth client.
                return res.redirect(302, "/event/" + eventId + "/create-hoa/");
            }
            // Verify we're allowed to do this.
            var event = db.events.get(eventId);
            if (!event || !(event.userIsAdmin(req.user) || req.user.isSuperuser())) {
                return res.send(403, "Permission denied.");
            }
            oauth2Client.getToken(req.query.code, function(err, token) {
                if (err) {
                    res.send(500, "Error getting token.");
                    logger.error("Error getting YouTube token to validate HoA creator", err);
                    return;
                }
                oauth2Client.credentials = token;
                googleapis.discover('youtube', 'v3').execute(function(err, client) {
                    client.youtube.channels.list({
                        part: "contentDetails",
                        mine: true
                    }).withAuthClient(oauth2Client).execute(function(err, data) {
                        if (err) {
                            res.send(500, "Error listing channel info.");
                            logger.error("Error listing channel info", err);
                            return;
                        }
                        var googlePlusUserId = (
                            data.items && data.items.length > 0 &&
                            data.items[0].contentDetails &&
                            data.items[0].contentDetails.googlePlusUserId
                        );
                        logger.analytics("create-hoa", {
                            user: req.user, event: event,
                            hasGooglePlusId: !!googlePlusUserId
                        })
                        var hoa = new models.ServerHoASession({});
                        hoa.event = event;
                        hoa.markHangoutPending(req.user);
                        hoa.save({}, {
                            success: function(model) {
                                // Set the hoa to the event, destroying a
                                // previous hoa if any.  We don't need to save
                                // here, because the hoa property isn't
                                // persisted on the event model -- the
                                // association is retrieved from the hoa's
                                // redis URL.
                                event.set("hoa", hoa);
                                // If the user doesn't have any youtube channel
                                // associated with G+, they will be prompted to
                                // connect one, and go through mobile phone
                                // authorization and all that jazz.

                                if (process.env.NODE_ENV === "production") {
                                    return res.redirect(302,
                                        "https://plus.google.com/hangouts/_/" +
                                        generateSessionHangoutGDParam(hoa, req.user, options) +
                                        "&hs=20&authuser=0&hso=0" +
                                        (googlePlusUserId ? "&eid=" + googlePlusUserId : ""));
                                } else {
                                    return res.redirect(302,
                                        "/test/hangout/" + model.id + "/?isHoA=1");
                                }
                            },
                            error: function(err) {
                                res._errorReason = err;
                                logger.error(err);
                                return res.send(500, "Error creating session.");
                            }
                        });
                    });
                });
            });
        });

        // the passport middleware (passport.authenticate) should route this request to
        // google, and not call the rendering callback below.
        app.get("/auth/google", passport.authenticate('google', {
                scope: [
                    'https://www.googleapis.com/auth/userinfo.profile',
                    'https://www.googleapis.com/auth/userinfo.email']
            }),
            function(req, res) {
                logger.warn("Auth request function called. This is unexpected! We expect this to get routed to google instead.");
            }
        );

        // after a user authenticates at google, google will redirect them to this url with
        // an authentication token that is consumed by passport.authenticate.
        app.get("/auth/google/callback", passport.authenticate('google'),
            function(req, res) {

                // if post-auth-path was set, send them to that path now that authentication
                // is complete.
                if("post-auth-path" in req.session) {
                    var path = req.session["post-auth-path"];
                    delete req.session["post-auth-path"];
                    res.redirect(path);
                } else {
                    res.redirect("/");
                }
                logger.analytics("users", {action: "login", user: req.user});
            }
        );

        app.get("/logout", function(req, res) {
            logger.analytics("users", {action: "logout", user: req.user});
            req.logout();
            res.redirect("/");
        });

        app.get("/hoa-session/:sessionKey", ensureAuthenticated, function(req, res) {
            var session = utils.getSession(req.params.sessionKey, db.events, db.permalinkSessions);
            if (!session) {
                return res.send(404, "404 Hangout not found");
            }
            // Only HOA sessions should be using this route.
            if (!(session.get("isHoA") && session.event)) {
                logger.error("/hoa-session/ request for non-hoa, sessionId: " + session.id);
                return res.redirect(302, "/session/" + req.params.sessionKey);
            }
            // Restrict to admins (we may change this requirement in the future).
            if (session.event && !req.user.isAdminOf(session.event)) {
                return res.send(403, "Permission denied");
            }

            // If we have a hangout URL, use it.
            var queryargs = generateSessionHangoutGDParam(session, req.user, options);
            if (session.get("hangout-url")) {
                session.addJoiningParticipant(req.user);
                return res.redirect(302, session.get("hangout-url") + queryargs);
            }
            if (session.isHangoutPending()) {
                return res.render("event-session-joining.ejs", {
                    type: "pending-hoa",
                    pendingUser: db.users.get(session.get("hangout-pending").userId),
                    pendingTime: session.get("hangout-pending").time,
                    session: session,
                    event: session.event
                });
            }
            return res.render("event-session-joining.ejs", {
                type: "create-hoa",
                session: session,
                event: session.event
            });
        });

        // this endpoint connects someone to the hangout for a particular
        // session. We use sessionKey instead of ID's here for a bit of
        // obfuscated authorization, so someone can't arbitrarily join a
        // session hangout that isn't started yet or that they're not supposed
        // to have access to. It's a little thing - anyone with access can send
        // the link to anyone else - but it's better than nothing.
        app.get("/session/:sessionKey", ensureAuthenticated, function(req, res) {
            var session = utils.getSession(req.params.sessionKey, db.events, db.permalinkSessions);
            var queryargs = generateSessionHangoutGDParam(session, req.user, options);
            if(!session) {
                return res.send(404, "404 Not Found");
            }
            // Hangouts-on-air require different logic because they can't be farmed.
            if (session.get("isHoA")) {
                logger.error("/session/ request for a hoa, sessionId: " + session.id);
                return res.redirect("/hoa-session/" + req.params.sessionKey);
            }

            // If this is an event hangout and full, show a friendly
            // event-specific error.  If it's a permalink session, let them
            // encounter google's error instead.
            var numAttendees = (session.getNumConnectedParticipants() +
                                session.get("joiningParticipants").length);
            if (!session.get("isPermalinkSession") && numAttendees >= session.MAX_ATTENDEES) {
               return res.render("event-session-joining.ejs", {
                   type: "session-full",
                   session: session,
                   event: session.collection.event
               });
            }

            // All set to start trying to join!
            session.addJoiningParticipant(req.user);

            // Non-production requests get redirected to a mock hangout.
            if (process.env.NODE_ENV !== "production") {
                return res.redirect(302,
                    "/test/hangout/" + session.id + generateTestSessionHangoutGDParam(session, req.user, options));
            }

            // THREE BIG OPTIONS HERE:
            //
            // 1. If the session is already running and has a hangout link
            //    populated, redirect to hangout.
            if(session.get("hangout-url")) {
                // append all the google hangout app info to enforce loading it on startup
                return res.redirect(302, session.get("hangout-url") + queryargs);
            }

            // 2. If the session doesn't have a hangout link, but does have
            //    someone pending on starting the hangout, stall and wait for
            //    that response
            if(session.isHangoutPending()) {
                // Increase the connection timeout so we don't get dropped while waiting.
                req.connection.setTimeout(models.ServerSession.prototype.HANGOUT_CREATION_TIMEOUT);
                // if it's pending, wait on the hangout-url event.
                //TODO: Would be nice to auto re-try here if we're timing out.
                return session.once("hangout-url", function(hangoutUrl) {
                    // when we get the hangout url, redirect this request to it.
                    return res.redirect(302, hangoutUrl + queryargs);
                });
            }

            // 3. If the session doesn't have a hangout link, and doesn't yet have
            //    a pending link, try using farmed one or send to the user to google
            //    to create one.
            //
            // If we have a farmed url available, prefer that significantly; it
            // resolves a bunch of our issues.  so check with the farming
            // module / redis to see if we can do that.  If that returns an
            // error, then do the fallback strategy, which is to get the first
            // person to click it to generate the session and have that session
            // phone home.
            farming.getNextHangoutUrl(function(err, farmedUrl) {
                if(err || farmedUrl==null) {
                    logger.error("Error: ran out of farmed hangout urls.", err);
                    // this branch is for the situation when there is no farmed
                    // hangout url available.

                    // if there isn't a pending request, this is the first user
                    // to hit this link. send them to google!
                    var result = session.markHangoutPending(req.user);
                    if (result) {
                        var fullUrl = "https://plus.google.com/hangouts/_" + queryargs;
                        return res.redirect(302, fullUrl);
                    } else {
                        logger.error("Error starting hangout", err);
                        return res.send(500, "Server error");
                    }
                } else {
                    // This may not actually set the hangout-url, if e.g. the
                    // session got set to a URL while the farmed URL was
                    // getting acquired.
                    session.setHangoutUrl(farmedUrl);
                    // So redirect to whatever the session currently has.
                    res.redirect(302, session.get("hangout-url") + queryargs);
                }
            });
        });

        app.post("/session/:id/stop", utils.ensureAuthenticated, utils.ensureSuperuser, function(req, res) {
            var session = db.permalinkSessions.get(req.params.id);
            if (!session) {
                for (var i = 0; i < db.events.models.length; i++) {
                    session = db.events.models[i].get("sessions").get(req.params.id);
                    if (session) {
                        break;
                    }
                }
            }
            if(!session) {
                res.send(404, "Not found");
                return;
            }
            session.onHangoutStopped()
            res.redirect("/admin");
        });

        app.post("/subscribe/", function(req, res) {
            // save subscription emails
            if("email" in req.body && req.body.email.length > 5 && req.body.email.length < 100) {
                //TODO: move any redis-specific stuff to unhangout-db.
                db.redis.lpush("global:subscriptions", req.body.email);
                res.status(200);
                res.send();
            } else {
                res.status(400);
                res.send();
            }
       });

        app.post("/admin-request/", utils.rejectUnlessAuthenticated, function(req, res) {
            var valid = (
                "eventTitle" in req.body && req.body.eventTitle.length >= 5 &&
                "eventDescription" in req.body && req.body.eventDescription.length >= 100
            )
            if(valid) {
                // Render the body of an email to send to UNHANGOUT_MANAGERS.
                res.render("admin-request-email.ejs", {
                    eventTitle: req.body.eventTitle,
                    eventDescription: req.body.eventDescription,
                    userEmail: req.user.get("emails")[0].value,
                    host: options.baseUrl
                }, function(err, html) {
                    if (err) {
                        logger.error("Error rendering email body", err);
                        return res.send(500, "Server error");
                    }
                    var mailOptions = {
                        from: options.UNHANGOUT_SERVER_EMAIL_ADDRESS,
                        to:   options.UNHANGOUT_MANAGERS,
                        subject: "Unhangout: Request for Admin Account",
                        html: html
                    };
                    db.smtpTransport.sendMail(mailOptions, function(err, response){
                        if (err) {
                            logger.error("Error sending email", err);
                            return res.send(500, "Server error");
                        }
                        logger.debug("Message sent");
                        return res.send(200, "");
                    });
                })
            } else {
                res.send(400, "");
            }
        });

        function showEventOverview(req, res, templateName) {
            var allowedEvents = db.events.filter(function(e) {
                return req.user.isAdminOf(e);
            });
            allowedEvents = _.sortBy(allowedEvents, function(e) {
                return -(e.get("start") || e.get("dateAndTime") || 0);
            });
            var permalinkSessions = null;
            if (req.user.isSuperuser()) {
                permalinkSessions = db.permalinkSessions.sortBy(function(s) {
                    return s.getNumConnectedParticipants() * -1;
                });
            }
            res.render(templateName, {
                user: req.user,
                events: allowedEvents,
                permalinkSessions: permalinkSessions,
                destination: req.url,
            });
        }

        app.get("/admin/", ensureAuthenticated, utils.ensureSuperuser, function(req, res) {
            showEventOverview(req, res, "admin.ejs");
        });

        app.get("/myevents/", ensureAuthenticated, function(req, res) {
            showEventOverview(req, res, "myevents.ejs");
        });

        app.get("/admin/users/", ensureAuthenticated, utils.ensureSuperuser, function(req, res) {
            // Organize events by the users that admin them, so we can display
            // a list of events each user admins.
            res.render('admin-users.ejs', {
                user: req.user,
                users: db.users.toJSON(),
                events: db.events.toJSON()
            });
        });
        // This method responds to ajax in the /admin/users/ page.
        app.post("/admin/users/", utils.rejectUnlessSuperuser, function(req, res) {
            var user, event;
            if (!req.body.action) {
                return res.send(400, "Missing `action`")
            }
            if (req.body.userId) {
                user = db.users.get(req.body.userId);
                if (!user) { return res.send(400, "Unrecognized user"); }
            } else if (req.body.email) {
                user = db.users.findByEmail(req.body.email);
            } else {
                return res.send(400, "No userId or email specified");
            }
            if (req.body.eventId) {
                event = db.events.get(req.body.eventId);
            }
            switch (req.body.action) {
                case 'set-superuser':
                    if (_.isUndefined(user)) {
                        return res.send(400, "Unknown user");
                    }
                    if (_.isUndefined(req.body.superuser)) {
                        return res.send(400, "Missing `superuser` parameter.");
                    }
                    var superuser = _.contains(["1", "true", 1, true], req.body.superuser);
                    user.set("superuser", superuser);
                    user.save()
                    db.users.add(user);
                    return res.send(200);
                case 'set-perms':
                    if (_.isUndefined(user)) {
                        return res.send(400, "Unknown user");
                    }
                    if (_.isUndefined(req.body.perms)) {
                        return res.send(400, "Missing `perms` parameter.");
                    }
                    try {
                        var perms = JSON.parse(req.body.perms);
                    } catch (e) {
                        return res.send(400, "Bad JSON for `perms` parameter.");
                    }
                    var permList = _.map(perms, function(val, key) { return key; });
                    var badPerms = _.filter(permList, function(key) {
                        return !_.contains(user.PERMISSION_KEYS, key);
                    });
                    if (badPerms.length > 0) {
                        return res.send(400, "Perms not recognized: " + badPerms.join(", "));
                    }
                    _.each(perms, function(val, key) {
                        user.setPerm(key, val);
                    });
                    user.save()
                    return res.send(200);
                case 'add-event-admin':
                    if (!event) {
                        return res.send(400, "Missing event.");
                    }
                    // undefined user happens only if user wasn't specified by
                    // ID, and has an unrecognized email address.
                    if (_.isUndefined(user)) {
                        user = {email: req.body.email};
                    }
                    event.addAdmin(user);
                    event.save();
                    return res.send(200);
                case 'remove-event-admin':
                    if (!event) { return res.send(400, "Missing event."); }
                    var user;
                    if (_.isUndefined(user)) {
                        user = {email: req.body.email};
                    }
                    event.removeAdmin(user);
                    event.save();
                    return res.send(200);
            }
            return res.send(400, "Unrecognized `action`");
        });

        //
        // Creating events
        //

        var _eventChangeNotificationTimeouts = {};
        var _eventChangeNotificationHandlers = {};
        function eventChangeNotification(event, user) {
            if (!event.id) {
                logger.error("Event change notification called with unsaved event.");
                return;
            }
            var warnings = utils.getEventSanitizationWarnings(event);

            // If there are no warnings, send no message.
            if (_.size(warnings) === 0) {
                if (_eventChangeNotificationTimeouts[event.id]) {
                    clearTimeout(_eventChangeNotificationTimeouts[event.id]);
                }
                delete _eventChangeNotificationTimeouts[event.id];
                delete _eventChangeNotificationHandlers[event.id];
                return;
            }

            // There are warnings, so notify managers. This is our present
            // abuse prevention strategy -- send an email to managers who check
            // to make sure the event details look ok. Delay sending to avoid
            // repeticious notifications.
            _eventChangeNotificationHandlers[event.id] = function () {
                app.render("admin-event-email.ejs", {
                    event: event, user: user, warnings: warnings
                }, function(err, html) {
                    if (err) {
                        return logger.error("Error rendering admin event email", err);
                    }
                    var mailOptions = {
                        from: options.UNHANGOUT_SERVER_EMAIL_ADDRESS,
                        to:   options.UNHANGOUT_MANAGERS,
                        subject: "Unhangout: Event " + event.id + " edited",
                        html: html
                    };
                    db.smtpTransport.sendMail(mailOptions, function(err, response) {
                        if (err) {
                            return logger.error("Error sending email", err);
                        }
                    });
                });
            }
            // Notify after delay.  Store a generic handler in ...Timeouts,
            // which does its work by calling the specific handler in
            // ...Handlers.  That way, the notification always executes with
            // the latest edit, but timeout after the earliest edit.
            if (!_eventChangeNotificationTimeouts[event.id]) {
                _eventChangeNotificationTimeouts[event.id] = setTimeout(function() {
                    if (_eventChangeNotificationHandlers[event.id]) {
                        _eventChangeNotificationHandlers[event.id]();
                    }
                    delete _eventChangeNotificationTimeouts[event.id];
                    delete _eventChangeNotificationHandlers[event.id];
                }, options.EVENT_EDIT_NOTIFICATION_DELAY);
            }
        }

        function updateEvent(event, attrs, user) {
            // A utility for both creating and editing events -- sanitize and
            // set given attributes.  If there's an error with an attribute,
            // returns a hash with: {<field name>: <error message> }
            //
            // Note that this updates the event (without saving) whether or not
            // there is an error.  So only call this method with a copy of the
            // event, rather than the instance from the in-memory database.
            var update = {};
            var error = {};
            _.each(["title", "organizer", "description", "overflowMessage"], function(key) {
                if (key in attrs) {
                    //update[key] = utils.sanitize(attrs[key]);
                    update[key] = attrs[key];
                }
            });
            if (!update.title)       { error.title = "A title is required."; }
            if (!update.description) { error.description = "A description is required."; }

            if (event.get("shortName") != attrs.shortName) {
                update.shortName = attrs.shortName || null;
                if (update.shortName) {
                    if (db.events.findWhere({shortName: attrs.shortName})) {
                        error.shortName = "That name is already taken.";
                    } else if (!/^[-A-Za-z0-9_]*$/.test(attrs.shortName)) {
                        error.shortName = "Only letters, numbers, - and _ allowed in event URLs."
                    } else if (/^[0-9]+$/.test(attrs.shortName)) {
                        // Prevent shadowing IDs with numeric short names.
                        error.shortName = "At least one letter is required."
                    }
                }
            }
            if (attrs.dateAndTime && attrs.timeZoneValue) {
                try {
                    // Parse date with timezone, and convert to UTC.
                    var date = moment.tz(attrs.dateAndTime,
                                      models.ServerEvent.prototype.DATE_DISPLAY_FORMAT,
                                      attrs.timeZoneValue).tz("UTC");
                } catch (e) {
                    date = null;
                }
                if (date && date.isValid()) {
                    update.dateAndTime = date.format();
                    update.timeZoneValue = attrs.timeZoneValue;
                } else {
                    error.dateAndTime = "Invalid date or timezone."
                }
            } else if (attrs.dateAndTime == "") {
                update.dateAndTime = null;
            }
            if (user.isSuperuser() && attrs.overflowUserCap != null) {
                var trimmed = ("" + attrs.overflowUserCap).trim();
                var cap = parseInt(trimmed);
                if (!/^\d+$/.test(trimmed) || isNaN(cap) || cap < 0) {
                    error.overflowUserCap = "Must be a number greater than or equal to zero.";
                } else {
                    update.overflowUserCap = cap;
                }
            }

            event.set(update);
            if (event.id) {
                eventChangeNotification(event, user);
            } else {
                // If we haven't been saved yet, notify after the ID is set.
                event.once("change:id", function(model) {
                    eventChangeNotification(model, user);
                });
            }
            return _.size(error) > 0 ? error : null;
        }

        app.get("/admin/event/new", ensureAuthenticated, utils.ensurePerm("createEvents"), function(req, res) {
            res.render('admin-event.ejs', {
                user: req.user,
                event: new models.ServerEvent(),
                errors: {}
            });
        });

        app.post("/admin/event/new", ensureAuthenticated, utils.ensurePerm("createEvents"), function(req, res) {
            // make sure title, description, and shortName are present,
            // otherwise reject the request.
            var event = new models.ServerEvent();
            var errors = updateEvent(event, req.body, req.user);
            if (_.size(errors) > 0) {
                return res.render('admin-event.ejs', {
                    user: req.user,
                    event: event,
                    errors: errors
                });
            }
            // Add the creator as an admin if they aren't a superuser.
            // Superusers are presumably creating events only on behalf of
            // others; whereas non-superusers are creating events for
            // themselves.
            if (!req.user.isSuperuser()) {
                event.addAdmin(req.user);
            }
            event.save({}, {
                success: function(model) {
                    db.events.add(model);
                    res.redirect(model.getEventUrl());
                },
                error: function(err) {
                    logger.error(err);
                    res.send(500, "Server error.");
                }
            });
        });

        //
        // Editing events
        //

        app.get("/admin/event/:id", ensureAuthenticated, ensureEventAdmin, function(req, res) {
            var event = db.events.get(req.params.id);
            res.render('admin-event.ejs', {
                user: req.user,
                event: event,
                errors: {},
                destination: req.query.destination || ""
            })
        });


        app.post("/admin/event/:id", ensureAuthenticated, ensureEventAdmin, function(req, res) {
            var event = db.events.get(req.params.id);
            var copy = new models.ServerEvent(event.attributes);
            var errors = updateEvent(copy, req.body, req.user);
            if (_.size(errors) > 0) {
                return res.render('admin-event.ejs', {
                    user: req.user,
                    event: copy,
                    errors: errors
                });
            }
            if (_.size(copy.changed) > 0) {
                var attributes = copy.attributes;
                // Remove any sub-models and sub-collections, by deleting any
                // attributes with a "get" function.  If we don't do this, sub-events
                // stop propagating.  See https://github.com/drewww/unhangout/issues/339
                for (var key in attributes) {
                    if (attributes[key] && _.isFunction(attributes[key].get)) {
                        delete attributes[key];
                    }
                }
                event.set(attributes);
                event.save();
                event.trigger("broadcast", event, "event-update", event.toClientJSON());
            }
            if (req.query.destination) {
              res.redirect(req.query.destination);
            }
            else {
              res.redirect(event.getEventUrl());
            }
        });

        //
        // Post-event followup emails: preview in browser and send.
        //

        app.get("/followup/event/:id/participant_:participantIndex", utils.ensureAuthenticated, utils.ensureSuperuser, function(req, res) {

            var context = followup.context(
              req.params.id,
              parseInt(req.params.participantIndex)
            );
            if (context === null) {
                res.send(404, "Not found");
            } else {
                res.render("post_event_followup_email_preview.ejs", context);
            }
        });

        app.post("/followup/event/:id/sent/", utils.ensureAuthenticated, utils.ensureSuperuser, function(req, res) {

            var event = db.events.get(req.params.id);
            if (!event) {
                return res.send(404, "Not found");
            }

            followup.renderAllEmails(res, event).then(function(htmlAndUsers) {
                return followup.sendEmails(htmlAndUsers);
            }).then(function(status) {
                var msg = "Sent " + status.sent + " out of " + status.total + ".";
                res.render(200, msg);
            }).catch(function(err, msg) {
                msg = msg || "Unspecified error in rendering or sending.";
                logger.error(err);
                res.render(500, msg);
            });
        });


        //
        // Starting and stopping events
        //

        app.post("/admin/event/:id/start", ensureAuthenticated, ensureEventAdmin, function(req, res) {
            var event = db.events.get(req.params.id);
            event.save({open: true});
            if (req.xhr) {
                res.send(200, "Success");
            } else {
                res.redirect("/admin/");
            }
            event.logAnalytics({action: "start", user: req.user});
        });

        app.post("/admin/event/:id/stop", ensureAuthenticated, ensureEventAdmin, function(req, res) {
            var event = db.events.get(req.params.id);
            event.save({open: false});
            if (req.xhr) {
                res.send(200, "Success");
            } else {
                res.redirect("/admin/");
            }
            event.logAnalytics({action: "stop", user: req.user});
        });


        app.get("/hangout/gadget.xml", function(req, res) {
            var context = {
                unhangoutBaseUrl: options.baseUrl
            }
            if (process.env.NODE_ENV !== "production") {
                context.mock = true;
                context.mockHangoutUrl = req.query.mockHangoutUrl || "test";
                context.mockAppData = "sessionId:" + (req.query.sessionId || "1");
                if (req.query.sockKey) {
                    context.mockAppData += ":sockKey:" + req.query.sockKey;
                    if (req.query.userId) {
                        context.mockAppData += ":userId:" + req.query.userId;
                    }
                }
                context.isHoA = req.query.isHoA === "1";
                if (req.query.mockUserIds) {
                    context.mockUsers = [];
                    _.each(req.query.mockUserIds.split(","), function(id){
                        var user = db.users.get(id);
                        if (user) {
                            context.mockUsers.push({
                                person: user.toJSON()
                            });
                        } else {
                            logger.error("User " + id + " not found.");
                        }
                    });
                } else {
                    context.mockUsers = [];
                }
            } else {
                context.mock = false;
            }
            res.setHeader("Content-Type", "application/xml");
            res.render("hangout-gadget-xml.ejs", context);
        });

        app.get("/facilitator/:sessionId/", function(req, res) {
            // Don't use `ensureAuthenticated` here.  We can't rely on 3rd
            // party coookies being transmitted.  Instead, we need to use
            // localStorage to identify users.  Even if the user is not
            // authenticated, we want to handle it gracefully in-app.  This is
            // shown only in iframes, so redirect-to-auth doesn't work.
            if (!req.params.sessionId || req.params.sessionId === "undefined") {
                return res.send(404, "Not found");
            }
            var session, event;
            session = db.events.getSessionById(req.params.sessionId);
            if (session) {
                // Get event from hoa session || regular event session.
                event = session.event || session.collection.event;
            } else {
                session = db.permalinkSessions.get(req.params.sessionId);
            }

            // Allows for the mock hangout to pass messages.
            var hangoutOriginRegex;
            if (process.env.NODE_ENV === "production") {
                hangoutOriginRegex = options.UNHANGOUT_HANGOUT_ORIGIN_REGEX;
            }
            else {
                hangoutOriginRegex = "^" + utils.quoteRegExp(options.baseUrl) + "$";
            }

            res.render("hangout-facilitator.ejs", {
                title: "Facilitator",
                session: session,
                event: event,
                baseUrl: options.baseUrl,
                hangoutOriginRegex: hangoutOriginRegex,
                user: req.user
            });
        });

        app.get("/youtube/video-data/:id", function(req, res) {
          // TODO: Replace this with a proper call to YouTube's v3 API.
          var url = "https://www.youtube.com/watch?v=" + encodeURIComponent(req.params.id);
          var callback = function(err, meta){
              if (err) {
                  res.status(500).send(err);
              }
              else {
                  var data = {
                    title: meta.title,
                    image: meta.image,
                  }
                  res.json(data);
              }
          }
          var og = require('open-graph');
          og(url, callback);
        });

        // Testing routes for use in development only.
        if (process.env.NODE_ENV !== "production") {
            // Render the contents of gadget.xml in the manner that google will.
            app.get("/test/hangout/gadgetcontents", function(req, res) {
                var libxmljs = require("libxmljs");
                var request = require("superagent");
                var gadgetUrl = options.baseUrl +
                    "/hangout/gadget.xml?sessionId=" + req.query.sessionId +
                        "&mockHangoutUrl=" + encodeURIComponent(req.query.mockHangoutUrl) +
                        "&mockUserIds=" + req.query.mockUserIds +
                        "&isHoA=" + req.query.isHoA +
                        (req.query.sockKey ? "&sockKey=" + req.query.sockKey : "") +
                        (req.query.userId ? "&userId=" + req.query.userId : "");
                // Allow self-signed certs for this mock -- see
                // https://github.com/visionmedia/superagent/issues/188
                var origRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
                process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
                request.get(gadgetUrl).buffer().end(function(xmlres) {
                    var xml = libxmljs.parseXml(xmlres.text);
                    var content = xml.get('/Module/Content').text()
                    res.send(content);
                    // Restore default SSL behavior.
                    process.env.NODE_TLS_REJECT_UNAUTHORIZED = origRejectUnauthorized;
                });
            });
            // Render a mock google hangout.
            app.get("/test/hangout/:sessionId/", function(req, res) {
                res.render("hangout-mock.ejs", {
                    sessionId: req.params.sessionId,
                    mockHangoutUrl: options.baseUrl + req.url.split("?")[0],
                    mockUserIds: req.query.mockUserIds || "",
                    isHoA: req.query.isHoA == "1" ? 1 : 0,
                    sockKey: req.query.sockKey,
                    userId: req.query.userId
                });
            });

            // Render the sanitization warnings for the given event.  Use this
            // route to work on the HTML a bit more easily than firing off
            // emails, but be warned that email clients aren't browsers and may
            // behave differently!
            app.get("/test/admin-event-email/:eventId/", utils.ensureAuthenticated, function(req, res) {
                var event = db.events.get(req.params.eventId);
                if (!event) {
                    return res.send(404, "Not found");
                }
                return res.render("admin-event-email.ejs", {
                    event: event,
                    user: req.user,
                    warnings: utils.getEventSanitizationWarnings(event)
                });
            });

            // Render the HTML for various error-states when joining breakout
            // sessions or HoA's in events.  'type' might be any of
            // "session-full", "create-hoa", "pending-hoa".
            app.get("/test/event-session-joining/:type/", utils.ensureAuthenticated, function(req, res) {
                var event = new models.ServerEvent({
                    id: "bogus1",
                    shortName: "fake1",
                    title: "Fake unsaved event"
                });
                var session = new models.ServerSession();
                var context = { event: event, session: session, type: req.params.type };
                switch (req.params.type) {
                    case "create-hoa":
                        session.set("isHoA", true);
                        break

                    case "pending-hoa":
                        session.set("isHoA", true);
                        session.markHangoutPending(req.user);
                        context.pendingUser = req.user;
                        context.pendingTime = session.get("hangout-pending").time - (60 * 1000 * 3);
                        break;
                }
                return res.render("event-session-joining.ejs", context);
            });
        }
        app.get("/");
    }
}

function generateSessionHangoutGDParam(session, user, options) {
    return "?gid="+options.UNHANGOUT_HANGOUT_APP_ID + "&gd=sessionId:" + session.id + ":sockKey:" + user.get("sock-key") + ":userId:" + user.id;
}

function generateTestSessionHangoutGDParam(session, user, options) {
    return "?sessionId=" + session.id + "&sockKey=" + user.get("sock-key") + "&userId=" + user.id + "&mockUserIds=" + user.id;
}
