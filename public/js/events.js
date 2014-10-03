require(
  ['jquery', 'underscore', 'events-spreadsheet', 'update-navbars'],
  function($, _, eventsSpreadsheet) {
    var key = $("[data-spreadsheet-key]").attr("data-spreadsheet-key"); 
    var template = _.template($("#event-listing").html());
    eventsSpreadsheet.displayEvents(key, template);
  }
);
