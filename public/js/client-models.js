
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

return models;

});
