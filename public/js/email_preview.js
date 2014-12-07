require([
  'jquery', 'underscore', 'transport', 'auth', 'client-models', 'bootstrap'
], function($, _, transport, auth, models) {

    var curEvent = new models.ClientEvent(EVENT_ATTRS);
    var eventTitle = curEvent.get("title");

    $(document).ready(function() { 
        $("#send-email").click(function() {
            $.ajax({
                type: 'POST',
                url: "/followup/event/" + curEvent.id + "/sent/",
                data: {eventTitle: eventTitle }
            }).fail(function(err) {
                console.log(err);
            });
        });
    });

});
