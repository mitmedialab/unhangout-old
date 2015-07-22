require([
   "jquery", "underscore", "backbone", "client-models", "auth",
   // plugins
   "backbone.marionette", "bootstrap", "underscore-template-config"
], function($, _, Backbone, models, auth) {

$(document).ready(function() { 

	var users = new models.UserList(USER_DATA);
	var events = new models.EventList(EVENT_DATA);

	var AdminEventRowView = Backbone.Marionette.ItemView.extend({

	});

});

$("[rel=popover]").popover({container: "body", placement: "left"});
$("[title]").not("[rel=popover]").tooltip({container: "body"});

});
