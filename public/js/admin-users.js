require([
   "jquery", "underscore", "backbone", "client-models", "auth",
   // plugins
   "backbone.marionette", "bootstrap", "underscore-template-config"
], function($, _, Backbone, models, auth) {

$(document).ready(function() {

var users = new models.UserList(USER_DATA);
var events = new models.EventList(EVENT_DATA);

var UserRowView = Backbone.Marionette.ItemView.extend({
    tagName: 'tr',
    template: '#user-row',
    events: {
        'click input.superuser': 'setSuperuser',
        'click .add-event': 'addEvent',
        'click .remove-event': 'removeEvent',
        'click input.perm': 'setPerm'
    },
    modelEvents: {
        'change': 'render'
    },
    initialize: function(options) {
        _.bindAll(this, "addEvent", "removeEvent", "setSuperuser", "postUserData");
    },
    onRender: function() {
        // Set the user ID as an aid for testing.
        this.$el.attr("data-user-id", this.model.id);
    },
    serializeData: function() {
        var model = this.model;
        var context = model.toJSON();
        context.adminEvents = [];
        context.user = model;
        events.each(function(event) {
            var admins = event.get("admins");
            if (event.userIsAdmin(model)) {
                context.adminEvents.push(event.toJSON());
            }
        });
        return context;
    },
    addEvent: function(jqevt) {
        jqevt.preventDefault();
        var user = this.model;
        var modal = new EventAdminAdder({user: user});
        modal.render();
        modal.on("add", _.bind(function(event) {
            this.postUserData({
                action: "add-event-admin",
                eventId: event.id
            }, function() {
                event.addAdmin(user);
                user.trigger("change", user);
            }, function(error) {
                alert("Server error");
                console.error(error);
            });
        }, this));
    },
    removeEvent: function(jqevt) {
        jqevt.preventDefault();
        var user = this.model;
        var event = events.get($(jqevt.currentTarget).attr("data-event-id"));
        this.postUserData({
            action: "remove-event-admin",
            eventId: event.id
        }, function() {
            event.removeAdmin(user);
            user.trigger("change", user);
        }, function(error) {
            alert("Server error");
            console.error(error);
        });
    },
    setPerm: function(jqevt) {
        var user = this.model;
        var el = $(jqevt.currentTarget);
        var perm = el.attr("data-perm");
        var val = el.is(":checked");
        var post = {};
        post[perm] = val;

        var parent = el.parent();
        parent.addClass("loading").removeClass("success");
        this.postUserData({
            action: "set-perms",
            perms: JSON.stringify(post)
        }, function() {
            parent.removeClass("loading").addClass("success");
            user.setPerm(perm, val, {silent: true});
        }, function(error) {
            parent.addClass("error").removeClass("loading");
            alert("Server error");
            console.error(error);
        });
    },
    setSuperuser: function(jqevt) {
        var model = this.model;
        var el = $(jqevt.currentTarget);
        var isSuperuser = el.is(":checked");
        // Safety: can't make yourself not a superuser.
        if (!isSuperuser && model.id == auth.USER_ID) {
            alert("Can't remove your own superuser status. Ask another superuser to do it.");
            jqevt.preventDefault();
            jqevt.stopPropagation();
            return;
        }
        el.parent().addClass("loading");
        el.parent().removeClass("success");
        this.postUserData({
            action: "set-superuser",
            superuser: isSuperuser,
        }, function() {
            el.parent().removeClass("loading");
            el.parent().addClass("success");
            model.set("superuser", isSuperuser, {silent: true});
        }, function(error) {
            el.parent().addClass("error");
            el.parent().removeClass("loading");
            alert("Server error");
            console.error(error);
        });
    },
    postUserData: function(data, success, error) {
        var post = _.extend({userId: this.model.id}, data);
        $.ajax({
            type: 'POST',
            url: '/admin/users/',
            data: post,
            success: success,
            error: error
        });
    }
});
var UserTableView = Backbone.Marionette.CompositeView.extend({
    template: '#user-table',
    resultCountTemplate: _.template($("#user-result-count").html()),
    itemView: UserRowView,
    itemViewContainer: 'tbody',
    events: {
        'keyup input.filter-name': 'filterUsers',
        'change input.filter-superusers': 'filterSuperusers',
        'change input.filter-admins': 'filterAdmins',
        'change select.filter-perms': 'filterPerms',
        'click .show-more': 'showMore'
    },
    ui: {
        'filterName': 'input.filter-name',
        'filterSuperusers': 'input.filter-superusers',
        'filterAdmins': 'input.filter-admins',
        'filterPerms': 'select.filter-perms',
        'resultCount': 'div.result-count'
    },
    initialize: function(options) {
        _.bindAll(this, 'applyFilters', 'filterUsers', 'filterSuperusers',
                        'filterAdmins', 'filterPerms', 'showMore');
        // Clone users so we can manipulate it later.
        this.limit = 20;
        this.filter = {};
        this.collection = new models.UserList();
        this.applyFilters();
    },
    serializeData: function() {
        var context = Backbone.Marionette.CompositeView.prototype.serializeData.apply(this);
        context.permissions = [];
        if (users.length > 0) {
            users.at(0).eachPerm(function(key, has, human) {
                context.permissions.push([key, human]);
            });
        }
        context.totalCount = this.totalCount;
        context.limit = this.limit;
        return context;
    },
    applyFilters: function() {
        var models =_.filter(users.models, _.bind(function(user) {
            if (this.filter.superuser) {
                if (!user.isSuperuser()) {
                    return false;
                }
            }
            if (this.filter.perm) {
                if (!user.hasPerm(this.filter.perm)) {
                    return false;
                }
            }
            if (this.filter.name) {
                var tokens = this.filter.name.toLowerCase().split(" ");
                var search = (user.get("displayName") + " " +
                    _.pluck(user.get("emails"), "value").join(" ")).toLowerCase();

                for (var i = 0; i < tokens.length; i++) {
                    if (search.indexOf(tokens[i]) == -1) {
                        return false;
                    }
                }
            }
            if (this.filter.admin) {
                var isAdmin = _.some(events.models, function(event) {
                    return event.userIsAdmin(user);
                });
                if (!isAdmin) {
                    return false;
                }
            }
            return true;
        }, this));
        this.totalCount = models.length;
        this.collection.reset(models.slice(0, this.limit));
    },
    onAfterItemAdded: function() {
        this.renderCounts();
    },
    onItemRemoved: function() {
        this.renderCounts();
    },
    renderCounts: function() {
        this.ui.resultCount.html(this.resultCountTemplate({
            limit: this.limit, totalCount: this.totalCount
        }));
    },
    filterUsers: function(jqevt) {
        this.filter.name = this.ui.filterName.val();
        this.applyFilters();
    },
    filterSuperusers: function() {
        this.filter.superuser = this.ui.filterSuperusers.is(":checked");
        this.applyFilters();
    },
    filterAdmins: function() {
        this.filter.admin = this.ui.filterAdmins.is(":checked");
        this.applyFilters();
    },
    filterPerms: function() {
        this.filter.perm = this.ui.filterPerms.val();
        this.applyFilters();
    },
    showMore: function() {
        this.limit += 20;
        this.applyFilters();
    }
});

var EventAdminAdder = Backbone.View.extend({
    template: _.template($('#event-admin-adder').html()),
    events: {
        'click .close, .cancel': 'close',
        'click .add': 'add'
    },
    initialize: function(options) {
        _.bindAll(this, "add", "close", "render", "remove");
        this.user = options.user;
    },
    render: function() {
        this.$el.addClass("modal hide fade");
        this.$el.html(this.template({
            user: this.user,
            events: events
        }));
        this.$el.modal("show");
    },
    add:  function() {
        this.trigger("add", events.get(this.$("[name=event]").val()));
        this.close();
    },
    close: function() {
        this.$el.on("hidden", this.remove);
        this.$el.modal("hide");
    }
});


/* -------------------   App initialization ---------------- */

var app = new Backbone.Marionette.Application();
app.addRegions({
    main: "#main"
});
app.addInitializer(function(options) {
    var userTable = new UserTableView();
    this.main.show(userTable);
});
app.start();

}); // document.ready

}); // require
