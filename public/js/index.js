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
});
