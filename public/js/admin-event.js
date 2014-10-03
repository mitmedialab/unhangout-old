require([
    "jquery", "underscore", "moment-timezone", "jstz", "models", "auth",
    "bootstrap", "bootstrap-datetimepicker", "moment-timezone-data"
], function($, _, moment, jstz, models) {

var event = new models.Event(EVENT_DATA); // EVENT_DATA from template.

$(document).ready(function(){
    if (!event.id) {
        var oneWeekAfter = moment()
            .add('days', 7)
            .second(0)
            .minute(0)
            .format(event.DATE_DISPLAY_FORMAT);
        $("#dateAndTime").val(oneWeekAfter);
    }
    // Using http://www.malot.fr/bootstrap-datetimepicker/
    $(".form_datetime").datetimepicker({
        // NOTE: the parser fails if there isn't whitespace or punctuation
        // between each component.  You can't do "H:iip", it has to be
        // "H:ii p".  Also note: this should be identical to
        // event.DATE_DISPLAY_FORMAT, which uses moment.js syntax instead.
        format: "DD M d, yyyy H:ii p",
        showMeridian: true,
        forceParse: true,
        pickerPosition: 'bottom-left',
        viewSelect: 'decade',
        todayBtn: true
    });

    // Append timezones to option box.
    var zones = _.map(moment.tz.zones(), function(z) { return z.displayName; });
    zones.sort(function(a, b) {
        var aIsAmerica = /^America/.test(a);
        var bIsAmerica = /^America/.test(b);
        if (aIsAmerica != bIsAmerica) {
            return aIsAmerica ? -1 : 1;
        } else {
            return a < b ? -1 : a > b ? 1 : 0;
        }
    });
    zones.unshift("Etc/UTC");
    var frag = document.createDocumentFragment();
    _.each(zones, function(zone) {
        var option = document.createElement("option");
        option.value = zone;
        option.textContent = zone.replace(/_/g, " ");
        if (event.get("timeZoneValue")) {
            if (zone === event.get("timeZoneValue")) {
                option.selected = true;
            }
        }
        frag.appendChild(option);
    });
    $("#timeZoneValue").append(frag);

    if($("#timeZoneValue").val() === "") {
        // Automatic TimeZone Detection of the browser client
        $("#timeZoneValue").val(jstz.determine().name());
    }
});

});
