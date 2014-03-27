// The views in this file define all the major pieces of the client-side event
// UI.  We are using Backbone.Marionette for our views, which provides some
// extra layers on top of the basic Backbone view objects.
//
// You can read more about Backbone.Marionette's objects here:
// https://github.com/marionettejs/backbone.marionette/tree/master/docs
//
// Basically, each major model in the system has a corresponding view:
// sessions, users, chat messages, etc. Events are excepted, because the main
// interface is for the entire event. The event app itself is basically the
// event view.
//
// Each view has a matching template (defined in event.ejs) that contains its
// markup. On top of that, it defines various events (to respond to, eg, clicks
// on its own elements) as well as other on-render behavior to change how
// the view looks in response to changes in its model or other application
// state.

define([
   "underscore", "backbone", "video", "logger", "models", "auth",
   "backbone.marionette", "underscore-template-config"
], function(_, Backbone, video, logging, models, auth) {

var views = {};
var logger = new logging.Logger("event-views");

var userViewCache = {};

views.SessionView = Backbone.Marionette.ItemView.extend({
    template: '#session-template',
    className: 'session',
    firstUserView: null,
    ui: {
        attend: '.attend',
        start:'.start',
        deleteButton: '.delete',        // delete is reserved word
        hangoutUsers: '.hangout-users',
        hangoutOffline: '.hangout-offline'
    },

    events: {
        'click .attend':'attend',
        'click .start':'start',
        'click .delete':'delete',
        'click h3':'headerClick'
    },

    initialize: function() {
        // if we get a notice that someone has connected to the associated participant,
        // re-render to show them.
        this.listenTo(this.model, 'change:connectedParticipants', this.render, this);
    },

    onRender: function() {
        var start = new Date().getTime();
        this.$el.attr("data-session-id", this.model.id);
        // mostly just show/hide pieces of the view depending on
        // model state.
        this.$el.addClass("live");

        // remove the toggle-ness of the button once the event starts.
        this.ui.attend.attr("data-toggle", "");
        this.ui.attend.removeClass("btn-info");
        this.ui.attend.removeClass("active");
        this.ui.attend.addClass("btn-success");

        this.ui.attend.find(".text").text("JOIN");

        // don't show the x of 10 when it's live (at least until we have live data for that)
        this.$el.find(".start").show();

        var numAttendees = this.model.getNumConnectedParticipants();

        this.$el.find(".attendance").css("width", ((numAttendees / this.model.MAX_ATTENDEES)*100) + "%");

        // now check and see if the hangout is communicating properly with the server. if it is, show
        // the hangout-users div, and populate it with users.
        this.$el.addClass("hangout-connected");

        // trying to simply not do the individual picture display to see if this helps.
        // (it does mostly, but there's still some slowness)
        this.ui.hangoutUsers.empty();

        var fragment = document.createDocumentFragment();

        _.each(this.model.get("connectedParticipants"), _.bind(function(udata) {
            // try looking up the user view from the main user list.
            var userView;
            if(udata.id in userViewCache) {
                userView = userViewCache[udata.id];
            } else {
                // vivify the user into a model when passing it in.  Note that
                // any events bound on the `users` collection of connected
                // participants won't work here.  When users join a session
                // without being connected to the `events` page, they won't appear
                // in that collection anyway.
                userView = new views.UserView({model:new models.User(udata)});
                userViewCache[udata.id] = userView;
            }

            fragment.appendChild(userView.render().el.cloneNode(true));
        }, this));


        this.ui.hangoutUsers.append(fragment);

        for(var i=0; i<10-numAttendees; i++) {
            this.ui.hangoutUsers.append($("<li class='empty'></li>"))
            // fragment.appendChild($("<li class='empty'></li>"));
        }


        this.ui.hangoutUsers.show();
        this.ui.hangoutOffline.hide();

        this.ui.attend.find(".icon-lock").hide();
        if(!this.options.event.sessionsOpen() || numAttendees == this.model.MAX_ATTENDEES) {
            this.ui.attend.find(".icon-lock").show();

            this.ui.attend.attr("disabled", true);
            this.ui.attend.addClass("disabled");

            if(numAttendees==this.model.MAX_ATTENDEES) {
                this.ui.attend.find(".text").text("JOIN (full)");
            }
        } else {
            this.ui.attend.removeAttr("disabled");
            this.ui.attend.removeClass("disabled");
        }
    },

    destroy: function() {
        this.model.destroy();
    },

    attend: function() {
        // if the event currently has closed sessions, ignore
        // clicks on the join button.
        if(!this.options.event.sessionsOpen()) {
            return;
        }

        // if the event has started, button presses should attempt to join
        // the hangout.
        var url = "/session/" + this.model.get("session-key") +
                  "?nocache=" + new Date().getTime();
        window.open(url);
    },

    "delete": function() {
        this.options.sock.send(JSON.stringify({
            type: "delete-session",
            args: {
                id: this.model.id, roomId: this.options.event.getRoomId()
            }
        }));
    }
});

// The list view contains all the individual session views. We don't
// manually make the session views - all that is handled by the
// marionette CollectionView logic.
views.SessionListView = Backbone.Marionette.CollectionView.extend({
    template: "#session-list-template",
    itemView: views.SessionView,
    itemViewContainer: '#session-list-container',
    emptyView: Backbone.Marionette.ItemView.extend({
        template: "#session-list-empty-template"
    }),
    id: "session-list",

    itemViewOptions: function() {
        return {event: this.options.event, sock: this.options.sock};
    }
})


// UserViews are the little square profile pictures that we use throughout
// the app to represent users.

views.UserView = Backbone.Marionette.ItemView.extend({
    template: '#user-template',
    className: 'user focus',
    tagName: "li",

    events: {
        'click' : 'click'
    },


    click: function() {
        logger.log("user clicked: " + this.model.get("displayName"));
    },

    onRender: function() {
        // add in the tooltip attributes
        if(this.model.isAdminOf(this.options.event)) {
             this.$el.addClass("admin");
        }

        // look for either an img or an i child, since people who don't have
        // a g+ icon should still get tooltips
        this.$el.find("img, i").attr("data-toggle", "tooltip");

        // if we're a child of hangout-users, then we're a small session user icon,
        // not a big presence gutter icon. in this case, make the data container
        // the session.
        if(this.$el.parent().hasClass("hangout-users")) {
            // this.$el.find("img, i").attr("data-container", "#chat-container-region");
            this.$el.find("img, i").attr("data-placement", "top");
        } else {
            this.$el.find("img, i").attr("data-container", "body");
            this.$el.find("img, i").attr("data-placement", "left");
        }

        this.$el.find("img, i").attr("title", this.model.get("displayName"));
        this.$el.find("img, i").tooltip();
    }
});

// Turn a string into a session message.
function formatSessionMessage(val) {
    return "##unhangouts## " + auth.USER_NAME + ": " + $.trim(val);
}

// The DialogView contains all our dialog boxes. This is a little awkward, but
// when we tried associated dialog boxes with the views that actually trigger them
// we ran into all sorts of z-index issues, because those views were all
// over the DOM and had different situations. Instead, we just put them
// all in one place for easy bootstrap dialog triggering. We also house
// the relevant events related to those dialog boxes here.
views.DialogView = Backbone.Marionette.Layout.extend({
    template: "#dialogs-template",

    id: "dialogs",

    events: {
        'click #send-session-message': 'sendSessionMessage',
        'click #disconnected-modal a':'closeDisconnected',
        'click #create-session':'createSession',
        'change [name=session_type]': 'changeSessionType',
        'click .add-url-to-message': 'addUrlToSessionMessage',
        'change #session_message': 'updateSessionMessage',
        'keydown #session_message': 'updateSessionMessage',
        'keyup #session_message': 'updateSessionMessage'
    },
    addUrlToSessionMessage: function(event) {
        event.preventDefault();
        var el = $("#message-sessions-modal textarea");
        var val = el.val();
        el.val(val + "\n Copy and paste: " + window.location.href.split("#")[0]);
        el.change();
    },
    updateSessionMessage: function(event) {
        $("#message-sessions-modal .faux-hangout-notice .message").html(
            formatSessionMessage($("#session_message").val())
        );
    },
    sendSessionMessage: function(event) {
        event.preventDefault();
        var val = $("#session_message").val();
        if (!val) { return; }
        var args = {
            message: formatSessionMessage(val),
            roomId: this.options.event.getRoomId()
        }
        this.options.sock.send(JSON.stringify({
            type: "broadcast-message-to-sessions",
            args: args
        }));
        $("#message-sessions-modal").modal('hide');
    },
    changeSessionType: function() {
        var val = this.$("[name='session_type']:checked").val();
        switch (val) {
            case "simple":
                this.$(".youtube-url, .webpage-url").hide();
                break;
            case "video":
                this.$(".youtube-url").show();
                this.$(".webpage-url").hide();
                break;
            case "webpage":
                this.$(".webpage-url").show();
                this.$(".youtube-url").hide();
                break;
        };
    },
    createSession: function(event) {
        event.preventDefault();
        var scope = $("#create-session-modal");
        var title = $("#session_name", scope).val();
        var type = $("[name='session_type']:checked", scope).val();
        var activities = [];
        switch (type) {
            case "simple":
                activities.push({type: "about", autoHide: true});
                break;
            case "video":
                var ytid = this.extractYoutubeId($("#session_youtube_id", scope).val());
                if (ytid == "" || _.isNull(ytid)) {
                    $(".yt-error", scope).show();
                    $("#session_youtube_id", scope).parent().addClass("error");
                    return;
                } else {
                    activities.push({type: "video", video: {provider: "youtube", id: ytid}});
                }
                break;
            case "webpage":
                var url = this.$("#session_webpage").val();
                if (!/^https:\/\//.test(url)) {
                    $(".url-error", scope).show();
                    $("#session_webpage", scope).parent().addClass("error");
                    return;
                } else {
                    activities.push({type: "webpage", url: url});
                }
                break;
        }

        this.options.sock.send(JSON.stringify({
            type:"create-session",
            args: {
                title: title,
                description:"",
                activities: activities,
                roomId: this.options.event.getRoomId()
            }
        }));
        $("input[type=text]", scope).val("");
        $(".yt-error, .url-error", scope).hide();
        $(".error", scope).removeClass(".error")
        scope.modal('hide');
    },

    closeDisconnected: function() {
        $("#disconnected-modal").modal('hide');
    }
})

// Generates the admin menu items.
views.AdminButtonView = Backbone.Marionette.Layout.extend({
    template: "#admin-button-template",

    id: "admin-button",

    firstRun: true,

    events: {
        'click #open-sessions':'openSessions',
        'click #close-sessions':'closeSessions',
        'click #message-sessions': 'messageSessions',
        'click #admin-stop-event': 'stopEvent',
        'click #admin-start-event': 'startEvent'
    },

    openSessions: function(jqevt) {
        jqevt.preventDefault();
        this.options.sock.send(JSON.stringify({
            type: "open-sessions",
            args: {roomId: this.options.event.getRoomId()}
        }));
    },

    closeSessions: function(jqevt) {
        jqevt.preventDefault();
        this.options.sock.send(JSON.stringify({
            type: "close-sessions",
            args: {roomId: this.options.event.getRoomId()}
        }));
    },

    startEvent: function(jqevt) {
        jqevt.preventDefault();
        this._startStopEvent("start");
    },
    stopEvent: function(jqevt) {
        jqevt.preventDefault();
        this._startStopEvent("stop");
    },
    _startStopEvent: function(action) {
        $.ajax({
            type: 'POST',
            url: "/admin/event/" + this.options.event.id + "/" + action
        }).fail(function(err) {
            logger.error(err);
            alert("Server error!");
        }).done(_.bind(function() {
            window.location.href = window.location.href;
        }, this));
    },

    messageSessions: function(jqevt) {
        jqevt.preventDefault();
        $("#message-sessions-modal").modal('show');

    },

    onRender: function() {
        if(this.firstRun && NUM_HANGOUTS_FARMED==0) {
            // $("#no-urls-warning").modal('show');
            logger.log("No farmed hangouts available!");
        }
    },

    // this little hack is to make sure the hangout count
    // is available in the template rendering.
    serializeData: function() {
        return {
            event: this.options.event,
            numFarmedHangouts: NUM_HANGOUTS_FARMED
        }
    }
});

// The UserColumn is the gutter on the right that shows who's connected to the
// unhangout right now. We use a layout to encapsulate it and provide the UI
// around the core set of UserViews. You can read more about layouts in the
// Backbone.Marionette docs.
views.UserColumnLayout = Backbone.Marionette.Layout.extend({
    template: "#user-column-layout-template",

    id: "user-column",

    userListView: null,

    regions: {
        userList: "#user-list",
        footer: "#footer"
    },

    initialize: function() {
        this.userListView = new views.UserListView({collection:this.options.users});
    },

    onRender: function() {
        this.userList.show(this.userListView);
    },
});

// The actual core UserListView that manages displaying each individual user.
// This logic is quite similar to the SessionListView, which also deals with
// pagination in a flexible-height space.
views.UserListView = Backbone.Marionette.CompositeView.extend({
    template: '#user-list-template',
    itemView: views.UserView,
    itemViewContainer: "#user-list-container",
    id: "user-list",

    initialize: function() {
        this.listenTo(this.collection, 'add remove', function() {
            // going to manually update the current user counter because
            // doing it during render doesn't seem to work. There's some
            // voodoo in how marionette decides how much of the view to
            // re-render on events, and it seems to exclude the piece out-
            // side the item-view-container, assuming it doesn't have
            // reactive bits.
            // I would also expect this to be .totalRecords, but for
            // some reason totalRecords doesn't decrease when records
            // are removed, but totalUnfilteredRecords does. Could
            // be a bug.

            // Other side note: be aware that there is some magic in
            // marionette around adding to collections. It apparently
            // tries to just auto-add the new record to the
            // itemViewContainer. This is a little weird when
            // combined with the pagination system, which doesn't
            // necessarily show all incoming models. Just something
            // to keep an eye on. More info here:
            // https://github.com/marionettejs/backbone.marionette/blob/master/docs/marionette.compositeview.md#model-and-collection-rendering

            this.$el.find(".header .contents").text(this.collection.length);
        }, this);
    },

    serializeData: function() {
        var data = {};

        data = this.collection.toJSON();

        data["numUsers"] = this.collection.length;

        logger.log("running user list serialize data");
        return data;
    },

    update: function() {
        logger.log("rendering UserListView");
        this.render();
    }
});

// Manages chat message display. The layout piece sets up the differnt chat zones:
// the area where we show messages, the space where we put users, and the space
// where chat messages are entered.
views.ChatLayout = Backbone.Marionette.Layout.extend({
    template: '#chat-layout',
    id: 'chat',

    regions: {
        welcome: '#welcome-message',
        chat:'#chat-messages',
        presence: '#presence-gutter',
        chatInput: '#chat-input-region'
    },

    initialize: function(options) {
        Backbone.Marionette.View.prototype.initialize.call(this, options);
        this.welcomeView = new views.WelcomeView({
            messages: this.options.messages,
            model: this.options.event
        });
        this.chatView = new views.ChatView({
            collection: this.options.messages,
            event: this.options.event
        });
        this.userListView = new views.UserListView({
            collection: this.options.users,
            event: this.options.event
        });
        this.chatInputView = new views.ChatInputView({
            event: this.options.event,
            sock: this.options.sock
        });

        logger.log("initializing chat layout with: " + JSON.stringify(this.options.messages));
        logger.log("and users: " + JSON.stringify(this.options.users));
    },

    onRender: function() {
        this.welcome.show(this.welcomeView);
        this.chat.show(this.chatView);
        this.presence.show(this.userListView);
        this.chatInput.show(this.chatInputView);
    }
});

views.WelcomeView = Backbone.Marionette.ItemView.extend({
    template: '#welcome-message-template',
    initialize: function(options) {
        Backbone.Marionette.ItemView.prototype.initialize.call(this, options);
        if (options.messages.length === 0) {
            options.messages.once("add", this.render);
        }
    },
    serializeData: function() {
        var chatArchiveUrl = null;
        if (this.options.messages.length > 0) {
            chatArchiveUrl = this.model.getChatArchiveUrl();
        }
        return _.extend(this.model.toJSON(), {
            chatArchiveUrl: this.model.getChatArchiveUrl()
        });
    }
});


// The input form for sending chat messages.
views.ChatInputView = Backbone.Marionette.ItemView.extend({
    template: '#chat-input-template',

    events: {
        'submit form':'chat'
    },

    ui: {
        chatInput: "#chat-input"
    },

    initialize: function(options) {
        Backbone.Marionette.View.prototype.initialize.call(this, options);
    },

    chat: function(e) {
        var msg = this.ui.chatInput.val();

        if(msg.length>0) {
            this.options.sock.send(JSON.stringify({
                type: "chat",
                args: {text: msg, roomId: this.options.event.getRoomId()}
            }));
            this.ui.chatInput.val("");
        }

        e.preventDefault();
        return false;
    },

    onRender: function() {
        if(!this.options.event.isLive()) {
            this.$el.find("#chat-input").attr("disabled", true);
            this.$el.find("#chat-input").addClass("disabled");
        } else {
            this.$el.find("#chat-input").removeAttr("disabled");
            this.$el.find("#chat-input").removeClass("disabled");
        }
    }
});

// The view for an individual chat message.
views.ChatMessageView = Backbone.Marionette.ItemView.extend({
    template: '#chat-message-template',
    className: 'chat-message',
    tagName: 'li',

    initialize: function() {
        Backbone.Marionette.ItemView.prototype.initialize.apply(this, arguments)
        this.model.set("text", this.linkify(this.model.get("text")));
    },

    // Finds and replaces valid urls with links to that url. Client-side only
    // of course; all messages are sanitized on the server for malicious content.
    linkify: function(msg) {
        var replacedText, replacePattern1, replacePattern2, replacePattern3, replacePattern4;

        //URLs starting with http://, https://, or ftp://
         replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
         replacedText = msg.replace(replacePattern1, "<a href='$1' target='_blank'>$1</a>");

         //URLs starting with "www." (without // before it, or it'd re-link the ones done above).
         replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
         replacedText = replacedText.replace(replacePattern2, "$1<a href='http://$2' target='_blank'>$2</a>");

         //Change email addresses to mailto:: links.
         replacePattern3 = /(([a-zA-Z0-9\-?\.?]+)@(([a-zA-Z0-9\-_]+\.)+)([a-z]{2,3}))+$/;
        replacedText = replacedText.replace(replacePattern3, "<a href='mailto:$1'>$1</a>");

        return replacedText;
    },

    // We want to use shortNames so we intercept this process to make the short
    // display name visible within the template rendering, since we can't
    // call object methods during that process.
    serializeData: function() {
        var model = this.model.toJSON();

        // if we have a user object (ie if we're not a system generated
        // message) then convert its name to the short display name.
        if(this.model.has("user")) {
            var tempUser = new models.User(this.model.get("user"));
            model.user["shortDisplayName"] = tempUser.getShortDisplayName();
        } else {
            // fill in a sort of fake empty name, just to the templating
            // system doesn't freak out.
            model.user = {shortDisplayName:""};
        }
        return model;
    },

    onRender: function() {

        if (!this.model.has("user")) {
            // mark this chat message as a system message, so we can
            // display it differently.
            this.$el.addClass("system");
        } else if (this.options.isAdmin) {
            this.$el.find(".from").addClass("admin");
        }

        if (this.model.get("past")) {
            this.$el.addClass("past");
        }
    }
});

// This view contains all the ChatMessageViews and handles scrolling for them.

views.ChatView = Backbone.Marionette.CompositeView.extend({
    template: '#chat-template',
    itemView: views.ChatMessageView,
    itemViewContainer: "#chat-list-container",
    id: "chat-container",

    initialize: function() {
        Backbone.Marionette.CompositeView.prototype.initialize.apply(this, arguments);
        this.collection.on("over-capacity", _.bind(function() {
            if (this._overCapacityTimeout) {
                clearTimeout(this._overCapacityTimeout);
            }
            this.$(".over-capacity-warning").show();
            this._overCapacityTimeout = setTimeout(_.bind(function() {
                this.$(".over-capacity-warning").fadeOut();
            }, this), 3000);

        }, this));
    },
    itemViewOptions: function(model, index) {
        return {
            model: model,
            isAdmin: new models.User(model.get("user")).isAdminOf(this.options.event)
        };
    },
    onBeforeItemAdded: function() {
        this.scroller = $("#chat-container-region");
        var limit = Math.max(this.scroller[0].scrollHeight - this.scroller.height() - 10, 0);
        this._isScrolled = this.scroller.scrollTop() < limit;
        return null;
    },
    onAfterItemAdded: function() {
        var latest = this.collection.at(this.collection.length - 1);
        // Scroll down if we haven't moved our scroll bar, or the last message
        // was from ourselves.
        if (!this._isScrolled || latest.get("user").id == auth.USER_ID) {
            this.scroller.scrollTop(this.el.scrollHeight);
        }
    }
});

// The bar that appears when your session goes live.
views.SessionLiveView = Backbone.Marionette.ItemView.extend({
    template: "#session-live-bar-template",
    id: "session-live-bar"
});

views.AboutEventView = Backbone.Marionette.ItemView.extend({
    template: "#about-event-template",
    id: "about-event",

    events: {
        'click .scroll-up': 'scrollUp'
    },

    initialize: function() {
        this.listenTo(this.model, 'change:description', _.bind(function() {
            $(".updated").removeClass("hide");
            this.render();
        }, this), this);
    },
    serializeData: function() {
        var context = this.model.toJSON();
        context.event = this.model;
        return context;
    },
    scrollUp: function(jqevt) {
        if (jqevt) { jqevt.preventDefault(); }
        if (this.model.isLive() && $("#about-event").is(":visible")) {
            // Delegate click to #about-nav, assuming it will handle the
            // scroll-up.  Slightly ugly but works.
            $("#about-nav").click();
        }
    },

    onRender: function() {
        if(this.model.isLive()) {
            this.$el.find(".footer").hide();
        } else {
            this.$el.find(".footer").show();
        }
    }
});

// Manages the display of embedded videos on the upper left corner.
views.VideoEmbedView = Backbone.Marionette.ItemView.extend({
    id: 'video-embed',
    template: '#video-embed-template',
    controlsTemplate: _.template($("#video-embed-controls-template").html()),
    previousVideoDetailsTemplate: _.template($("#previous-video-details-template").html()),
    ui: {
        player: ".video-player",
        placeholder: ".video-placeholder",
        controls: ".video-controls",
    },
    events: {
        'click .set-video': 'setVideo',
        'click .remove-video': 'removeVideo',
        'click .restore-previous-video': 'restorePreviousVideo',
        'click .play-for-all': 'playForAll',
        'click .remove-hoa': 'removeHoA'

    },

    player: null,

    initialize: function() {
        this.listenTo(this.model, "change:youtubeEmbed", function(model, youtubeEmbed) {
            if (youtubeEmbed) {
                this.setPlayerVisibility(true);
                this.yt.setVideoId(this.model.get("youtubeEmbed"));
            } else {
                this.setPlayerVisibility(false);
            }
            this.renderControls();
        }, this);
        this.listenTo(this.model, "change:hoa", this.render);
    },
    serializeData: function() {
        var context = this.model.toJSON();
        context.hoa = null;
        if (this.model.get("hoa")) {
            context.hoa = this.model.get("hoa").toJSON();
        }
        return context;
    },
    setVideo: function(jqevt) {
        jqevt.preventDefault();
        var youtubeInput = this.$("input[name='youtube_id']");
        var youtubeInputParent = youtubeInput.parent();
        var youtubeInputError = this.$("p.text-warning");
        var ytId = video.extractYoutubeId(youtubeInput.val());
        if (ytId == null) {
            // Invalid youtube URL/embed code specified.
            youtubeInputError.show();
            youtubeInputParent.addClass("error");
        } else {
            youtubeInputParent.removeClass("error");
            youtubeInputError.hide();
            var message = {
                type: "embed",
                args: {ytId: ytId, roomId: this.model.getRoomId()}
            };
            this.options.sock.send(JSON.stringify(message));
        }
    },
    removeVideo: function(jqevt) {
        jqevt.preventDefault();
        this.model.setEmbed(null);
        this.options.sock.send(JSON.stringify({
            type: "embed",
            args: {ytId: null, roomId: this.model.getRoomId()}
        }));
    },
    removeHoA: function(jqevt) {
        jqevt.preventDefault();
        // ensure hangout-broadcast-id is null, even if other things are
        // incongruent.
        this.model.setHoA(null);
        this.options.sock.send(JSON.stringify({
            type: "remove-hoa",
            args: {roomId: this.model.getRoomId()}
        }));
    },
    playForAll: function(jqevt) {
        this.yt.playForEveryone(jqevt);
    },
    restorePreviousVideo: function(jqevt) {
        jqevt.preventDefault();
        var ytId = $(jqevt.currentTarget).attr("data-youtube-id");
        var message = {
            type:"embed",
            args: {
                ytId: ytId,
                roomId: this.model.getRoomId()
            }
        };
        this.options.sock.send(JSON.stringify(message));
    },
    setPlayerVisibility: function(visible) {
        // Display player if it's visible.
        this.ui.player.toggle(visible);
        // Show a placeholder ("video goes here") if video is not visible and
        // the user is an admin.  Non-admins get nothing.
        this.ui.placeholder.toggle(!visible && IS_ADMIN);
        // Always show controls if the user is an admin.
        this.ui.controls.toggle(IS_ADMIN);
    },
    renderControls: function() {
        var hoa = this.model.get("hoa");
        var context = _.extend(this.model.toJSON(), {
            hoaParticipationLink: hoa ? hoa.getParticipationLink() : null,
            numHoaParticipants: hoa ? hoa.getNumConnectedParticipants() : null,
            isPlayingForEveryone: this.yt.isPlayingForEveryone(),
        });

        this.ui.controls.html(this.controlsTemplate(context));

        // Make the video details pretty.
        _.each(this.model.get("previousVideoEmbeds"), _.bind(function(embed) {
            video.getVideoDetails(embed.youtubeId, _.bind(function(data) {
                this.$("[data-youtube-id='" + data.id + "']").replaceWith(
                    this.previousVideoDetailsTemplate(data)
                );
            }, this));
        }, this));
    },
    onRender: function() {
        this.yt = new video.YoutubeVideo({
            ytID: this.model.get("youtubeEmbed"),
            permitGroupControl: IS_ADMIN,
            showGroupControls: false // We're doing our own controls on event pages.
        });
        if (IS_ADMIN) {
            this.yt.on("renderControls", _.bind(function() {
                this.renderControls();
            }, this));
        };
        this.yt.on("control-video", _.bind(function(args) {
            _.extend(args, {roomId: this.model.getRoomId()});
            this.options.sock.send(JSON.stringify({type: "control-video", args: args}));
        }, this));

        this.$(".video-player").html(this.yt.el);

        this.setPlayerVisibility(!!this.model.get("youtubeEmbed"));

        if (this.model.get("youtubeEmbed")) {
            this.yt.render();
        } else {
            this.renderControls();
        }
    },
    control: function(args) {
        this.yt.receiveControl(args);
    }
});

return views;
});
