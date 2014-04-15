// app.js
//
// This is the main hub of the client-side application. This never runs server-side.
//
// It has two primary jobs:
//    1. configure the main application object for the client (this is a Marionette-style Application)
//    2. connect to the sever and manage the flow of messages
//

require([
    "jquery", "underscore", "backbone", "logger", "client-models",
    "event-views", "sockjs", "auth",
    // plugins
    "bootstrap", "backbone.marionette", "underscore-template-config"
], function($, _, Backbone, logging, models, eventViews, SockJS, auth) {

var sock;
var curEvent, users, messages;
var app;
var curSession = null;
var logger = new logging.Logger("event-app");

$(document).ready(function() {
    logger.log("Starting app!");

    var interval = 0;
    var messageShown = false ;
    var aboutShown = false;

    //------------------------------------------------------------------------//
    //                                                                          //
    //                                NETWORKING                                  //
    //                                                                          //
    //------------------------------------------------------------------------//
    //
    // From here down, we're mostly concerned with managing networking and
    // communication.
    sock = new SockJS(document.location.protocol + "//" + document.location.hostname +
            (document.location.port ? ":" + document.location.port : "") + "/sock");
    // Register a bunch of listeners on the major events it will fire.
    sock.onopen = function() {
        // on connect, send the auth message.
        sock.send(JSON.stringify({
            type: "auth",
            args: {key: auth.SOCK_KEY, id: auth.USER_ID}
        }));
    };

    // This is the big one - handles every incoming message.
    sock.onmessage = function(message) {
        var session;

        // logger.log(message);

        // messages come across the wire as raw strings in the data field.
        // parse them into a proper object here.
        var msg = JSON.parse(message.data);

        if(msg.type.indexOf("-err")!=-1) {
            logger.error("Got an error from the server!", message);
            if (msg.type === "chat-err" && msg.args === "Over capacity") {
                messages.trigger("over-capacity");
            }
        }
        // All messages have a type field.
        switch(msg.type) {
            // join an EVENT
            case "join":
                users.add(new models.User(msg.args.user));
                break;

            // leave an EVENT
            case "leave":
                users.remove(users.get(msg.args.user.id));
                break;

            // chat message received
            case "chat":
                messages.add(new models.ChatMessage(msg.args));
                app.vent.trigger("new-chat-message");

                break;

            // the embed for this event has been updated
            case "embed":
                var originalYoutubeId = curEvent.get("youtubeEmbed") || "";

                curEvent.setEmbed(msg.args.ytId);
                logger.log("added yt embed id: " + JSON.stringify(msg.args));
                break;

            case "clear-previous-videos":
                curEvent.set("previousVideoEmbeds", []);
                break;

            case "control-video":
                app.youtubeEmbedView.control(msg.args);
                break;

            case "set-hoa":
                if (_.isNull(msg.args)) {
                    curEvent.setHoA(null);
                } else if (curEvent.get("hoa")) {
                    logger.debug("set hoa attrs", msg.args);
                    curEvent.get("hoa").set(msg.args);
                } else {
                    session = new models.Session(msg.args);
                    curEvent.setHoA(session);
                }
                break;

            case "delete-session":
                session = curEvent.get("sessions").get(msg.args.id);
                // app.paginatedSessions.remove(session);
                curEvent.removeSession(session);

                logger.log("removing session: " + msg.args.id);
                break;

            // create a new session
            case "create-session":
                session = new models.Session(msg.args);

                // this is sort of ugly to have to edit both.
                // i'm not sure the former one is critical, but it is definitely
                // important that we add it to the special paginated sessions list.
                // after startup, we have to edit it directly.
                curEvent.get("sessions").add(session);
                // app.paginatedSessions.add(session);
                break;

            // update the list of a session's not-yet-connected-but-joining participants
            case "joining-participants":
                logger.log("joining participants "+ msg.args.id, msg.args.participants);
                session = curEvent.get("sessions").get(msg.args.id);
                session.set("joiningParticipants", msg.args.participants);
                break;

            // update the list of a session's participants
            case "session-participants":
                logger.log("participants in session "+msg.args.id, msg.args.participants);
                session = curEvent.get("sessions").get(msg.args.id);
                session.setConnectedParticipants(msg.args.participants);
                break;

            // mark a session as having its hangout connected and communicating
            case "session-hangout-connected":
                session = curEvent.get("sessions").get(msg.args.id);
                session.set("hangoutConnected", true);
                break;

            // mark a session as disconnected
            case "session-hangout-disconnected":
                session = curEvent.get("sessions").get(msg.args.id);
                session.setConnectedParticipants([]);
                session.set("hangoutConnected", false);
                break;

            case "open-sessions":
                curEvent.openSessions();
                app.sessionListView.render();
                break;

            case "close-sessions":
                curEvent.closeSessions();
                app.sessionListView.render();
                break;

            // sent in cases when the event's information has been updated.
            // includes the entire event JSON object as the server sees it.
            // copy it into curEvent.
            case "event-update":
                curEvent.set(msg.args);

                logger.log("updated current event: " + JSON.stringify(msg.args));
                break;

            // *-ack message types are just acknowledgmeents from the server
            // of the receipt of a particular message type and that the
            // message was properly formatted and accepted.
            //
            // mostly we don't do anything with these messages, but
            // in some situations we do react to them. They're used
            // more for testing.
            case "auth-ack":
                sock.send(JSON.stringify({type:"join", args:{id:curEvent.getRoomId()}}));
                break;

            case "join-ack":
                logger.log("joined!");
                break;

            case "attend-ack":
                logger.log("attend-ack");
                break;
        }
    };

    // handle losing the connection to the server.
    // we want to put up a notice so the user knows that they've been disconnected (in
    // case they can do anything about it, like unpugged cable or wifi outage)
    // at the same time, we also want to attempt to reconnect if it was a server
    // outage and the server is restarting. So we occasionally ping the server
    // with an http request and when it responds successfully, we reload the page
    // which will trigger a full reconnection and state reset.
    sock.onclose = function() {
        $('#disconnected-modal').modal('show');
        messages.add(new models.ChatMessage({text:"You have been disconnected from the server. Please reload the page to reconnect!"}));

        var checkIfServerUp = function () {
             var ping = document.location;

             $.ajax({
                  url: ping,
                  type: "HEAD",
                  cache: false
              }).done(function() {
                  // reload window when ajax call is successful
                  window.location.reload();
              }).fail(function() {
                  timeout = setTimeout(checkIfServerUp, 1000);
              });
        };
        // Run the first check at a random interval to hopefully spread out
        // requests to a seiged server trying to restart.
        setTimeout(checkIfServerUp, 1000 * Math.random());
    };


    //------------------------------------------------------------------------//
    //                                                                          //
    //                                APP SETUP                                   //
    //                                                                          //
    //------------------------------------------------------------------------//

    // The EVENT_ATTRS constant comes from the event.ejs file. They are the way
    // that the server communicates the initial state of the event to the
    // client - in a big JSON blob. Subsequent updates all happen over the
    // sockJS channel, but the initial state is embedded there.
    curEvent = new models.ClientEvent(EVENT_ATTRS);
    if (HOA_ATTRS) {
        curEvent.set("hoa", new models.Session(HOA_ATTRS));
        curEvent.get("hoa").event = curEvent;
    }
    curEvent.get("sessions").add(EVENT_ATTRS.sessions);
    users = new models.UserList(EVENT_ATTRS.connectedUsers);
    messages = new models.ChatMessageList();

    logger.log("Inflated models.");

    // documentation for Marionette applications can be found here:
    // https://github.com/marionettejs/backbone.marionette/blob/master/docs/marionette.application.md
    app = new Backbone.Marionette.Application();


    // the notion of regions comes from Marionette.
    // https://github.com/marionettejs/backbone.marionette/blob/master/docs/marionette.region.md
    //
    // Basically, they give us a way to create containers in the application, that different
    // views are added and removed from. It handles various event cleanup work on add/remove.
    // In this app, we don't often swap stuff in and out. It's primarily just a useful
    // organizational abstraction.
    app.addRegions({
        right: '#main-right',
        main: '#main-left',
        topLeft: '#top-left',
        global: '#global',
        dialogs: '#dialogs',
        admin: '#admin-region',
        bar:'#bar',
        top:'#top'
    });

    // This is code that runs when the application initializes.
    app.addInitializer(function(options) {

        // include the youtube JS api per docs:
        // https://developers.google.com/youtube/iframe_api_reference
        var tag = document.createElement('script');
        tag.src = "//www.youtube.com/iframe_api";
        var firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

        // create all the basic views
        this.sessionListView = new eventViews.SessionListView({
            collection: curEvent.get("sessions"),
            event: curEvent,
            sock: sock
        });
        this.chatView = new eventViews.ChatLayout({
            messages: messages,
            users: users,
            event: curEvent,
            sock: sock
        });
        this.youtubeEmbedView = new eventViews.VideoEmbedView({
            model: curEvent, sock: sock
        });
        this.dialogView = new eventViews.DialogView({
            event: curEvent, sock: sock
        });

        this.aboutView = new eventViews.AboutEventView({model: curEvent});

        // present the views in their respective regions
        this.right.show(this.chatView);
        this.main.show(this.sessionListView);
        this.topLeft.show(this.youtubeEmbedView);
        this.dialogs.show(this.dialogView);
        this.top.show(this.aboutView);

        // this is a little unorthodox, but not sure how else
        // to do it.
        $(this.bar.el).hide();

        // obviously this is not secure, but any admin requests are re-authenticated on
        // the server. Showing the admin UI is harmless if a non-admin messes with it.
        if(IS_ADMIN) {
            this.adminButtonView = new eventViews.AdminButtonView({
                event: curEvent, sock: sock
            });
            curEvent.on("change:sessionsOpen change:start", _.bind(function() {
                this.adminButtonView.render();
            }, this));
            this.admin.show(this.adminButtonView);
        }
        var maybeMute = function() {
            var hoa = curEvent.get("hoa");
            if (hoa && _.findWhere(hoa.get("connectedParticipants"), {id: auth.USER_ID})) {
                app.youtubeEmbedView.control({"mute": true});
            }
        };
        curEvent.on("update-hoa", maybeMute);
        this.youtubeEmbedView.on("player-state-change", function(state) {
            if (state === "playing") {
                maybeMute();
            }
        });
        maybeMute();

        logger.log("Initialized app.");

        $("#admin-page-for-event").attr("href", "/admin/event/" + curEvent.id);

    }, app);

    app.vent.on("about-nav", _.bind(function(hide) {

        if (_.isUndefined(hide)) {
            hide = aboutShown;
        }

        var el = this.top.$el;

        $(".updated").addClass("hide");
        if (hide) {
            if(!curEvent.isLive()) {
                // don't let people dismiss the about screen if the event isn't live.
                return;
            }

            el.animate({
                "top": -1 * el.outerHeight() - 15
            }, {
                done: function() {
                    el.hide();
                    // This is introspected by browser tests that need to know
                    // if we're done loading the about pane for the first time.
                    window.EVENT_ABOUT_INITIALIZED = true;
                }
            });

            aboutShown = false;
            $("#about-nav").removeClass("active");
        } else {
            el.show().animate({"top":0}, {
                // This is introspected by browser tests that need to know if
                // we're done loading the about pane for the first time.
                done: function() { window.EVENT_ABOUT_INITIALIZED = true; }
            });
            aboutShown = true;

            $("#about-nav").addClass("active");
        }

    }, app));

    app.start();

    // if the event isn't live yet, force the about page to show.
    if(!curEvent.isLive()) {
        // Force about pane to show itself.
        app.vent.trigger("about-nav", false);
    } else {
        // Make about pane hide itself.
        app.vent.trigger("about-nav", true);
    }

    // Handles clicks on the nav bar links.
    $("#about-nav").click(function(jqevt) {
        jqevt.preventDefault();
        app.vent.trigger("about-nav");
    });

    logger.log("Setup regions.");

});

});
