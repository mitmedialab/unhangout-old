require([
  'jquery', 'underscore', 'transport', 'auth', 'client-models', 'bootstrap'
], function($, _, transport, auth, models) {

    var curEvent = new models.ClientEvent(EVENT_ATTRS);
    var eventTitle = curEvent.get("title");
    var eventID = curEvent.id; 

    $(document).ready(function() { 
        $("#send-email-to-all").click(function() {
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

        $(".previous").click(function() {

            if(participantIndex <= 0) {
                participantIndex = 0;
                return; 
            }

            participantIndex = participantIndex - 1;

            window.location.reload();
            window.location.href = "/followup/event/" + eventID + 
                "/participant_" + participantIndex; 
        });

        $(".next").click(function() {
            
            if(participantIndex >= userData.length) {
                participantIndex = userData.length; 
                return;
            }

            participantIndex = participantIndex + 1;

            window.location.reload();
            window.location.href = "/followup/event/" + eventID + 
                "/participant_" + participantIndex; 
            
        });
    });

});
