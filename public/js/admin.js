require(["jquery", "bootstrap"], function($) {
    $("[rel=popover]").popover({container: "body", placement: "left"});
    $("[title]").not("[rel=popover]").tooltip({container: "body"});
});
