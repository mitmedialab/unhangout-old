$(document).ready(function() {

var UserRowView = Backbone.Marionette.ItemView.extend({
    tagName: 'tr',
    template: '#user-row',
    events: {
        'click input.superuser': 'setSuperuser',
        'click .add-event': 'addEvent',
        'click .remove-event': 'removeEvent'
    },
    modelEvents: {
        'change': 'render'
    },
    initialize: function(options) {
        _.bindAll(this, "addEvent", "removeEvent", "setSuperuser", "postUserData");
    },
    serializeData: function() {
        var model = this.model;
        var context = model.toJSON();
        context.adminEvents = [];
        events.each(function(event) {
            var admins = event.get("admins");
            for (var i = 0; i < admins.length; i++) {
                if (admins[i].id == model.id || model.hasEmail(admins[i].email)) {
                    context.adminEvents.push(event.toJSON());
                    return;
                }
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
                action: "add-admin",
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
            action: "remove-admin",
            eventId: event.id
        }, function() {
            event.removeAdmin(user);
            user.trigger("change", user);
        }, function(error) {
            alert("Server error");
            console.error(error);
        });
    },
    setSuperuser: function(jqevt) {
        var model = this.model;
        var el = $(jqevt.currentTarget);
        var isSuperuser = el.is(":checked");
        // Safety: can't make yourself not a superuser.
        if (isSuperuser == false && model.id == USER_ID) {
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
    itemView: UserRowView,
    itemViewContainer: 'tbody',
    events: {
        'keyup input.filter-input': 'filterUsers'
    },
    ui: {
        'filterInput': 'input.filter-input'
    },
    initialize: function(options) {
        _.bindAll(this, 'filterUsers');
        // Clone users so we can manipulate it later.
        this.collection = new models.UserList(users.models);
    },
    filterUsers: function(jqevt) {
        var val = this.ui.filterInput.val();
        if (val == "") {
            this.collection.reset(users.models);
        } else {
            var tokens = val.toLowerCase().split(" ");
            this.collection.reset(_.filter(users.models, function(user) {
                var search = user.get("displayName") + " " + _.pluck(user.get("emails"), "value").join(" ");
                for (var i = 0; i < tokens.length; i++) {
                    if (search.indexOf(tokens[i]) == -1) {
                        return false;
                    }
                }
                return true;
            }));
        }
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
        this.trigger("add", events.get(parseInt(this.$("[name=event]").val())));
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

});


