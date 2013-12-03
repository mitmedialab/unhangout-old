
/****************************
      Activities UI
*****************************/

var FacilitatorView = Backbone.View.extend({
    template: _.template($('#facilitator').html()),
    events: {
        'click .hide-app': 'hide',
        'click .add-video': 'addVideo',
        'click .add-webpage': 'addWebpage'
    },
    initialize: function(options) {
        _.bindAll(this, "addViewForActivityData", "removeActivityView",
                  "render", "renderActivityLinks", "setActivity", "hide",
                  "addVideo", "addWebpage");
        this.session = options.session;
        this.event = options.event;
        this.sock = options.sock;
        this.activities = [];
        console.log("Initial activities", this.session.get("activities"));

        // Our socket is not just correct, not just articulate... it is *on message*.
        sock.onmessage = _.bind(function(message) {
            var msg = JSON.parse(message.data);
            console.log("SOCK", msg.type, msg.args);
            switch (msg.type) {
                case "auth-ack":
                    // When we're authorized, join the room for this session.
                    sock.sendJSON("join", {id: "session/" + session.id});
                    break;
                case "session/set-hangout-url-err":
                    // We got a different URL when we tried to set the hangout url.
                    // TODO: notify the user that this is the wrong URL for this
                    // hangout; the right one is in msg.args.url.
                    break;
                case "session/add-activity":
                    this.session.addActivity(msg.args.activity, {
                        broadcast: false,
                        renderLinks: true,
                        select: true
                    });
                    break;
                case "session/remove-activity":
                    this.session.removeActivity(msg.args.activity);
                    break;
                case "session/set-activity-presence":
                    this.session.setActivityPresence(msg.args.userId, msg.args.activity);
                    break;
                case "session/control-video":
                    var view = this._getViewForActivityData(msg.args.activity);
                    if (view) {
                        view.controlVideo(msg.args);
                    }
                    break;
            }
        }, this);
        this.session.on("addActivity", this.addViewForActivityData);
        this.session.on("removeActivity", _.bind(function(activityData) {
            var view = this._getViewForActivityData(activityData);
            if (view) {
                this.removeActivityView(view);
            }
        }, this));
    },
    addViewForActivityData: function(activityData, options) {
        // Create and render a new activity view corresponding with the given
        // data.
        var view;
        if (!options) {
            options = {};
        }
        switch (activityData.type) {
            case "video":
                view = new VideoActivity({session: this.session, activity: activityData,
                                          sock: this.sock});
                break;
            case "webpage":
                view = new WebpageActivity({session: this.session, activity: activityData});
                break;
            case "about":
                view = new AboutActivity({session: this.session, event: this.event});
                break;
        }
        view.on("selected", _.bind(function() {this.setActivity(view);}, this));
        this.activities.unshift(view);
        // Add it to the el -- we keep it around and hide/show rather than re-render.
        this.$(".activity").append(view.el);
        view.render();
        view.$el.hide();
        if (options.broadcast) {
            // Given some activity data from a new activity, broadcast to others in
            // the session that we have a new activity, and select it.
            this.sock.sendJSON("session/add-activity", {
                sessionId: this.session.id,
                activity: activityData
            });
        }
        if (options.renderLinks) {
            this.renderActivityLinks();
        }
        if (options.select) {
            this.setActivity(view);
        }
        return view;
    },
    removeActivityView: function(activityView) {
        // Remove the specified activity view.  This is just an "unrender" type
        // function -- doesn't call sockets or change the data model.
        this.activities = _.without(this.activities, activityView);
        if (activityView == this.currentActivity) {
            this.setActivity(this.activities[0]);
        }
        activityView.remove();
        this.renderActivityLinks();
    },
    render: function() {
        // This should only be called once -- all subsequent renders are
        // incremental; done with `setActivity` and `renderActivityLinks`.
        this.$el.html(this.template()).addClass("facilitator");
        var activitiesData = this.session.get('activities');
        for (var i = activitiesData.length - 1; i >= 0; i--) {
            this.addViewForActivityData(activitiesData[i], {
                broadcast: false, renderLinks: false, select: false
            });
        }
        this.renderActivityLinks();
        this.setActivity(this.activities[0]);
    },
    renderActivityLinks: function() {
        // Render the header links corresponding with the activities.
        var frag = document.createDocumentFragment();
        var that = this;
        _.each(this.activities, function(activityView) {
            var li = document.createElement("li");
            li.appendChild(activityView.getLink());
            // Add removal links for activities; but not for the 'about' activity.
            if (activityView.activity.type != "about") {
                var close = document.createElement("a");
                close.class = 'close-activity';
                close.href = '#';
                close.innerHTML = "<i class='icon-remove-circle' title='Remove from hangout'></i>"
                close.onclick = function(event) {
                    that.clickRemoveActivity(event, activityView);
                }
                li.appendChild(close);
            }
            frag.appendChild(li);
        });
        $(".activity-list .links").html(frag);
    },
    setActivity: function(activityView) {
        // Select and display the activity view specified.  To allow background
        // videos &c to play, we keep all views rendered and just hide/show
        // them.
        if (this.currentActivity) {
            this.currentActivity.$el.hide();
            this.currentActivity.undelegateEvents();
            this.currentActivity.setActive(false);
        }
        this.currentActivity = activityView;
        this.currentActivity.$el.show();
        this.currentActivity.delegateEvents();
        this.currentActivity.setActive(true);
    },
    setActivityPresence: function() {
        // TODO
    },
    hide: function(event) {
        // Hide the unhangout facilitator app.
        event.preventDefault();
        window.parent.postMessage({type: "hide"}, HANGOUT_ORIGIN);
    },
    addVideo: function(event) {
        // Add a youtube video activity, complete with controls for
        // simultaneous playback.
        event.preventDefault();
        var view = new AddVideoActivity();
        view.on("submit", _.bind(function(data) {
            this.session.addActivity(data, {broadcast: true, renderLinks: true, select: true});
        }, this));
    },
    addWebpage: function(event) {
        // Add a "webpage" type activity, which will just be an iframe with an
        // arbitrary page in it.
        event.preventDefault();
        var view = new AddWebpageActivity();
        view.on("submit", _.bind(function(data) {
            this.session.addActivity(data, {broadcast: true, renderLinks: true, select: true});
        }, this));
    },
    _getViewForActivityData: function(activityData) {
        return _.find(this.activities, function(a) {
            return _.isEqual(activityData, a.activity);
        });
    },
    clickRemoveActivity: function(event, activityView) {
        // Handler for clicks on the close "x" for activities.
        event.preventDefault();
        var view = new RemoveActivity();
        view.on("submit", _.bind(function() {
            if (this.session.removeActivity(activityView.activity)) {
                this.sock.sendJSON("session/remove-activity", {
                    sessionId: this.session.id,
                    activity: activityView.activity
                });
            }
        }, this));
    }
});

