$(document).on('ready', function() {

	$("#about").hide();
	$(".nav li").click(function() {
		var aEl = $(this).find("a");

		$(".section").hide();
		$(aEl.attr("href")).show();
	});
});