require([
  'jquery', 'underscore', 'transport', 'auth', 'client-models', 'bootstrap'
], function($, _, transport, auth, models) {

if (auth.USER_ID) {
    var curEvent = new models.ClientEvent(EVENT_ATTRS);
    var trans = new transport.Transport(curEvent.getRoomId());
    trans.registerModel("event", curEvent);
    curEvent.on("change:open", function(event, open, options) {
        if (open) {
            // Reload to request the event page.
            window.location.reload();
        }
    });
}

});