var BaseActivityView = Backbone.View.extend({
    initialize: function(options) {
        if (options.activity) {
            this.activity = options.activity;
        }
        this.session = options.session;
        this.$a = $("<a href='#'>" + this.getLinkText() + "</a>");
        this.$a.on("click", _.bind(function(evt) {
            evt.preventDefault();
            this.trigger("selected", this);
        }, this));
        _.bindAll(this, "render", "getLink", "getLinkText");
    },
    getLinkText: function() {
        // Should override this with something more interesting in subclasses.
        return this.activity.type
    },
    getLink: function() {
        return this.$a[0];
    },
    setActive: function(active) {
        this.$a.parent().toggleClass("active", active);
    },
    render: function() {
        var context = {cid: this.cid};
        this.$el.addClass(this.activity.type + "-activity");
        context.activity = this.activity;
        if (this.session) {
            context.session = this.session.toJSON();
        }
        if (this.event) {
            context.event = this.event.toJSON();
        }
        this.$el.html(this.template(context));
        if (this.onrender) {
            this.onrender();
        }
    }
});

var AboutActivity = BaseActivityView.extend({
    template: _.template($("#about-activity").html()),
    events: {
        'click #share-link': function(event) { $(event.currentTarget).select(); }
    },
    activity: {type: "about"},
    getLinkText: function() {
        return "About";
    }

});

