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
    "bootstrap", "backbone.marionette", "underscore-template-config",
    "jquery.hotkeys"
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

        $('#message-sessions-modal').on('shown.bs.modal', function (e) {
            $('#session_message').focus();
        });
        $('#admin-hotkeys-help-modal').on('shown.bs.modal', function (e) {
            $('#admin-hotkeys-help-modal .btn-default').focus();
        });
        $('#create-session-modal').on('shown.bs.modal', function (e) {
            $('#session_name').focus();
        });

        /*
            When the app loads show or hide the breakout 
            rooms list view controls accordingly  
        */
        if(curEvent.get("randomizedSessions")) {
            $("#btn-propose-session").hide();
            $("#btn-create-session").hide();
            $("#random-list").show();
            $("#topic-list").hide();
            if(curEvent.get("sessionsOpen")) {
                $(".btn-group-me").find(".text").text("JOIN");
                $(".btn-group-me").find(".lock").hide();
                $(".btn-group-me").attr("disabled", false);
            } else {
                $(".btn-group-me").find(".text").text("LOCKED");
                $(".btn-group-me").addClass("disabled");
                $(".btn-group-me").attr("disabled", true);
            }
            $(".empty-notice").hide();
        } else {
            $("#random-list").hide();
            if(!curEvent.get("adminProposedSessions")) {
                $("#btn-propose-session").show();
                $("#btn-create-session").hide();
                $("#topic-list").show();
            } else {
                $("#btn-propose-session").hide();
                $("#btn-create-session").show();
                $("#topic-list").hide();
            }
        }

        if(IS_ADMIN) {
            curEvent.on("change:adminProposedSessions change:sessionsOpen change:open", _.bind(function() {
                this.adminButtonView.render(); 
            }, this));
        }

        // this is a little unorthodox, but not sure how else
        // to do it.
        $(this.bar.el).hide();

        this.initHotkeys = function() {
            // These allow the hotkeys to work even when an input has the
            // focus. Given the ctrl+shift prefix, this seems reasonable
            // and safe, and avoids inconsistencies when using the hotkeys.
            $.hotkeys.options.filterInputAcceptingElements = false;
            $.hotkeys.options.filterContentEditable = false;
            $.hotkeys.options.filterTextInputs = false;

            var makeHotkey = function(key) {
                var hotkey = 'ctrl+shift+' + key;
                return hotkey;
            }

            // This allows use of the existing event handlers in
            // adminButtonView.
            // TODO: Abstract adminButtonViews functions more to separate the
            // functionality we need here from the event callbacks.
            var dummyEvent = {
                preventDefault: function() {},
            }

            var hotkeysLog = function(event, funcName) {
                logger.log(event.data.keys + ' hotkey pressed, calling: ' + funcName);
            }

            var help = function(data) {
                hotkeysLog(data, 'help');
                $('#admin-hotkeys-help-modal').modal('show');
            }

            var startStopEvent = function(data) {
                if (curEvent.get('open')) {
                    hotkeysLog(data, 'stopEvent');
                    this.adminButtonView.stopEvent(dummyEvent);
                }
                else {
                    hotkeysLog(data, 'startEvent');
                    this.adminButtonView.startEvent(dummyEvent);
                }
            }

            var editEvent = function(data) {
                hotkeysLog(data, 'editEvent');
                // jQuery's click() only deals with firing the click event, so
                // use lower-level functionality.
                // This approach allows the link itself to be configured to
                // open in the same window or a new window.
                document.getElementById("admin-page-for-event").click()
            }

            var createSession = function(data) {
                hotkeysLog(data, 'createSession');
                $('#create-session-modal').modal('show');
            }

            var openSessions = function(data) {
                hotkeysLog(data, 'openSessions');
                this.adminButtonView.openSessions(dummyEvent);
            }

            var closeSessions = function(data) {
                hotkeysLog(data, 'closeSessions');
                this.adminButtonView.closeSessions(dummyEvent);
            }

            var messageSessions = function(data) {
                hotkeysLog(data, 'messageSessions');
                this.adminButtonView.messageSessions(dummyEvent);
            }

            var focusChatMessage = function(data) {
                hotkeysLog(data, 'focusChatMessage');
                $("#chat-input").focus();
            }

            var highlightChatMessage = function(data) {
                hotkeysLog(data, 'highlightChatMessage');
                $("[name='chat-as-admin']").click();
            }

            var editWhiteboard = function(data) {
                hotkeysLog(data, 'editWhiteboard');
                $("#whiteboard-buttons .edit-whiteboard").click();
            }

            var bindings = {
                '/': help,
                s: startStopEvent,
                e: editEvent,
                c: createSession,
                o: openSessions,
                w: closeSessions,
                m: messageSessions,
                a: focusChatMessage,
                h: highlightChatMessage,
                b: editWhiteboard,
            }

            var boundFunctions = {};

            var bindingsCallback = function(func, key) {
                var boundFunc = _.bind(func, this);
                boundFunctions[key] = boundFunc;
            }
            _.each(bindings, _.bind(bindingsCallback, this));

            var activate = function(el) {
                var callback = function(func, key) {
                    el.bind('keydown', makeHotkey(key), func);
                }
                _.each(boundFunctions, callback);
            }

            var deactivate = function(el) {
                var callback = function(func, key) {
                    el.unbind('keydown', func);
                }
                _.each(boundFunctions, callback);
            }

            return {
              activate: activate,
              deactivate: deactivate,
            }
        }

        // obviously this is not secure, but any admin requests are re-authenticated on
        // the server. Showing the admin UI is harmless if a non-admin messes with it.
        if(IS_ADMIN) {
            if (NUM_HANGOUT_URLS_WARNING > 0 && NUM_HANGOUT_URLS_AVAILABLE < NUM_HANGOUT_URLS_WARNING) {
                $("#no-urls-warning").modal('show');
                console.error("Too few hangout URLS available!", NUM_HANGOUT_URLS_AVAILABLE);
            }
            this.adminButtonView = new eventViews.AdminButtonView({
                event: curEvent, transport: trans
            });

            this.admin.show(this.adminButtonView);
            this.hotkeys = this.initHotkeys();
            this.hotkeys.activate($(document));
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
        
        $("#superuser-page-for-followupemail").attr("href", "/followup/event/" 
            + curEvent.id + "/participant_0");
        
        $(".about-event-container").hide();

        //Show contact form on event page if noShare is false
        //and none of the contact details are entered

        var pc = USER.preferredContact;
        if(!pc || !pc.noShare && !pc.twitterHandle && !pc.emailInfo && !pc.linkedinURL) {
            $("#my-contact-info-modal").modal('show');
        } 

        //Populating contact fields        
        $("#email_info").val(USER.preferredContact.emailInfo);
        $("#twitter_handle").val(USER.preferredContact.twitterHandle);
        $("#linkedin_url").val(USER.preferredContact.linkedinURL);
        $("#noShareChkBox").prop("checked", USER.preferredContact.noShare);

        var thisEventAssign  = curEvent.get("sessions").find(function(sess) {
          return sess.get("assignedParticipants").indexOf(auth.USER_ID) !== -1;
        });
        
        if(thisEventAssign) {
            $("#btn-regroup-me").show();
            $(".dummy-session").hide();
        } else {
            $("#btn-regroup-me").hide();
            $(".dummy-session").show();
        }
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
