// This code runs on the home page and does minor UI management.

$(document).on('ready', function() {
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
});
