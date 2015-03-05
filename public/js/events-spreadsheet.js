define(["jquery", "underscore", "moment", "underscore-template-config"], function($, _, moment) {
  var now = Date.now();

  var parseSpreadsheet = function(data) {
    var entry,i,cell,col;
    var rows = []
    var mapping = {
      "A": "title",
      "B": "description",
      "C": "image",
      "D": "date",
      "E": "link"
    };
    for (var i = 0; i < data.feed.entry.length; i++) {
      cell = data.feed.entry[i];
      col = cell.title.$t.substring(0, 1);
      if (col === 'A') {
        entry = {};
        rows.push(entry);
      }
      entry[mapping[col]] = cell.content.$t;
      if (mapping[col] === 'date') {
        // parse dates
        entry[mapping[col]] = moment(entry[mapping[col]]);
      } else if (mapping[col] === 'image') {
        // Force image URLs that we know work with SSL to SSL.
        entry.image = entry.image.replace(
          "http://i.imgur.com", "https://i.imgur.com"
        );
      }
    }
    // Drop the first row which has the headings.
    rows = rows.slice(1);
    return rows;
  };

  var displayEvents = function(spreadsheetKey, template) {
    var url = "https://spreadsheets.google.com/feeds/cells/" + spreadsheetKey + "/default/public/basic?alt=json-in-script&callback=?";
    $.getJSON(url, function(data) {
      var rows = parseSpreadsheet(data);
      var hasUpcoming, hasPast;
      
      _.each(rows, function(row) {
        if (row.date && row.date.valueOf() > now) {
          hasUpcoming = true;
          $("#upcomingEvents").prepend(template(row));
        } else {
          hasPast = true;
          var html = template(row);
          $("#pastEvents").prepend(template(row));
        }
      });
      if (hasUpcoming) {
        $(".upcomingEventsTitle").show();
      }
      if (hasPast) {
        $(".pastEventsTitle").show();
      }
    });
  };

  return { displayEvents: displayEvents };
});
