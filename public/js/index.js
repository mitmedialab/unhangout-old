// This code runs on the home page and does minor UI management.

require(['jquery', 'events-spreadsheet', 'jquery.validate', 'bootstrap', "auth", "update-navbars"], function($, eventsSpreadsheet) {

    var key = $("[data-spreadsheet-key]").attr("data-spreadsheet-key"); 
    var template = _.template($("#frontpage-events").html());
    eventsSpreadsheet.displayEvents(key, template);

    $(document).ready(function() {        
        $("#subscribe").click(function() {

            var email = $("#email").val();

            $.ajax({
                url:"/subscribe/",
                type:"POST",
                data: {email:email}
            }).done(function() {
                $('#subscription-modal').modal('show');
            }).fail(function() {
                alert("Server error.. please try later.");
            });

            $("#email").val("");
        });

        $("#login-first-button").click(function() {
            $('#login-first-modal').modal('show');
        });

        $("#create-event-button").click(function() {
            $('#event-mini-form-modal').modal('show');
        });

        $("#permalink-login").click(function() {
            $('#permalink-login-modal').modal('show');
            return false;
        });

        $('#contact-form').validate({
        
            submitHandler: function(form) {
                var eventTitle = $("#title").val();
                var eventDescription = $("#description").val();

                $(".event-title-validate-error").removeClass('show');
                $(".event-title-validate-error").addClass('hide');
                $(".event-desc-validate-error").removeClass('show');
                $(".event-desc-validate-error").addClass('hide');

                if(eventTitle.length < 5) {
                    $(".event-title-validate-error").removeClass('hide');
                    $(".event-title-validate-error").addClass('show');
                    return;
                }

                if(eventDescription.length < 100) {
                    $(".event-desc-validate-error").removeClass('hide');
                    $(".event-desc-validate-error").addClass('show');   
                    return; 
                }
 
                $.ajax({
                    url:"/admin-request/",
                    type:"POST",
                    data: {eventTitle: eventTitle, eventDescription: eventDescription}
                }).done(function() {
                    $('#event-mini-form-modal').modal('hide');
                    $('#session-submission-modal').modal('show');
                    $("#title").val("");
                    $("#description").val("");
                }).fail(function() {
                    alert("Server error.. please try later.");
                });

            }
        });
    });
});
