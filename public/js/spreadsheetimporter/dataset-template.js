this["JST"] = this["JST"] || {};

this["JST"]["templates/dataset.html"] = function (obj) {
    obj || (obj = {});
    var __t, __p = '',
        __e = _.escape,
        __j = Array.prototype.join;

    function print() {
        __p += __j.call(arguments, '')
    }

    with(obj) {
        if(numUpcomingEvents == 1) {
             __p += '<h3>Upcoming Events</h3>\n\n    ';
        } 

        if(numPastEvents == 1) {
            __p += '<h3>Past Events</h3>\n\n    ';
        }
        
        __p += '<div class="event-box col-md-3">\n\n    ';

        if (dataset['Event Link']) { 
            __p += '\n      <a href="' + 
            ((__t = ( dataset['Event Link'] )) == null ? '' : __t) + '" target="_blank">'
        };

        if (dataset['Image URL(350X200)']) {;

            var imageURL = dataset['Image URL(350X200)'];

             __p += '\n      <img src="' + 
            ((__t = ( imageURL.replace("class",""))) == null ? '' : __t) + 
            'class="img-responsive" style="width:350px; height: 200px;"> <hr class="line-break">'

            
        };

        if (dataset['Event Title']) {;        
            __p += '\n     <h4>' +
                ((__t = (dataset['Event Title'])) == null ? '' : __t) +
                '</h4>\n    ';
        };

        if (dataset['DateAndTime']) {;
            __p += '\n      <p>' + 
            ((__t = ( dataset['DateAndTime'] )) == null ? '' : __t) + 
            '</p></a></div>\n    ';
        }

    }

    return __p
};
