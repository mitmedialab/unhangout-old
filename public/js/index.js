$(document).on('ready', function() {

	$("#about").hide();
	$(".nav li").click(function() {
		$(".active").removeClass("active");

		var aEl = $(this).find("a");

		$(this).addClass("active");

		$(".section").hide();
		$(aEl.attr("href")).show();
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
});