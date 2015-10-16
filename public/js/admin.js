require(["jquery", "bootstrap", "auth"], function($) {
    $("[rel=popover]").popover({container: "body", placement: "left"});
    $("[title]").not("[rel=popover]").tooltip({container: "body"});
    $(".delete-event").click(function(event) {
      var id = $(this).attr("data-event");
      var deleteEvent = confirm("Are you sure you want to delete event " + id + " and all associated sessions? This cannot be undone.");
      return deleteEvent;
    });
});