// Youtube's iframe API works on a global callback.  So set up a global queue
// from which to construct our youtube embeds once we get to rendering.
window.YouTubeIframeAPIParams = [];
window.onYouTubeIframeAPIReady = function() {
    _.each(window.YouTubeIframeAPIParams, function(params) {
        new YT.Player(params.id, params.attrs);
    });
    window.YouTubeIframeAPIParams = [];
};
var VideoActivity = BaseActivityView.extend({
    template: _.template($("#video-activity").html()),
    DATA_API_URL: "https://gdata.youtube.com/feeds/api/videos/{id}?v=2&alt=json-in-script&callback=?",
    events: {
        'click .play-for-everyone': 'playForEveryone',
        'click .mute-for-everyone': 'muteForEveryone'
    },
    initialize: function(options) {
        BaseActivityView.prototype.initialize.apply(this, [options]);
        this.sock = options.sock;
        _.bindAll(this, "onrender", "onPlayerReady", "onPlayerStateChange",
                        "playForEveryone", "muteForEveryone", "controlVideo");
        // Get the title of the video from the data API -- it's not available
        // from the iframe API.
        var url = this.DATA_API_URL.replace("{id}", this.activity.video.id);
        $.getJSON(url, _.bind(function(data) {
            this.title = data.entry.title.$t.substring(0, 10) + (
                data.entry.title.$t.length > 10 ? "..." : ""
            );
            this.$a.find(".title").html(this.title);
        }, this));
    },
    getLinkText: function() {
        return "<span class='title'>" + (this.title || "Video") + "</span>";
    },
    onrender: function() {
        window.YouTubeIframeAPIParams.push({
            id: 'player-' + this.cid,
            attrs: {
                width: '320',
                height: '240',
                videoId: this.activity.video.id,
                events: {
                    onReady: this.onPlayerReady,
                    onStateChange: this.onPlayerStateChange
                },
                // Fix for z-index issues -- see http://stackoverflow.com/a/9074366
                playerVars: {
                    wmode: "transparent"
                }
            }
        });
        if (!window.YT) {
            var tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            document.body.appendChild(tag);
        } else {
            window.onYouTubeIframeAPIReady();
        }
    },
    onPlayerReady: function(event) {
        this.player = event.target;
        // Fix for z-index issues -- see http://stackoverflow.com/a/9074366
        this.$("iframe").attr("wmode", "Opaque");
    },
    onPlayerStateChange: function(event) {
        switch (event.data) {
            case YT.PlayerState.BUFFERING:
            case YT.PlayerState.PLAYING:
                this.$a.prepend("<span class='playing'>&#9654; </span>");
                break;
            default:
                this.$a.find(".playing").remove();
                break;
        }
    },
    playForEveryone: function(event) {
        event.preventDefault();
        var args = {
            sessionId: this.session.id,
            action: "play",
            activity: this.activity
        }
        this.controlVideo(args);
        this.sock.sendJSON("session/control-video", args)
    },
    muteForEveryone: function(event) {
        event.preventDefault();
        var args = {
            sessionId: this.session.id,
            action: "mute",
            activity: this.activity,
            muted: !this.player.isMuted()
        };
        this.sock.sendJSON("session/control-video", args);
        this.controlVideo(args);
    },
    controlVideo: function(args) {
        switch (args.action) {
            case "play":
                this.player.seekTo(0);
                this.player.playVideo();
                break;
            case "mute":
                var el = this.$(".mute-for-everyone");
                if (args.muted) {
                    this.player.mute();
                    el.addClass("active");
                    el.find(".text").html("Click to unmute for everyone");
                } else {
                    this.player.unMute();
                    el.removeClass("active");
                    el.find(".text").html("Mute for everyone");
                }
                break;
        }
    }
});

var WebpageActivity = BaseActivityView.extend({
    template: _.template($("#webpage-activity").html()),
    getLinkText: function() {
        if (this.activity.url) {
            return this.activity.url.replace(/^https?:\/\/(www\.)?/, "").substring(0, 10) + "...";
        }
        return "Webpage";
    },
    onrender: function() {
        var iframe = document.createElement("iframe");
        iframe.style.width = iframe.width = "100%";
        iframe.style.height = iframe.height = "100%";
        iframe.style.border = "none";
        iframe.src = this.activity.url;
        iframe.onerror = iframe.onError = function() {
            alert("There was a problem loading that webpage.");
        }

        var loadTimeout = setTimeout(iframe.onerror, 8000);
        var isLoaded = function() {
            console.log("Loaded successfully");
            clearTimeout(loadTimeout);
            $(".loading").remove();
        }
        // Discussion of this approach to detecting when an iframe has loaded:
        // http://www.nczonline.net/blog/2009/09/15/iframes-onload-and-documentdomain/
        // This doesn't catch 
        if (iframe.attachEvent) {
            iframe.attachEvent("onload", isLoaded);
        } else {
            iframe.onload = isLoaded;
        }
        this.$el.prepend(iframe);
    }
});

