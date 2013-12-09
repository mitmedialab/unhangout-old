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

    this.setPosition = function(value, opt_top) {
        var left = opt_top ? value : value.left;
        var top = opt_top ? opt_top : value.top;
        // Leave room for the outline, to aid in debugging scaling.
        div.style.left = (left + 3) + "px";
        div.style.top = (top + 3) + "px";
    };
    this.setVisible = function(visible) {
        div.style.display = visible ? 'block' : 'none';
        if (!appended) {
            document.body.appendChild(div);
            appended = true;
        }
    };
    // Leave room for the outline, to aid in debugging scaling.
    this.setHeight = function(height) { div.style.height = (height-6) + "px"; };
    this.setWidth  = function(width)  { div.style.width  = (width-6)  + "px"; };
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
