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

	$("#permalink-create-submit").click(function() {
		// TODO should start doing validation on the title
		// on a per-character basis.
		var permalinkTitle = $("#permalink-title").val();

		window.location = "/h/" +encodeURIComponent(permalinkTitle);
	});
});