var BaseModalView = Backbone.View.extend({
    events: {
        'click input[type=submit]': 'validateAndGo'
    },
    initialize: function() {
        _.bindAll(this, "render", "validateAndGo", "validate", "close");
        $("body").append(this.el);
        this.render();
    },
    render: function() {
        this.$el.html(this.template()).addClass("modal hide fade");
        this.$el.modal('show');
    },
    validateAndGo: function(event) {
        event.preventDefault();
        var data = this.validate();
        if (data) {
            this.trigger("submit", data);
            this.close();
        }
    },
    close: function() {
        this.$el.on("hidden", _.bind(function() {
            this.remove();
        }, this));
        this.$el.modal("hide");

    }
});

var AddVideoActivity = BaseModalView.extend({
    template: _.template($("#add-video-activity").html()),
    validate: function() {
        var data = {};
        var val = this.$("input[type=text]").val();
        var newId;
        if (/^[-A-Za-z0-9_]{11}$/.test(val)) {
            newId = val;
        } else {
            // From http://stackoverflow.com/a/6904504 , covering any of the 15
            // or so different variations on youtube URLs.
            var re = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/i;
            var match = re.exec(val);
            if (match) {
                newId = match[1];
            } else {
                // Unmatched -- trigger error below.
                newId = '';
            }
        }
        if (newId.length != 11) {
            this.$(".video-url").addClass("error");
            this.$(".video-url .error-msg").show();
            return null;
        } else {
            return {type: "video", video: {provider: "youtube", id: newId}};
        }
    }
});

var AddWebpageActivity = BaseModalView.extend({
    template: _.template($("#add-webpage-activity").html()),
    validate: function() {
        var val = this.$("input[type=text]").val();
        var url;
        if (/^https?:\/\/.+$/.test(val)) {
            if (window.location.protocol == "https:" && !/^https.+$/.test(val)) {
                this.$(".error-msg").show();
                return null;
            } else {
                url = val;
            }
        } else {
            url = "//" + val;
        }
        return {type: "webpage", url: url};
    }
});

var RemoveActivity = BaseModalView.extend({
    template: _.template($("#remove-activity").html()),
    validate: function() {
        return true;
    }
});

/****************************
      Initialization
*****************************/


var HANGOUT_ORIGIN; // Will be set when the hangout CDM's us
var event = new models.Event(EVENT_ATTRS);
var session = new models.Session(SESSION_ATTRS);
var sock = new SockJS(document.location.protocol + "//" + document.location.hostname + ":" + document.location.port + "/sock");
var app = new FacilitatorView({session: session, event: event, sock: sock});
$("#app").html(app.el);
app.render();

/****************************************************
      Socket initialization and hangout management
*****************************************************/
// Convenience wrapper for posting messages.
sock.sendJSON = function(type, data) {
    sock.send(JSON.stringify({type: type, args: data}));
}
sock.onopen = function() {
    // Authorize ourselves, then join the room.
    console.log("SOCK open");
    sock.sendJSON("auth", {key: SOCK_KEY, id: USER_ID});
    // Once we have a socket open, acknowledge the hangout gadget informing us
    // of the hangout URL.
    window.addEventListener("message", function(event) {
        if (HANGOUT_ORIGIN_REGEX.test(event.origin)) {
            if (event.data.type == "url") {
                if (event.data.args.url) {
                    console.log("CDM inner set", event.data.args.url, event.origin);
                    session.set("hangout-url", event.data.args.url);
                    window.parent.postMessage({type: "url-ack"}, event.origin);
                    HANGOUT_ORIGIN = event.origin;
                }
            } else if (event.data.type == "participants") {
                console.log("innerCDM participants:", event.data.args);
                var data = event.data.args.participants;
                if (_.isString(data)) {
                    data = JSON.parse(data);
                }
                var participants = _.map(data, function(u) {
                    return u.person;
                });
                session.setConnectedParticipants(participants);
            }
        }
    }, false);
};

sock.onclose = function() {
    $('#disconnected-modal').modal('show');
    var checkIfServerUp = function() {
        var ping = document.location;
        $.ajax({
            url: ping,
            cache: false,
            async: false,
            success: function(msg) {
                window.location.reload();
            },
            error: function(msg) {
                timeout = setTimeout(checkIfServerUp, 250);
            }
        });
    };
    checkIfServerUp();
};

// Let the server know about changes to the hangout URL.
session.on("change:hangout-url", function() {
    sock.sendJSON("session/set-hangout-url", {
        url: session.get("hangout-url"),
        sessionId: session.id
    });
});
session.on("change:connectedParticipants", function() {
    sock.sendJSON("session/set-connected-participants", {
        sessionId: session.id,
        connectedParticipants: session.get("connectedParticipants")
    });
});
