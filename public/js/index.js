// This code runs on the home page and does minor UI management.

$(document).on('ready', function() {
	$("#subscribe").click(function() {
		var email = $("#email").val();

		$.ajax({
			url:"/subscribe/",
			type:"POST",
			data: {email:email}
		}).done(function() {
			$('#subscription-modal').modal('show');
			console.log("posted email");
		}).fail(function() {
            alert("Server error.. please try later.");
        });

		$("#email").val("");
	});

	$("#login-first-button").click(function() {
		$('#login-first-modal').modal('show');
	})

	$("#create-event-button").click(function() {
		$('#event-mini-form-modal').modal('show');
	});

	$('#contact-form').validate({
        rules: {
            title: {
                minlength: 5,
                required: true
            },

            description: {
                minlength: 100,
                required: true
            }
        },

        highlight: function(element) {
            $(element).closest('.control-group').removeClass('success').addClass('error');
        },

        success: function(element) {
            element
            .addClass('valid')
            .closest('.control-group').removeClass('error').addClass('success');
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
