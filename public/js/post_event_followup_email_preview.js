require([
  'jquery', 'underscore', 'transport', 'auth', 'client-models', 'bootstrap'
], function($, _, transport, auth, models) {

    var curEvent = new models.ClientEvent(EVENT_ATTRS);
    var eventTitle = curEvent.get("title");
    var eventID = curEvent.id; 

    $(document).ready(function() { 
        $("#send-email-to-all").click(function() {
            console.log("show send email dialog");
            $("#send-email-dialog").modal('show');
        });

        $("#send-now-button").click(function() {
            $("#send-email-dialog").modal('show');
            
            $.ajax({
                type: 'POST',
                url: "/followup/event/" + curEvent.id + "/sent/",
                data: {eventTitle: eventTitle }
            }).fail(function(err) {
                console.log(err);
            }).success(function() {
                console.log("emails successfully sent");
            });
        });
    });
});
