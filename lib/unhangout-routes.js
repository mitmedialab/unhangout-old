var _ = require("underscore"),
    passport = require("passport"),
    logger = require("./logging").getLogger(),
    models = require("./server-models"),
    farming = require('./hangout-farming.js'),
    utils = require("./utils");

var ensureAuthenticated = utils.ensureAuthenticated;
var ensureAdmin = utils.ensureAdmin;
var getSession = utils.getSession;

module.exports = {

    route: function(app, db, options) {
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
                logger.warn("Request for a non-existent event id: " + req.params.id);
                res.status(404);
                res.send();
                return;
            }

            var context = {user:req.user, event:e};
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
            }
        );
        
        app.get("/logout", function(req, res) {
            req.logout();
            res.redirect("/");
        });
        
        // this endpoint connects someone to the hangout for a particular session.
        // the :id in this case is not an actual session id, instead we use
        // session-keys for this. (getSession checks for both)
        // we do this for authentication reasons, so someone can't arbitrarily
        // join a session hangout that isn't started yet or that they're
        // not supposed to have access to. It's a little thing - anyone
        // with access can send the link to anyone else - but it's better
        // than nothing.
        app.get("/session/:id", function(req, res) {
            var session = getSession(req.params.id, db.events, db.permalinkSessions);
            logger.info("ROUTING TO SESSION: " + JSON.stringify(session));

            if(session) {
                // three options at this point:
                // 1. the session is already running and has a hangout link populated -> redirect to hangout
                // 2. the session doesn't have a hangout link, but does have someone pending on starting the hangout -> stall, wait for response
                // 3. the session doesn't have a hangout link, and doesn't yet have a pending link -> send to google
                
                // TWO BIG OPTIONS HERE
                // If we have a farmed url available, prefer that significantly; it resolves a bunch of our issues.
                // so check with the farming module / redis to see if we can do taht. 
                // If that returns an error, then do the fallback strategy, which is to get the first person to click it
                // to generate the session and have that session phone home.
                
                if(session.getHangoutUrl()) {
                    logger.info("redirecting user to existing hangout url: " + session.getHangoutUrl());

                    // append all the google hangout app info to enforce loading it on startup
                    res.redirect(session.getHangoutUrl());
                } else {
                    var farmedSesssionURL = farming.getNextHangoutUrl(function(err, url) {
                        if(err || url==null) {
                            logger.warn("ran out of farmed hangout urls! falling back to first-visitor->redirect strategy. isPending? " + session.isHangoutPending());
                            // this branch is for the situation when there is no farmed hangout url available.
                            if(session.isHangoutPending()) {
                                logger.debug("session is pending, waiting on someone else to do it");
                                // if it's pending, wait on the hangout-url event.
                                // logger.debug("waiting for hangout URL to return for request from user: " + req.user.id);
                                session.once("hangout-url", function(url) {
                                    logger.info("issueing redirect to requests waiting for a hangout link to be created: " + url);
                                    // when we get the hangout url, redirect this request to it.
                                    res.redirect(url);
                                });
                            } else {
                                // if there isn't a pending request, this is the first user to hit this link.
                                // send them to google!
                                logger.info("session " + req.params.id + " does not yet have a hangout, and is not pending. sending user " + _.isUndefined(req.user) ? "[id missing]" : req.user.id + " to go make a new hangout.");
                                session.startHangoutWithUser(req.user);
                                logger.info(session.get("session-key"));

                                var url = "https://plus.google.com/hangouts/_" + generateSessionHangoutGDParam(session, options);
                                logger.debug("redirecting to: " + url);
                                res.redirect(url);
                            }
                        } else {
                            // double check that we haven't already set a url on this session
                            //        this would happen if two requests came in identically and
                            //         resolved first. 
                            if(session.getHangoutUrl()) {
                                // and push the url we were going to use back on the end of the 
                                // queue.
                                logger.warning("encountered a race condition where we over-requested hangout urls for a new hangout. putting the extra one back in the list.");
                                farming.reuseUrl(url);
                            } else {
                                var fullURL = url + generateSessionHangoutGDParam(session, options);
                                logger.debug("redirecting to: " + fullURL);
                                session.set("hangout-url", fullURL);
                            }
                            logger.info("pulled a new hangout url off the stack; redirecting user to that url: " + url);
                            res.redirect(session.getHangoutUrl());
                        }
                    });
                }
            } else {
                logger.warn("request for unknown session id: " + req.params.id);
                res.status(404);
                res.send();
            }
        });

        // all messages from the hangout app running in each of the active hangouts
        // go to this endpoint. 
        // TODO verify that this is using session keys, not sessionids (otherwise it would
        // be super easy to spoof)
        // TODO think about whether we want more security here. the right thing
        // to do would be to require some sort of handshake on election so the keys
        // for posting hangout messages aren't the same as the ones public to all
        app.post("/session/hangout/:id", _.bind(function(req, res) {
            logger.debug("POST /session/hangout/" + req.params.id + ":" + req.body.type)
            // TODO need to switch this over to searching through session-keys in the events' domains using _.find
            if(!("id" in req.params)) {
                res.status(404);
                res.send();
                return;
            }

            var session = getSession(req.params.id, db.events, db.permalinkSessions);
            

            if(_.isUndefined(session)) {
                logger.warn("session:unknown " + JSON.stringify(req.body) + " for key " + req.params.id);
                res.status(400);
                res.send();
                return;
            }

            // make sure a type is specified
            if(!("type" in req.body)) {
                res.status(400)
                res.send();
                return;
            }

            // STOP DOING THIS it's causing major problems
            // any message to a non-hangout-connected session should make it 
            // be connected.
            // if(!session.get("hangoutConnected")) {
            //  session.set("hangoutConnected", true);
            // }

            switch(req.body.type) {
                // in the hangout-farming situation, this behavior of the app is basically vestigal.
                // the server already knows what the url should be, and auto-assigns it before the
                // hangout actually loads. But if we're not farming, this is critical, because the
                // first loader needs to set the actual hangout url.
                //
                // this request is called for every person who loads a hangot. only the first one
                // really has any functional impact, though. subsequent loads will ignore the
                // setHangoutUrl piece because the hangout already has a url.
                case "loaded":
                    if(session && "url" in req.body) {
                        logger.info("session:" + session.id + ":loaded\tparticipant:" + JSON.stringify(req.body.participant) + "\tparticipants: " + JSON.stringify(req.body.participants) + "\tkey: " + req.params.id + "\turl: " + req.body.url);

                        // get the post data; we're expecting the url to be in the payload.
                        var url = req.body.url;
                        logger.info("loaded url: " + url + " (url set in session: " + session.getHangoutUrl() + ")");

                        if(!session.get("hangoutConnected")) {
                            logger.info("first load of session, starting it up!");
                            session.set("hangoutConnected", true);
                        }

                        // set the start time, but only if it hasn't been set yet.
                        if(_.isNull(session.get("hangout-start-time")) || _.isUndefined(session.get("hangout-start-time"))) {
                            session.set("hangout-start-time", req.body.startTime);
                            session.save();
                        }

                        // the session will ignore this if it already has a url.
                        var fullURL = url + generateSessionHangoutGDParam(session, options);
                        // logger.debug("(trying to) set hangout url to: " + fullURL);
                        session.setHangoutUrl(fullURL);


                        res.status(200);
                        res.send();
                    } else {
                        logger.warn("request for unknown session id: " + req.params.id + " or missing payload: " + JSON.stringify(req.body));
                        res.status(404);
                        res.send();
                    }

                    break;

                // sent any time someone joins or leaves a hangout. contains the full
                // participant list every time.
                case "participants":
                    // update the current participant list for this session. 
                    if(session && "participants" in req.body) {

                        // we need to look and see if we have this user id in our db.users
                        // list. if we don't, we need to keep track of them somehow. not
                        // sure exactly where to put this just yet.
                        var participantIds = _.map(req.body.participants, function(participant) {
                            return participant.person.id;
                        });

                        // TODO start checking to see if we have all these participants in our user list
                        // and if their id is not tracked in users, add them in. This will help us rendering
                        // their pictures elsewhere in the app without much trouble.
                        _.each(req.body.participants, _.bind(function(participant) {
                            if(_.isUndefined(db.users.get(participant.person.id))) {
                                logger.debug("creating new user object");

                                var newUserAttrs = {displayName:participant.person.displayName,
                                    id:participant.person.id};

                                if(participant.person.image) {
                                    newUserAttrs["picture"] = participant.person.image.url;
                                }

                                var newUser = new models.ServerUser(newUserAttrs);
                                newUser.set("createdViaHangout", true);
                                db.users.add(newUser);
                                newUser.save();
                            } else {
                                // TODO perhaps add a flag that this user was seen in a permalink
                                // based hangout? 
                            }
                        }, this));

                        logger.info("session:" + session.id + ":participants\t" + JSON.stringify(participantIds));

                        session.setConnectedParticipantIds(participantIds);

                        // count this as a heartbeat, since it represents active hangout activity. Useful since
                        // the first heartbeat isn't for 5 seconds, and in some situations there might be an 
                        // extant heartbeat-check interval running that could fire before this new participant
                        // picks up heartbeat responsibilities.
                        session.heartbeat();
                    } else {
                        logger.warn("Received a request for participants missing appropriate session key or participants field.");
                        res.status(404);
                        res.send();
                    }
                    break;
                // hangouts send heartbeats every 5 seconds so we can tell that the
                // hangout is still running. this is because there is not a reliable
                // "closing hangout" message, so we have to infer it from heartbeats
                // disappearing.
                case "heartbeat":
                    logger.debug("session:" + session.id + ":heartbeat\tfrom:" + req.body.from + "\tparticipants: " + JSON.stringify(req.body.participants) + "\turl: " + req.body.url + "\tstartTime: " + req.body.startTime + "\tfromLeader: " + req.body.fromLeader);
                    var err = session.heartbeat(req.body.participants, req.body.url + generateSessionHangoutGDParam(session, options), req.body.startTime);

                    if(err) {
                        logger.error("Sending fail to newer hangout session!");

                        res.status(200);
                        res.send("FAIL");

                        // drop out to avoid hitting later status/send calls.
                        return;
                    }

                    break;
                default: 
                    logger.warn("Got unknown hangout post: " + JSON.stringify(req.body));
                    break;
            }
            // after whatever manipulation we've done, save the session.
            session.save();


            // Close out the requests successfully, assuming that if anything else were wrong
            // they would have been closed out and the method returned earlier in execution.
            res.status(200);
            res.send();
        }, this));

        app.post("/subscribe", _.bind(function(req, res) {
            logger.debug("POST /subscribe");

            // save subscription emails
            if("email" in req.body && req.body.email.length > 5 && req.body.email.length < 100) {
                //TODO: move any redis-specific stuff to unhangout-db.
                db.redis.lpush("global:subscriptions", req.body.email);
                logger.info("subscribed email: " + req.body.email);
                res.status(200);
                res.send();
            } else {
                res.status(400);
                res.send();
            }
        }, this));

        app.get("/admin", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
            logger.info("GET /admin");

            var sortedPermalinkSesssions = db.permalinkSessions.sortBy(function(s) {
                return s.get("user-seconds") * -1;
            });

            sortedPermalinkSesssions = _.sortBy(sortedPermalinkSesssions, function(s) {
                return s.get("connectedParticipantIds").length * -1;
            });

            // now prepend all event sessions 
            var sessions = _.flatten(db.events.map(function(event) {
                if(event.isLive()) {
                    return event.get("sessions").toArray();
                } else {
                    return [];
                }
            }));

            var allSessions = sessions.concat(sortedPermalinkSesssions);

            res.render('admin.ejs', {user:req.user, events:db.events, sessions:allSessions, event:undefined });
        }, this));

        app.get("/admin/event/new", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
            logger.debug("GET /admin/event/new");
            var event = db.events.get(req.params.id);

            var context = {user:req.user, events:db.events, event:event, create:true};

            res.render('admin-event.ejs', context);
        }, this));

        app.post("/admin/event/new", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
            logger.debug("POST /admin/event/new " + JSON.stringify(req.body));

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

            logger.info("Created a new event: " + JSON.stringify(event));

            res.redirect("/admin");
        }, this));

        app.post("/admin/event/:id/start", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
            var event = db.events.get(req.params.id);

            if(_.isUndefined(event)) {
                logger.warn("Attempt to stop unknown event id: " + req.params.id);
                res.status(404);
                res.send();
                return;
            };

            var err = event.start();

            if(err) {
                res.status(500);
                res.send(err);
                return;
            }

            logger.info("Started event:" + req.params.id);

            res.redirect("/admin/");
        }, this));

        app.post("/admin/event/:id/stop", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
            var event = db.events.get(req.params.id);

            if(_.isUndefined(event)) {
                logger.warn("Attempt to start unknown event id: " + req.params.id);
                res.status(404);
                res.send();
                return;
            };

            var err = event.stop();
            if(err) {
                res.status(500);
                res.send(err);
                return;
            }

            logger.info("Stopped event:" + req.params.id);

            res.redirect("/admin/");
        }, this));

        app.get("/admin/event/:id", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
            var event = db.events.get(req.params.id);

            if(_.isUndefined(event)) {
                logger.warn("Attempt to load unknown event id: " + req.params.id);
                res.status(404);
                res.send();
                return;
            };

            res.render('admin-event.ejs', {user:req.user, events:db.events, event:event, _:_, loadApp:false, create:false})
        }, this));


        app.post("/admin/event/:id", ensureAuthenticated, ensureAdmin, _.bind(function(req, res) {
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

            logger.debug("new event attributes: " + JSON.stringify(event));

            if(shouldBroadcast) {
                event.broadcast("event-update", event.toJSON());
            }

            res.redirect("/admin/event/" + event.id);
        }, this));

        app.get("/");
    }
}

function generateSessionHangoutGDParam(session, options) {
    // logger.debug("generating url for session: " + JSON.stringify(session));

    // replace : with | in any free-text field like title and description
    return "?gid="+options.HANGOUT_APP_ID + 
        "&gd=" + options.HOST + ":" + options.PORT + ":" + 
        session.get("session-key") +':'+ encodeURIComponent(session.get('title').replace(":", "|")) +':'+ encodeURIComponent(session.get("isPermalinkSession") ? session.get('description').replace(":", "|") : "none") +':'+
        session.get('shortCode') + ':' + session.get("isPermalinkSession") + ':' + encodeURIComponent(session.collection.event ? session.collection.event.get("title").replace(":", "|") : "none");
}
