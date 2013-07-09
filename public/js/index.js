$(document).on('ready', function() {

	$("#about").hide();
	$(".nav li").click(function() {
		var aEl = $(this).find("a");

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
			console.log("posted email");
		});

		$("#email").val("");
	});
});