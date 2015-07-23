require([
   "jquery", "underscore", "backbone", "client-models", "auth",
   // plugins
   "backbone.marionette", "bootstrap", "underscore-template-config"
], function($, _, Backbone, models, auth) {

$(document).ready(function() { 

	var users = new models.UserList(USER_DATA);
	var events = new models.EventList(EVENT_DATA);

	var EventRowView = Backbone.Marionette.ItemView.extend({
	    tagName: 'tr',
	    template: '#event-row', 
    });

	var EventTableView = Backbone.Marionette.CompositeView.extend({

	    template: '#event-table',
	    itemView: EventRowView,
	    itemViewContainer: 'tbody',

	    initialize: function(options) {
	    	this.collection = events; 
	    },

	    serializeData: function() {
	    	var context = Backbone.Marionette.CompositeView.prototype.serializeData.apply(this);
	        
	        context.adminEvents = [];

	        events.each(function(event) {
	 			context.adminEvents.push(event.toJSON());
	        });

	        return context;
	    },

	});

	/* -------------------   App initialization ---------------- */

	var app = new Backbone.Marionette.Application();

	app.addRegions({
	    main: "#main"
	});

	app.addInitializer(function(options) {
	    var eventTable = new EventTableView({model: events});
	    this.main.show(eventTable);
	});

	app.start();

}); //document ready 

$("[rel=popover]").popover({container: "body", placement: "left"});
$("[title]").not("[rel=popover]").tooltip({container: "body"});

});
