require(["jquery", "auth"], function($) {
    $(document).ready(function() {
        $("#permalink-create-submit").click(function(e) {
            e.stopPropagation();
            var invalidChars = /[^-a-zA-Z0-9_]/g;
            var permalinkTitle = $("#permalink-title").val();
            if (invalidChars.test(permalinkTitle)) {
                $("#permalink-title").addClass("error");
                $(".help-block").show();
                $(".suggestion")
                    .html(permalinkTitle.toLowerCase().replace(invalidChars, "-"))
                    .on("click", function() {
                        $("#permalink-title").val($(this).html());
                        $("#permalink-create-submit").click();
                        return false;
                    });
                return false;
            }
            var url = "/h/" + encodeURIComponent(permalinkTitle);
            window.location = url;
            return false;
        });

        $("submit").click(function() {
            $("form").submit();
            return false;
        });
    });
});
