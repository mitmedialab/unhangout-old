var _ = require("underscore"),
    passport = require("passport"),
    logger = require("./logging").getLogger(),
    models = require("./server-models"),
    farming = require('./hangout-farming.js'),
    utils = require("./utils"),
    nodemailer = require("nodemailer");

var ensureAuthenticated = utils.ensureAuthenticated;
var ensureSuperuser = utils.ensureSuperuser;
var ensureAdmin = utils.ensureAdmin;
var getSession = utils.getSession;

module.exports = {

    route: function(app, db, options) {
        // Local middleware to check if someone is an event admin.
        function ensureEventAdmin(req, res, next) {
            var event = db.events.get(req.params.id)
            if (req.user.isAdminOf(event)) {
                return next();
            }
            res._errorReason = "not an admin of event";
            return res.redirect("/")
        }
        // routing for the homepage
        app.get("/", function(req, res) {
            res.render('index.ejs', {user: req.user});
        });

        app.get("/about/", function(req, res) {
            res.render('about.ejs', {user: req.user});
        });

        app.get("/how-to-unhangout/", function(req, res) {
            res.render('how-to-unhangout.ejs', {user: req.user});
        });
        
        // routing for events
        // make sure they're authenticated before they join the event.
        app.get("/event/:id", ensureAuthenticated, function(req, res) {
            // we'll accept either event ids OR shortName fields, for more readable
            // urls. 

            // lets figure out if it's an integer or not.
            var id;
            var e;
            // per http://stackoverflow.com/questions/1019515/javascript-test-for-an-integer
            var intRegex = /^\d+$/;
            if(intRegex.test(req.params.id)) {
                id = parseInt(req.params.id);
                e = db.events.get(id);
                logger.debug("Found event by id.");
            } else {
                // if the reg ex fails, try searching shortnames.
                // (this is inefficient, but still pretty darn cheap in
                //  node.)
                // side: we're assuming shortNames are unique, but I don't
                // think we actually enforce that anywhere. eeek.
                var eventsWithShortName = db.events.filter(function(event) {
                    if(event.has("shortName") && !_.isNull(event.get("shortName"))) {
                        return event.get("shortName").localeCompare(req.params.id)==0;
                    } else {
                        return false;
                    }
                });

                if(eventsWithShortName.length > 1) {
                    logger.warn("Found more than one event with the short name '" + req.params.id = "': " + JSON.stringify(eventsWithShortName));
                } else if(eventsWithShortName.length==1) {
                    e = eventsWithShortName[0];
                } else {
                    logger.warn(":id was not an integer, and specified short name was not found.");
                }
            }

            if(_.isUndefined(e)) {
                res.status(404);
                res.send("404 Not Found");
                return;
            }

            var context = {user:req.user, event:e, title: e.get("title")};
            if(!_.isUndefined(farming)) {
                context["numFarmedHangouts"] = farming.getNumHangoutsAvailable();
            }

            res.render('event.ejs', context);
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
        
        // this endpoint connects someone to the hangout for a particular
        // session.  the :id in this case is not an actual session id, instead
        // we use session-keys for this. (getSession checks for both) we do
        // this for authentication reasons, so someone can't arbitrarily join a
        // session hangout that isn't started yet or that they're not supposed
        // to have access to. It's a little thing - anyone with access can send
        // the link to anyone else - but it's better than nothing.
        app.get("/session/:id", ensureAuthenticated, function(req, res) {
            var session = getSession(req.params.id, db.events, db.permalinkSessions);
            var queryargs = generateSessionHangoutGDParam(session, options);
            if(!session) {
                return res.send(404, "404 Not Found");
            }
            // three options at this point:
            // 1. the session is already running and has a hangout link // populated -> redirect to hangout
            // 2. the session doesn't have a hangout link, but does have someone pending on starting the hangout -> stall, wait for response
            // 3. the session doesn't have a hangout link, and doesn't yet have a pending link -> send to google

            if(session.getHangoutUrl()) {
                // append all the google hangout app info to enforce loading it on startup
                return res.redirect(session.getHangoutUrl() + queryargs);
            }
            
            // TWO BIG OPTIONS HERE
            // If we have a farmed url available, prefer that significantly; it resolves a bunch of our issues.
            // so check with the farming module / redis to see if we can do that. 
            // If that returns an error, then do the fallback strategy, which is to get the first person to click it
            // to generate the session and have that session phone home.
            farming.getNextHangoutUrl(function(err, farmedUrl) {
                if(err || farmedUrl==null) {
                    logger.error("Error: ran out of farmed hangout urls.", err);
                    // this branch is for the situation when there is no farmed hangout url available.
                    if(session.isHangoutPending()) {
                        req.connection.setTimeout(20000);
                        logger.debug("session is pending, waiting on someone else to do it");
                        // if it's pending, wait on the hangout-url event.
                        //TODO: Would be nice to auto re-try here if we're timing out.
                        return session.once("hangout-url", function(hangoutUrl) {
                            logger.debug("issueing redirect to requests waiting for a hangout link to be created: " + hangoutUrl);
                            // when we get the hangout url, redirect this request to it.
                            res.redirect(hangoutUrl + queryargs);
                        });
                    }
                    
                    // if there isn't a pending request, this is the first user to hit this link. send them to google!
                    logger.debug("session " + req.params.id + " does not yet have a hangout, and is not pending. sending user " + _.isUndefined(req.user) ? "[id missing]" : req.user.id + " to go make a new hangout.");
                    var result = session.startHangoutWithUser(req.user);
                    if (result) {
                        logger.info(session.get("session-key"));
                        var fullUrl = "https://plus.google.com/hangouts/_" + queryargs;
                        logger.debug("redirecting to: " + fullUrl);
                        return res.redirect(fullUrl);
                    } else {
                        logger.error("Error starting hangout", err);
                        return res.send(500, "Server error");
                    }
                } else {
                    // double check that we haven't already set a url on this
                    // session this would happen if two requests came in
                    // identically and resolved first. 
                    if(!session.setHangoutUrl(farmedUrl)) {
                        // and push the url we were going to use back on the
                        // end of the queue.
                        farming.reuseUrl(farmedUrl);
                    }
                    res.redirect(session.getHangoutUrl() + queryargs);
                }
            });
        });

        app.post("/subscribe", _.bind(function(req, res) {
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
       }, this));

        app.post("/submit", _.bind(function(req, res) {
            logger.debug("POST /submit");

            if("event_title" in req.body && req.body.event_title.length >= 5
             && "event_description" in req.body && 
             req.body.event_description.length >=100) {
                //TODO: move any redis-specific stuff to unhangout-db.

                var smtpTransport = nodemailer.createTransport("SMTP", {
                    host: "localhost",
                    secureConnection: false,
                    port: 25
                });

                var mailOptions = {
                    from: req.user.get("emails")[0].value, // sender address
                    to: "srishakatux@gmail.com", // list of receivers
                    subject: "Unhangout: Request for Admin Account", 
                    html: "<b>Event Title:</b> " + req.body.event_title + 
                    "<b>Event Description:</b>" + req.body.event_description,
                }
                
                smtpTransport.sendMail(mailOptions, function(error, response){
                    if(error){
                        console.log(error);
                    }else{
                        console.log("Message sent: " + response.message);
                    }
                });

                res.status(200);
                res.send();
            } else {
                res.status(400);
                res.send();
            }

        }, this));

        app.get("/admin", ensureAuthenticated, _.bind(function(req, res) {
            var allowedEvents = db.events.filter(function(e) { return req.user.isAdminOf(e); });
            var sessions = _.flatten(_.map(allowedEvents, function(event) {
                if(event.isLive()) {
                    return event.get("sessions").toArray();
                } else {
                    return [];
                }
            }));
            if (req.user.isSuperuser()) {
                var sortedPermalinkSesssions = db.permalinkSessions.sortBy(function(s) {
                    return s.get("user-seconds") * -1;
                });

                sessions = sessions.concat(_.sortBy(sortedPermalinkSesssions, function(s) {
                    return s.getNumConnectedParticipants() * -1;
                }));
            }
            res.render('admin.ejs', {user:req.user, events:allowedEvents, sessions:sessions});
        }, this));

        app.get("/admin/users/", ensureAuthenticated, ensureSuperuser, function(req, res) {
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
                event = db.events.get(parseInt(req.body.eventId));
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
                case 'add-admin':
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
                case 'remove-admin':
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

        app.get("/admin/event/new", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
            var context = {user:req.user, events:db.events, create:true};
            res.render('admin-event.ejs', context);
        }, this));

        app.post("/admin/event/new", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
            // make sure title and description are present, otherwise reject the request.
            if(!("title" in req.body) || !("description" in req.body)) {
                res.status(400);
                res.send();
                return;
            }

            var event = new models.ServerEvent({title:req.body.title, shortName:req.body.shortName, description:req.body.description,
                    welcomeMessage:req.body.welcomeMessage, organizer:req.body.organizer});

            event.save();
            db.events.add(event);

            res.redirect("/admin");
        }, this));

        app.post("/admin/event/:id/start", ensureAuthenticated, ensureEventAdmin, _.bind(function(req, res) {
            var event = db.events.get(req.params.id);

            if(_.isUndefined(event)) {
                res.status(404);
                res.send("404 Not Found");
                return;
            };

            var err = event.start();

            if(err) {
                res.status(500);
                res._errorReason = err;
                res.send(err);
                return;
            }
            event.logAnalytics({action: "start", user: req.user});
            res.redirect("/admin/");
        }, this));

        app.post("/admin/event/:id/stop", ensureAuthenticated, _.bind(function(req, res) {
            var event = db.events.get(req.params.id);

            if(_.isUndefined(event)) {
                res.status(404);
                res.send("404 Not Found");
                return;
            };

            var err = event.stop();
            if(err) {
                res.status(500);
                res._errorReason = err;
                res.send(err);
                return;
            }
            event.logAnalytics({action: "stop", user: req.user});

            res.redirect("/admin/");
        }, this));

        app.get("/admin/event/:id", ensureAuthenticated, ensureEventAdmin, _.bind(function(req, res) {
            var event = db.events.get(req.params.id);

            if(_.isUndefined(event)) {
                logger.warn("Attempt to load unknown event id: " + req.params.id);
                res.status(404);
                res.send("404 Not Found");
                return;
            };

            res.render('admin-event.ejs', {user:req.user, events:db.events, event:event, _:_, loadApp:false, create:false})
        }, this));


        app.post("/admin/event/:id", ensureAuthenticated, ensureEventAdmin, _.bind(function(req, res) {
            var event = db.events.get(req.params.id);

            if(_.isUndefined(event)) {
                logger.warn("Attempt to update unknown event id: " + req.params.id);
                res.status(404);
                res.send();
                return;
            };

            var shouldBroadcast = false;

            if(event.get("description")!=req.body.description) {
                shouldBroadcast = true;
            }

            // now we need to update everything...
            event.set("title", req.body.title);
            event.set("shortName", req.body.shortName);
            event.set("description", req.body.description);
            event.set("welcomeMessage", req.body.welcomeMessage);
            event.set("organizer", req.body.organizer);
            event.set("blurDisabled", req.body.blurDisabled);
            event.save();

            event.logAnalytics({
                action: "update", 
                title: event.get("title"),
                shortName: event.get("shortName"),
                description: event.get("description"),
                welcomeMessage: event.get("welcomeMessage"),
                organizer: event.get("organizer"),
                blurDisabled: event.get("blurDisabled")
            });

            if(shouldBroadcast) {
                event.trigger("broadcast", event, "event-update", event.toJSON());
            }

            res.redirect("/admin/event/" + event.id);
        }, this));

        app.get("/hangout/gadget.xml", function(req, res) {
            var context = {
                unhangoutBaseUrl: options.baseUrl
            }
            if (process.env.NODE_ENV != "production") {
                context.mock = true;
                context.mockHangoutUrl = req.query.mockHangoutUrl || "test";
                context.mockAppData = "sessionId:" + (req.query.sessionId || "1")
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
                            console.log("Choices: " + db.users.pluck("id"));
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

        app.get("/facilitator/:sessionId/", ensureAuthenticated, function(req, res) {
            if (!req.params.sessionId) {
                return res.send(404);
            } 
            var session, event;
            if (req.params.sessionId != "undefined") {
                event = db.events.find(function(e) {
                    if (e.get("sessions").get(req.params.sessionId)) {
                        return true;
                    }
                });
                if (event) {
                    session = event.get("sessions").get(req.params.sessionId);
                }
                // Look for a permalink session.
                if (!session) {
                    session = db.permalinkSessions.get(req.params.sessionId);
                }
            }
            res.render("hangout-facilitator.ejs", {
                title: "Facilitator",
                session: session,
                event: event,
                baseUrl: options.baseUrl,
                hangoutOriginRegex: options.HANGOUT_ORIGIN_REGEX,
                user: req.user
            });
        });
        
        // Testing routes for use in development only.
        if (process.env.NODE_ENV != "production") {
            // Render the contents of gadget.xml in the manner that google will.
            app.get("/test/hangout/gadgetcontents", function(req, res) {
                var libxmljs = require("libxmljs");
                var request = require("superagent");
                var gadgetUrl = options.baseUrl + "/hangout/gadget.xml?sessionId=" + req.query.sessionId + "&mockHangoutUrl=" + encodeURIComponent(req.query.mockHangoutUrl) + "&mockUserIds=" + req.query.mockUserIds;
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
            app.get("/test/hangout/:sessionId/", ensureAuthenticated, function(req, res) {
                res.render("hangout-mock.ejs", {
                    sessionId: req.params.sessionId,
                    mockHangoutUrl: options.baseUrl + req.url,
                    mockUserIds: req.query.mockUserIds || ""
                });
            });
        }
        app.get("/");
    }
}

function generateSessionHangoutGDParam(session, options) {
    return "?gid="+options.HANGOUT_APP_ID + "&gd=sessionId:" + session.id;
}
