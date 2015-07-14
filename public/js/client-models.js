
// Some slight variations on the models that run only on the client.
// Nothing major, just some events.

define([
   "models"
], function(models) {

models.ClientSessionList = models.SessionList.extend({

    initialize: function(options) {
        models.SessionList.prototype.initialize.call(this, options);
    },

    comparator: function(a, b) {
        // Sort by id (effectively, by order created); oldest on top.
        return a.id > b.id ? 1 : a.id < b.id ? -1 : 0;
    }
});

models.ClientEvent = models.Event.extend({
    initialize: function() {
        models.Event.prototype.initialize.call(this);

        this.set("sessions", new models.ClientSessionList(null, this));
    },
});

models.ClientUserList = models.UserList.extend({

    initialize: function(options) {
        models.UserList.prototype.initialize.call(this, options);
    },

    comparator: function(a, b) {
        // Sort by displayName.
        var a_name = a.get('displayName');
        var b_name = b.get('displayName');
        return a_name > b_name ? 1 : a_name < b_name ? -1 : 0;
    }
});

return models;

});
