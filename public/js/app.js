var sock;

$(document).ready(function() {
	if($("#app").length!=1) {
		console.log("Code running on a page that does not have an #app div.");
		return;
	}

	console.log("Starting app!");

	sock = new SockJS(document.location.protocol + "//" + document.location.hostname + ":" + document.location.port + "/sock");
	sock.onopen = function() {
		console.log('open');
		
		var AUTH = {type:"auth", args:{key:SOCK_KEY, id:USER_ID}};
		
		sock.send(JSON.stringify(AUTH));
	};
	sock.onmessage = function(e) {
		console.log('message', e.data);
	};
	sock.onclose = function() {
		console.log('close');
	};
});