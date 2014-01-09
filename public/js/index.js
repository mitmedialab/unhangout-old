// This code runs on the home page and does minor UI management.

$(document).on('ready', function() {

    $(".nav li").each(function(i, el) {
        if ($(el).find("a").attr("href") == window.location.pathname) {
            $(el).addClass("active");
        } else {
            $(el).removeClass("active");
        }
    });

	$("#subscribe").click(function() {
		var email = $("#email").val();

		$.ajax({
			url:"/subscribe",
			type:"POST",
			data: {email:email}
		}).done(function() {
			$('#subscription-modal').modal('show');
			console.log("posted email");
		});

		$("#email").val("");
	});

	$("#create-event-button").click(function() {
		$('#event-mini-form-modal').modal('show');
	});

	$('#submit-button').click(function() {		
		$('#contact-form').validate(
		 {
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
		    .text('OK!').addClass('valid')
		    .closest('.control-group').removeClass('error').addClass('success');
		  }
		 });
	});
});
