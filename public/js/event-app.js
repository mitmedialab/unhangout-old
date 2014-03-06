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
    var windowBlurred = false ;
    var isIntervalRunning = false;
    var aboutShown = false;

    //------------------------------------------------------------------------//
    //                                                                          //
    //                                NETWORKING                                  //
    //                                                                          //
    //------------------------------------------------------------------------//
    // 
    // From here down, we're mostly concerned with managing networking and 
    // communication. 
    sock = new SockJS(document.location.protocol + "//" + document.location.hostname + ":" + document.location.port + "/sock");
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

        // logger.log(message);

        // messages come across the wire as raw strings in the data field.
        // parse them into a proper object here.
        var msg = JSON.parse(message.data);
        
        if(msg.type.indexOf("-err")!=-1) {
            logger.log("Got an error from the server!", message);
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

            // a user has blurred the lobby window
            case "blur":
                var blurredUser = users.get(msg.args.id);
                blurredUser.setBlurred(true);
                break;

            // a user has focused the lobby window
            case "focus":
                var blurredUser = users.get(msg.args.id);
                blurredUser.setBlurred(false);
                break;
            
            // the embed for this event has been updated
            case "embed":
                var originalYoutubeId = curEvent.get("youtubeEmbed") || "";

                curEvent.setEmbed(msg.args.ytId);
                logger.log("added yt embed id: " + JSON.stringify(msg.args));
                break;

            case "control-video":
                app.youtubeEmbedView.control(msg.args);
                break;

            case "set-hoa":
                var hoa = new models.Session(msg.args);
                curEvent.setHoA(hoa);
                break;

            case "delete-session":
                var session = curEvent.get("sessions").get(msg.args.id);
                // app.paginatedSessions.remove(session);
                curEvent.removeSession(session);

                logger.log("removing session: " + msg.args.id);
                break;

            // create a new session
            case "create-session":
                var session = new models.Session(msg.args);

                // this is sort of ugly to have to edit both. 
                // i'm not sure the former one is critical, but it is definitely
                // important that we add it to the special paginated sessions list.
                // after startup, we have to edit it directly.
                curEvent.get("sessions").add(session);
                // app.paginatedSessions.add(session);
                break;

            // update the list of a session's participants
            case "session-participants":
                logger.log("participants in session "+msg.args.id, msg.args.participants);
                var session = curEvent.get("sessions").get(msg.args.id);
                session.setConnectedParticipants(msg.args.participants);
                break;

            // mark a session as having its hangout connected and communicating
            case "session-hangout-connected":
                var session = curEvent.get("sessions").get(msg.args.id);
                session.set("hangoutConnected", true);
                break;

            // mark a session as disconnected
            case "session-hangout-disconnected":
                var session = curEvent.get("sessions").get(msg.args.id);
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
                  cache: false,
                  async : false,

                  success: function(msg){
                   // reload window when ajax call is successful
                       window.location.reload();
                   },

                   error: function(msg) {
                        timeout = setTimeout(checkIfServerUp, 250);
                   }
             });
        };

        checkIfServerUp();
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

        logger.log("Initialized app.");

        $("#admin-page-for-event").attr("href", "/admin/event/" + curEvent.id);

        // This section sets up the blur/focus tracking. This serves two purposes. The first
        // is to represent users differently in the presence gutter as well as in the
        // session list, depending on whether or not they have the lobby window focused
        //
        // We also use this to decide whether or not to show new messages coming in
        // by changing the tab title.
        
        if (!curEvent.get("blurDisabled")) {
            var startingTitle = window.document.title;
            var isAlreadyBlurred;
            $(window).blur(function() {
                if(isAlreadyBlurred)
                    return;

                isIntervalRunning = true ;
                windowBlurred = true ;
                messageShown = true ;

                var message = {
                    type: "blur",
                    args: {roomId: curEvent.getRoomId()}
                };
                sock.send(JSON.stringify(message));  

                isAlreadyBlurred = true;
            })

            $(window).focus(function() {
                isIntervalRunning = false;
                windowBlurred = false;
                messageShown = false ;
                clearInterval(interval);
                window.document.title = startingTitle;

                var message = {
                    type: "focus",
                    args: {roomId: curEvent.getRoomId()}
                };
                sock.send(JSON.stringify(message));  

                isAlreadyBlurred = false;
            })
        }

    }, app);

    // toggles the tab title to show new messages, but only if the window
    // is blurred (as detected above)
    app.showFlashTitle = function () {
        if(isIntervalRunning && !messageShown) {
            if(window.document.title == 'Unhangout')
                window.document.title = 'New Message ...';
            else
                window.document.title = 'Unhangout';

            interval = window.setTimeout(app.showFlashTitle , 1000);
        }
    };

    // All these app.vent calls are setting up app-wide event handling. The app
    // can trigger these events in any manner it desires. We use this to abstract
    // the logic about where the events might come from, because in some situations
    // they're triggered by users, sometimes by the arrival of remove messages,
    // sometimes as side effects of other actions.
    app.vent.on("new-chat-message", _.bind(function() {
        if(isIntervalRunning && windowBlurred) {
            interval = window.setTimeout(this.showFlashTitle, 1000);
        }
    }, app));
    
    app.vent.on("about-nav", _.bind(function() {
        console.log("handling about-nav event");

        $(".updated").addClass("hide");
        if(aboutShown) {
            if(!curEvent.isLive()) {
                // don't let people dismiss the about screen if the event isn't live.
                return;
            }

            this.top.$el.animate({"top":(-1*this.top.$el.outerHeight()-15)});

            aboutShown = false;
            $("#about-nav").removeClass("active");
        } else {
            this.top.$el.animate({"top":0});
            aboutShown = true;

            $("#about-nav").addClass("active");
        }

    }, app));

    app.start();

    // if the event isn't live yet, force the about page to show.
    if(!curEvent.isLive()) {
        app.vent.trigger("about-nav");
    } else {
        app.top.$el.animate({"top":(-1*app.top.$el.outerHeight() - 200)});
    }

    // Handles clicks on the nav bar links.
    $("#about-nav").click(function(jqevt) {
        jqevt.preventDefault();
        app.vent.trigger("about-nav");
    });
    
    logger.log("Setup regions.");

});

});
