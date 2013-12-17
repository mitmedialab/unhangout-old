
/****************************
      Activities UI
*****************************/

var FacilitatorView = Backbone.View.extend({
    template: _.template($('#facilitator').html()),
    events: {
        'click .hide-app': 'hide',
        'click .add-video': 'addVideo',
        'click .add-webpage': 'addWebpage',
        'click .grow, .shrink': 'toggleSidebar',
        'click .toggle-toolbar': 'toggleToolbar'
    },
    initialize: function(options) {
        _.bindAll(this, "addViewForActivityData", "removeActivityView",
                  "render", "renderActivityLinks", "setActivity", "hide",
                  "addVideo", "addWebpage", "toggleSidebar", "toggleToolbar",
                  "hideFacesIfActive", "showFacesIfActive");
        this.session = options.session;
        this.event = options.event;
        this.sock = options.sock;
        console.log("Initial activities", this.session.get("activities"));
        this.activities = [];
        if (this.session.get("activities").length == 0) {
            this.session.addActivity({type: "about", autoHide: true});
        }
        this.session.addActivity({type: "faces"});

        // Our socket is not just correct, not just articulate... it is *on message*.
        sock.onmessage = _.bind(function(message) {
            var msg = JSON.parse(message.data);
            console.log("SOCK", msg.type, msg.args);
            switch (msg.type) {
                case "auth-ack":
                    // When we're authorized, join the room for this session.
                    sock.sendJSON("join", {id: "session/" + session.id});
                    break;
                case "join-ack":
					// Once we have a socket open, acknowledge the hangout
					// gadget informing us of the hangout URL.
					window.addEventListener("message",
                                            this.handleCrossDocumentMessages,
                                            false);
                    break;
                case "session/set-hangout-url-err":
                    console.log("Bad hangout url.");
                    this.hideFacesIfActive();
                    // Get out of here!
                    new SwitchHangoutsDialog({correctUrl: msg.args.url});
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
    handleCrossDocumentMessages:  function(event) {
		if (HANGOUT_ORIGIN_REGEX.test(event.origin)) {
			if (event.data.type == "url") {
				if (event.data.args.url) {
					console.log("CDM inner set", event.data.args.url,
								event.origin);
					session.set("hangout-url", event.data.args.url);
					HANGOUT_ORIGIN = event.origin;
					postMessageToHangout({type: "url-ack"});
				}
			} else if (event.data.type == "participants") {
				console.log("CDM inner participants:", event.data.args);
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
                view = new AboutActivity({session: this.session, event: this.event,
                                          activity: activityData});
                break;
            case "faces":
                view = new FacesActivity({session: this.session, activity: activityData});
                this.faces = view;
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
        this.$el.html(this.template()).addClass("main-window");
        var activitiesData = this.session.get('activities');
        for (var i = activitiesData.length - 1; i >= 0; i--) {
            this.addViewForActivityData(activitiesData[i], {
                broadcast: false, renderLinks: false, select: false
            });
        }
        this.renderActivityLinks();
        
        // Set the initial state w/r/t toolbar and expansion.
        var allButFaces = _.filter(this.activities, function(a) {
            return a.activity.type != "faces";
        });
        if (allButFaces.length  == 1) {
            this.$(".activity-list-holder").hide();
            if (!_.contains(["webpage", "video"], allButFaces[0].activity.type)) {
                this.toggleSidebar();
            }
            this.setActivity(allButFaces[0]);
        } else {
            this.setActivity(this.activities[0]);
        }
    },
    renderActivityLinks: function() {
        // Render the header links corresponding with the activities.
        var frag = document.createDocumentFragment();
        var that = this;
        _.each(this.activities, function(activityView) {
            var li = document.createElement("li");
            li.appendChild(activityView.getLink());
            // Add removal links for activities; but not for the 'about' or 'faces' activity.
            if (!_.contains(["about", "faces"], activityView.activity.type)) {
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
    hide: function(event) {
        // Hide the unhangout facilitator app.
        event.preventDefault();
        postMessageToHangout({type: "hide"});
    },
    // Since it is always on top, we need to hide the faces view if we want
    // to display anything (a dialog, etc) above it. Use 'hideFacesIfActive'
    // when entering such a view and 'showFacesIfActive' when exiting.
    hideFacesIfActive: function() {
        this.faces.hideVideoIfActive();
    },
    showFacesIfActive: function() {
        this.faces.showVideoIfActive();
    },
    // Add a youtube video activity, complete with controls for simultaneous
    // playback.
    addVideo: function(event) {
        event.preventDefault();
        var view = new AddVideoActivity();
        this.hideFacesIfActive();
        view.on("submit", _.bind(function(data) {
            this.session.addActivity(data, {broadcast: true, renderLinks: true, select: true});
            this.showFacesIfActive();
        }, this));
        view.on("close", this.showFacesIfActive);
    },
    // Add a "webpage" type activity, which will just be an iframe with an
    // arbitrary page in it.
    addWebpage: function(event) {
        event.preventDefault();
        var view = new AddWebpageActivity();
        this.hideFacesIfActive();
        view.on("submit", _.bind(function(data) {
            this.session.addActivity(data, {broadcast: true, renderLinks: true, select: true});
            this.showFacesIfActive();
        }, this));
        view.on("close", this.showFacesIfActive);
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
        this.hideFacesIfActive();
        view.on("submit", _.bind(function() {
            this.showFacesIfActive();
            if (this.session.removeActivity(activityView.activity)) {
                this.sock.sendJSON("session/remove-activity", {
                    sessionId: this.session.id,
                    activity: activityView.activity
                });
            }
        }, this));
        view.on("close", this.showFacesIfActive);
    },
    toggleSidebar: function(event) {
        // This is rather ugly -- it special-cases the heck out of the 'faces'
        // activity in a rather brittle way, moving it to a different div when
        // we go to sidebar mode.  It has lots of edge cases -- which activity
        // is active when 'sidebar' mode is toggled? Etc.
        if (event) { event.preventDefault(); }
        this.$el.toggleClass("sidebar");
        var isSidebar = this.$el.hasClass("sidebar");
        
        // Move the faces app from the default activity list to its own space.
        if (isSidebar) {
            // Shrink to sidebar! 
            if (!this.faces) { return; }
            this.activities = _.without(this.activities, this.faces);
            this.renderActivityLinks();
            if (this.faces == this.currentActivity) {
                if (this.activities.length > 0) {
                    this.setActivity(this.activities[0]);
                }
            }
            $(".left-column").append(this.faces.el);
            this.faces.setActive(true);
            this.faces.resize();
        } else {
            // Expand to main!
            if (!this.faces) { return; }
            this.$(".activity").append(this.faces.el);
            this.activities.unshift(this.faces);
            var cur = this.currentActivity;
            this.setActivity(this.faces);
            this.faces.resize()
            this.setActivity(cur);
            this.renderActivityLinks();
        }
    },
    toggleToolbar: function(event) {
        $(".activity-list-holder").toggle();
    }
});

var BaseActivityView = Backbone.View.extend({
    initialize: function(options) {
        _.bindAll(this, "render", "getLink", "getLinkText", "_onSelect");
        if (options.activity) {
            this.activity = options.activity;
        }
        this.session = options.session;
        this.$a = $("<a href='#'>" + this.getLinkText() + "</a>");
    },
    delegateEvents: function() {
        this.$a.on("click", this._onSelect);
        return Backbone.View.prototype.delegateEvents.apply(this, arguments);
    },
    _onSelect: function(evt) {
        evt.preventDefault();
        this.trigger("selected", this);
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
    activity: {type: "about"},
    events: {
        'click #share-link': function(event) { $(event.currentTarget).select(); },
        'click .cancel-autohide': 'cancelAutohide'
    },
    initialize: function(options) {
        BaseActivityView.prototype.initialize.apply(this, [options]);
        _.bindAll(this, "cancelAutohide");
    },
    getLinkText: function() {
        return "About";
    },
    onrender: function() {
        if (this.activity.autoHide) {
            var count = 15;
            var that = this;
            that.autoHideInterval = setInterval(function() {
                that.$(".countdown").html(count);
                count--;
                if (count == 0) {
                    clearInterval(that.autoHideInterval);
                    that.$(".hide-app").click();
                }
            }, 1000);
        }
    },
    cancelAutohide: function() {
        if (this.autoHideInterval) {
            clearInterval(this.autoHideInterval);
        }
        $(".auto-hide").hide();
    }
});

var FacesActivity = BaseActivityView.extend({
    template: _.template($("#faces-activity").html()),
    initialize: function(options) {
        BaseActivityView.prototype.initialize.apply(this, [options]);
        _.bindAll(this, "resize");
        $(window).on("resize", this.resize);
    },
    onrender: function() {
        this.resize();
    },
    resize: function() {
        var pos = this.$el.position();
        var height;
        var dims = {
            top: pos.top,
            left: pos.left,
            width: this.$el.parent().width(),
            height: Math.min(this.$el.parent().height(), $(window).height())
        };
        postMessageToHangout({type: "set-video-dims", args: dims});
    },
    setActive: function(active) {
        BaseActivityView.prototype.setActive.apply(this, [active]);
        this.isActive = active;
        if (active) {
            postMessageToHangout({type: "show-video"});
        } else {
            postMessageToHangout({type: "hide-video"});
        }
    },
    hideVideoIfActive: function() {
        if (this.isActive) { postMessageToHangout({type: "hide-video"}); }
    },
    showVideoIfActive: function() {
        if (this.isActive) { postMessageToHangout({type: "show-video"}); }
    },
    getLinkText: function() {
        return "Faces";
    }
});

var VideoActivity = BaseActivityView.extend({
    template: _.template($("#video-activity").html()),
    initialize: function(options) {
        BaseActivityView.prototype.initialize.apply(this, [options]);
        this.sock = options.sock;
        _.bindAll(this, "onrender");
        // Get the title of the video from the data API -- it's not available
        // from the iframe API.
        this.yt = new YoutubeVideo({
            ytID: this.activity.video.id,
            showGroupControls: true
        });
        this.yt.getTitle(_.bind(function(title) {
            this.title = title.substring(0, 10) + (
                title.length > 10 ? "..." : ""
            );
            this.$a.find(".title").html(this.title);
        }, this));
        this.yt.on("control-video", _.bind(function(args) {
            args.sessionId = this.session.id;
            args.act
            this.sock.sendJSON("session/control-video", args);
        }, this));
    },
    getLinkText: function() {
        return "<span class='title'>" + (this.title || "Video") + "</span>";
    },
    onrender: function() {
        this.$el.html(this.yt.el);
        this.yt.render();
    },
    controlVideo: function(args) {
        this.yt.receiveControl(args);
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

/*
 * Modal dialogs
 */

var BaseModalView = Backbone.View.extend({
    events: {
        'click input[type=submit]': 'validateAndGo'
    },
    initialize: function() {
        _.bindAll(this, "render", "validateAndGo", "validate", "close");
        $("body").append(this.el);
        this.render();
        this.$el.on("hidden", _.bind(function() {
            this.trigger("close");
        }, this));
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
            this.trigger("close");
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

var SwitchHangoutsDialog = BaseModalView.extend({
    template: _.template($("#switch-hangouts").html()),
    initialize: function(options) {
        this.correctUrl = options.correctUrl;
        BaseModalView.prototype.initialize.apply(this, []);
    },
    render: function() {
        this.$el.html(this.template({url: this.correctUrl})).addClass("modal");
        this.$el.modal({backdrop: "static"});
        this.$el.modal('show');
    },
    validate: function(){}
});

/****************************
      Initialization
*****************************/


var HANGOUT_ORIGIN; // Will be set when the hangout CDM's us
var _messageQueue = [];
var postMessageToHangout = function(message) {
    if (message) {
        _messageQueue.push(message);
    }
    if (HANGOUT_ORIGIN) {
        _.each(_messageQueue, function(msg) {
            window.parent.postMessage(msg, HANGOUT_ORIGIN);
        });
        _messageQueue = [];
    } else {
        setTimeout(postMessageToHangout, 10);
    }
};
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
};

sock.onclose = function() {
    app.hideFacesIfActive();
    $('#disconnected-modal').modal('show');
    var checkIfServerUp = function() {
        var ping = document.location;
        $.ajax({
            url: ping,
            cache: false,
            async: false,
            success: function(msg) {
                postMessageToHangout({'type': 'reload'});
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
    console.log("Broadcasting new hangout URL", session.get("hangout-url"));
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

