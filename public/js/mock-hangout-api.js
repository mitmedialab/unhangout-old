// Make global -- no 'var'.

var FauxCanvas = function() {
    var div = document.createElement('div');
    div.style.position = 'absolute';
    div.style.width = '320px';
    div.style.height = '240px';
    div.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
    div.style.outlineColor = "blue";
    div.style.outlineWidth = "3px";
    div.style.outlineStyle = "ridge";
    div.style.zIndex = '100000';
    div.style.display = 'none';
    var appended = false;
    var aspectRatio = 1.5

    this.setPosition = function(value, opt_top) {
        var left = typeof opt_top != "undefined" ? value : value.left;
        var top = typeof opt_top != "undefined" ? opt_top : value.top;
        // Leave room for the outline, to aid in debugging scaling.
        div.style.left = parseInt(left + 3) + "px";
        div.style.top = parseInt(top + 3) + "px";
        console.log(left, top, div.style.left, div.style.top);
    };
    this.getAspectRatio = function() {
        return aspectRatio;
    };
    this.setVisible = function(visible) {
        div.style.display = visible ? 'block' : 'none';
        if (!appended) {
            document.body.appendChild(div);
            appended = true;
        }
    };
    this.setHeight = function(height) {
        // Sets both height and width based on current aspect ratio.
        // Leave room for the outline, to aid in debugging scaling.
        div.style.height = (height-6) + "px";
        div.style.width = (aspectRatio*height - 6) + "px";
    };
    this.setWidth  = function(width)  {
        // Sets both height and width based on current aspect ratio.
        // Leave room for the outline, to aid in debugging scaling.
        div.style.width  = (width-6)  + "px";
        div.style.height = (width/aspectRatio - 6) + "px";
    };
}
var fauxCanvas = new FauxCanvas();

gadgets = {
    util: {
        registerOnLoadHandler: function(cb) {
            cb();
        }
    },
    views: {
        getParams: function() {
            return {"appData": MOCK_DATA.appData};
        }
    }
};
// Make global -- no 'var'.
gapi = {
    hangout: {
        onApiReady: {
            add: function(cb) {
                cb({isApiReady: true});
            }
        },
        getHangoutUrl: function() {
            return MOCK_DATA.hangoutUrl;
        },
        getParticipants: function() {
            return MOCK_DATA.users;
        },
        hideApp: function() {
            alert("Hangout got 'hideApp' call");
        },
        data: {
            setValue: function(){},
            getValue: function(key) {
                if (key == "sessionId") {
                    return MOCK_DATA.appData.split(":")[1];
                }
            }
        },
        layout: {
            getVideoCanvas: function() {
                return fauxCanvas;
            }
        }
    }
};
