/* global $,Miso,JST */
var numUpcomingEvents = 0;
var numPastEvents = 0; 

$(function(){

  var cakes = new Miso.Dataset({
    importer : Miso.Dataset.Importers.GoogleSpreadsheet,
    parser : Miso.Dataset.Parsers.GoogleSpreadsheet,
    key: "1gudZgGWIwHj6-_l12LoTHRNDUehePdgvfd_srE2Ew9E",
    worksheet: "1"
  });

  var workingColumns = [
    "Event Title",
    "Event Description",
    "Image URL(350X200)",
    "DateAndTime(Aug 28, 2014 11:00am EDT)",
    "Event Link"
  ];

  var $upcomingEvents = $("#upcomingEvents");
  var $pastEvents = $("#pastEvents");
  var $homePageUpcomingEvents = $("#homePageUpcomingEvents");

  cakes.fetch().done(function() {
    
    cakes.each(function(dataset) {

      if(moment(dataset['DateAndTime']) > moment()) {
         numUpcomingEvents++;

         $upcomingEvents.append(JST["templates/dataset.html"]({
           dataset : dataset,
           controls : workingColumns
         }));
      } else {
        numPastEvents++;

        $pastEvents.append(JST["templates/dataset.html"]({
           dataset : dataset,
           controls : workingColumns
         }));
      }
    });

  });
}());
