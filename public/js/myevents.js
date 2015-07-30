require([
   "jquery", "underscore", "backbone", "validate", "client-models", "auth",
   // plugins
   "backbone.marionette", "bootstrap", "underscore-template-config"
], function($, _, Backbone, validate, models, auth) {

$(document).ready(function() { 

	var users = new models.UserList(USER_DATA);
	var events = new models.EventList(EVENT_DATA);

	var EventRowView = Backbone.Marionette.ItemView.extend({
	    tagName: 'tr',
	    template: '#event-row', 

	    events: {
	        'click .add-remove-admin': 'invokeAddRemoveAdminModal',
    	},

    	modelEvents: {
	        'change': 'render'
	    },	

	    initialize: function() {
	    	var userFilter = [];
	    },

    	invokeAddRemoveAdminModal: function(jqevt) {

    		jqevt.preventDefault();

	        var event = this.model;
	       
	        var modal = new EventAdminAdder({event: event});
	        modal.render();

	        modal.on("add", _.bind(function(email) {
	        	this.addRemoveAdmin(email, "add-event-admin");
	    	}, this)); //add function

	    	modal.on("remove", _.bind(function(email) {
	           	this.addRemoveAdmin(email, "remove-event-admin");
	    	}, this)); //remove function
    	},

    	addRemoveAdmin: function(email, action) {  

    		// check if the email is blank 
    		if(email == "") {
    			var message = "Email cannot be left blank"; 
    			this.showInputErrors(message); 
    		}

    		// check if the email is an invalid address 
    		if(email && !validate.validateEmail(email)) {
    			var message = "Please enter a valid email address";
    			this.showInputErrors(message);
    		}

    		var event = this.model;

           	this.getUserForEmailFilter(email); 	

           	// check if the user for the email address does not 
           	// exists in the user directory 

           	if(userFilter == "") {

           		var message = 'We could not find a user ' + 
    				'with this email address in our directory. Please ' + 
    				'ask them to login to the platform. ' +  
    				'Then come back here ' + 
    				'to add them as an admin.';

           		this.showInputErrors(message);
           	} 

           	var user = users.find(function(user) {
				if(user.get("id") ==  userFilter.get("id") ) {
					return user;
				}
			});

			// check if the user is already an admin 
			if(event.userIsAdmin(user)) {
				var message = 'User with this email address is already an admin';
				this.showInputErrors(message);
			};

			var userId = user.get("id");

           	this.postUserData({
                action: action,
                userId: userId
            }, function() {

            	if(action == "add-event-admin") {
                	event.addAdmin(userFilter);
            	} else if (action == "remove-event-admin") {
            		event.removeAdmin(userFilter);
            	}

                userFilter.trigger("change", userFilter);

            }, function(error) {
                alert("Server error");
                console.error(error);
            });
    	},
    	
    	getUserForEmailFilter: function(email) {

    		userFilter = [];

    		_.filter(users.models, _.bind(function(user) {

           		if(email) {
           			var tokens = email.toLowerCase().split(" ");

           			var search = (user.get("displayName") + " " +
                    _.pluck(user.get("emails"), "value").join(" ")).toLowerCase();

	                for (var i = 0; i < tokens.length; i++) {

	                    if (search.indexOf(tokens[i]) >= -1) {
	                    	userFilter = user;
	                    	return; 
	                    }
	                   
	                }
	             
           		}

           	})

        	); //models
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

    	showInputErrors: function(msg) {
    		$(".email-validate-error").removeClass("hide");
       		$(".email-validate-error").addClass("show");

			$(".email-validate-error").text(msg); 
			
			$(".filter-email").addClass("error");
			$(".filter-email").removeClass("success");

			modal.addClass("show");
			return; 
    	},

    	onRender: function() {
  
	    },
    });

    var EventAdminAdder = Backbone.View.extend({
	    template: _.template($('#event-admin-adder').html()),
	    
	    events: {
	        'click .close, .cancel': 'close',
	        'click .add': 'add',
	        'click .remove': 'remove',
	        'keydown .filter-email': 'removeInputErrors'
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

	    removeInputErrors: function() {
    		$(".filter-email").addClass("success");
    		$(".filter-email").removeClass("error");

    		$(".email-validate-error").addClass("hide");
           	$(".email-validate-error").removeClass("show");
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
