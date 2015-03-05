// app.js
//
// This is the main client-side hub of the event page.
//
// It has two primary jobs:
//    1. configure the main application object for the client (this is a Marionette-style Application)
//    2. connect to the sever and manage the flow of messages
//

require([
    "jquery", "underscore", "backbone", "logger", "client-models",
    "event-views", "auth", "transport", 
    // plugins
    "bootstrap", "backbone.marionette", "underscore-template-config"
], function($, _, Backbone, logging, models, eventViews, auth, transport) {

var curEvent, messages;
var app;
var curSession = null;  
var logger = new logging.Logger("event-app");

$(document).ready(function() {
    logger.log("Starting app!");

    // The *_ATTRS constants come from the event.ejs file. They are the way
    // that the server communicates the initial state of the event to the
    // client - in big JSON blobs. Subsequent updates all happen over the
    // sockJS channel, but the initial state is embedded there.
    curEvent = new models.ClientEvent(EVENT_ATTRS);
    curEvent.get("sessions").reset(SESSION_ATTRS);
    if (HOA_ATTRS) {
        curEvent.set("hoa", new models.Session(HOA_ATTRS));
    }
    curEvent.get("connectedUsers").reset(CONNECTED_USERS);

    messages = new models.ChatMessageList(RECENT_MESSAGES);

    logger.log("Inflated models.");

    //------------------------------------------------------------------------//
    //                                                                          //
    //                                NETWORKING                                  //
    //                                                                          //
    //------------------------------------------------------------------------//
    //
    var trans = new transport.Transport(curEvent.getRoomId());
    trans.registerModel("event", curEvent);
    trans.registerModel("messages", messages);
    trans.on("chat-err", function(args) {
        if (args === "Over capacity") {
            messages.trigger("over-capacity");
        }
    });
    trans.on("control-video", function(args) {
        app.youtubeEmbedView.control(args);
    });

    curEvent.on("change:sessionsOpen", function() {
        app.sessionListView.render();
    });

    curEvent.on("change:open", function(model, open, options) {
        console.log("change:open", arguments);
        if (IS_ADMIN) {
            app.chatView.chatInputView.onRender();
        } else if (!open) {
            window.location.reload();
        }
    });

    trans.on("close", function(state) {
        messages.add(new models.ChatMessage({
            text: "You have been disconnected from the server. " +
                  "Please reload the page to reconnect!"
        }));
        $('#disconnected-modal').modal('show');
    });
    trans.on("back-up", function() {
        window.location.reload();
    });

    //------------------------------------------------------------------------//
    //                                                                          //
    //                                APP SETUP                                   //
    //                                                                          //
    //------------------------------------------------------------------------//


    var aboutShown = false;
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
        centerLeft: '#center-left',
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
            transport: trans
        });
        this.topicListView = new eventViews.TopicListView({
            collection: curEvent.get("sessions"),
            event: curEvent,
            transport: trans
        });
        this.chatView = new eventViews.ChatLayout({
            messages: messages,
            users: curEvent.get("connectedUsers"),
            event: curEvent,
            transport: trans
        });
        this.youtubeEmbedView = new eventViews.VideoEmbedView({
            model: curEvent, transport: trans
        });
        this.dialogView = new eventViews.DialogView({
            event: curEvent, transport: trans
        });

        this.aboutView = new eventViews.AboutEventView({model: curEvent});

        // present the views in their respective regions
        this.right.show(this.chatView);
        this.topLeft.show(this.youtubeEmbedView);
        
        this.centerLeft.show(this.sessionListView);
        this.main.show(this.topicListView);

        this.dialogs.show(this.dialogView);
        this.top.show(this.aboutView);

        //On page reload show and hide topic list
        //according to the current mode
        if(!curEvent.get("adminProposedSessions")) {
            $("#btn-propose-session").addClass('show');
            $("#btn-propose-session").removeClass('hide');
            $("#topic-list").show();
        } else {
            $("#btn-propose-session").addClass('hide');
            $("#btn-propose-session").removeClass('show');
            $("#topic-list").hide();
        }

        curEvent.on("change:adminProposedSessions change:sessionsOpen change:open", _.bind(function() {
            this.adminButtonView.render();  
        }, this));

        // this is a little unorthodox, but not sure how else
        // to do it.
        $(this.bar.el).hide();

        // obviously this is not secure, but any admin requests are re-authenticated on
        // the server. Showing the admin UI is harmless if a non-admin messes with it.
        if(IS_ADMIN) {
            this.adminButtonView = new eventViews.AdminButtonView({
                event: curEvent, transport: trans
            });

            this.admin.show(this.adminButtonView);
        }

        var maybeMute = function() {
            var hoa = curEvent.get("hoa");
            if (hoa && _.findWhere(hoa.get("connectedParticipants"), {id: auth.USER_ID})) {
                app.youtubeEmbedView.control({"mute": true});
            }
        };
        this.youtubeEmbedView.yt.on("player-state-change", function(state) {
            if (state === "playing") {
                maybeMute();
            }
        });

        // The following two calls aren't necessary for muting, as we mute when
        // the video starts playing. But this gives the appearance of muting
        // even if the video hasn't started yet.
        curEvent.on("change:youtubeEmbed", maybeMute);
        maybeMute();

        logger.log("Initialized app.");

        $("#admin-page-for-event").attr("href", "/admin/event/" + curEvent.id);
        $(".about-event-container").hide();

    }, app);

    app.vent.on("about-nav", _.bind(function(hide) {
        if (_.isUndefined(hide)) {
            hide = aboutShown;
        }

        var el = this.top.$el;

        $(".updated").addClass("hide");
        if (hide) {
            el.animate({
                "top": -1 * el.outerHeight() - 15
            }, {
                done: function() {
                    $(".about-event-container").hide();
                }
            });

            aboutShown = false;
            $("#about-nav").removeClass("active");
        } else {
            el.show().animate({"top":0});
            aboutShown = true;

            $("#about-nav").addClass("active");
            $(".about-event-container").show();
        }

    }, app));

    app.start();

    // Handles clicks on the nav bar links.
    $("#about-nav").click(function(jqevt) {
        jqevt.preventDefault();
        app.vent.trigger("about-nav");
    });

    logger.log("Setup regions.");

});

});
