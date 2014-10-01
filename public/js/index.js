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
            rules: {
                title: {
                    required: true
                },
                description: {
                    required: true
                }
            },

            highlight: function(element) {
                $(element).closest('.form-group').removeClass('success').addClass('error');
            },

            success: function(element) {
                element
                .addClass('valid')
                .closest('.form-group').removeClass('error').addClass('success');
            },
            submitHandler: function(form) {
                var eventTitle = $("#title").val();
                var eventDescription = $("#description").val();

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
