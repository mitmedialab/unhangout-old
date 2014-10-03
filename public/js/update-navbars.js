// Update navbar links' "active" status
define(['jquery'], function($) {
    $(document).ready(function() {
        $(".nav li").each(function(i, el) {
            if ($(el).find("a").attr("href") == window.location.pathname) {
                $(el).addClass("active");
            } else {
                $(el).removeClass("active");
            }
        });
    });
});
