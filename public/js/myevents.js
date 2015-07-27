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

	    events: {
	        'click .add-remove-admin': 'addRemoveAdmin'
    	},

    	modelEvents: {
	        'change': 'render'
	    },	

	    initialize: function() {
	    	var userFilter = [];
	    },

    	addRemoveAdmin: function(jqevt) {

    		jqevt.preventDefault();

	        var event = this.model;
	       
	        var modal = new EventAdminAdder({event: event});
	        modal.render();

	        modal.on("add", _.bind(function(email) {
	           	this.getUserForEmailFilter(email); 	

	           	var user = users.find(function(user) {
					if(user.get("id") ==  userFilter.get("id") ) {
						return user;
					}
				});

				var userId = user.get("id");

	           	this.postUserData({
	                action: "add-event-admin",
	                userId: userId
	            }, function() {
	                event.addAdmin(userFilter);
	                userFilter.trigger("change", userFilter);
	            }, function(error) {
	                alert("Server error");
	                console.error(error);
	            });

	    	}, this)); //add function

	    	modal.on("remove", _.bind(function(email) {
	           	this.getUserForEmailFilter(email); 	

	           	var user = users.find(function(user) {
					if(user.get("id") ==  userFilter.get("id") ) {
						return user
					} 
				});

				var userId = user.get("id");

	           	this.postUserData({
	                action: "remove-event-admin",
	                userId: userId, 
	            }, function() {
	                event.removeAdmin(userFilter);
	                userFilter.trigger("change", userFilter);
	            }, function(error) {
	                alert("Server error");
	                console.error(error);
	            });

	    	}, this)); //remove function
    	},

    	postUserData: function(data, success, error) {
    		var post = _.extend({eventId: this.model.id}, data);
	        
	        $.ajax({
	            type: 'POST',
	            url: '/myevents/',
	            data: post,
	            success: success,
	            error: error
	        });
    	},

    	getUserForEmailFilter: function(email) {

    		_.filter(users.models, _.bind(function(user) {
	           		
           		if(email) {
           			var tokens = email.toLowerCase().split(" ");

           			var search = (user.get("displayName") + " " +
                    _.pluck(user.get("emails"), "value").join(" ")).toLowerCase();

	                for (var i = 0; i < tokens.length; i++) {
	                    if (search.indexOf(tokens[i]) == -1) {
	                        return false;
	                    }
	                }
           		}

           		userFilter = user;
           		return true;
           	})

        	); //models
    	},

    	onRender: function() {

  
	    },
    });

    var EventAdminAdder = Backbone.View.extend({
	    template: _.template($('#event-admin-adder').html()),
	    
	    events: {
	        'click .close, .cancel': 'close',
	        'click .add': 'add',
	        'click .remove': 'remove'
	    },

	    ui: {
	        'filterEmail': 'input.filter-email',
	    },

	    initialize: function(options) {
	        _.bindAll(this, "add", "close", "render", "remove");
	        this.event = options.event; 
	    },

	    render: function() {
	        this.$el.addClass("modal fade");
	        this.$el.html(this.template({
	            event: this.event,
	        }));

	        this.$el.modal("show");
	       
	    },

	    add: function() {
	    	var email = this.$el.find(".filter-email").val();

	        this.trigger("add", email);
	        this.close();
	    },

	    remove: function() {
	    	var email = this.$el.find(".filter-email").val();

	        this.trigger("remove", email);
	        this.close();
	    },

	    close: function() {
	        this.$el.on("hidden", this.remove);
	        this.$el.modal("hide");
	    }
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
