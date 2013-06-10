$(document).ready(function() {
	if($("#app").length!=1) {
		console.log("Code running on a page that does not have an #app div.");
		return;
	}
	
	console.log("Starting app!");
});