require([
   "jquery", "underscore", "backbone", "validate", "client-models", "auth",
   // plugins
   "backbone.marionette", "bootstrap", "underscore-template-config"
], function($, _, Backbone, validate, models, auth) {

$(document).ready(function() { 

	var users = new models.UserList(USER_DATA);
	var events = new models.EventList(EVENT_DATA);

	var adminsToBeRemoved = [];
	
	var modalAdminAdder;
	var modalAdminRemover;
	var modalConfirmAdminRemoval;

	var EventRowView = Backbone.Marionette.ItemView.extend({
	    tagName: 'tr',
	    template: '#event-row', 

	    events: {
	        'click .btn-add-admin': 'invokeAddAdminModal',
	        'click .btn-remove-admin': 'invokeRemoveAdminModal'
    	},

    	modelEvents: {
	        'change': 'render'
	    },	

	    ui: {
	    	eventAdmins: '.event-admins',
	    	eventDate: '.event-date',
	    },

	    initialize: function() {
	    	var userFilter = [];
	    },

    	invokeAddAdminModal: function(jqevt) {
    		jqevt.preventDefault();

	        var event = this.model;
	       
	        modalAdminAdder = new EventAdminAdder({event: event});
	        modalAdminAdder.render();
    	},

    	invokeRemoveAdminModal: function(jqevt) {
	    	jqevt.preventDefault();

	        var event = this.model;
	       
	        modalAdminRemover = new EventAdminRemover({event: event});
	        modalAdminRemover.render();
	    },

    	onRender: function() {
  			var event = this.model; 

  			//Building the date and time 
  			var dateFragment = document.createDocumentFragment();

  			var date = event.get("dateAndTime");

  			if(date) {
  				dateP = document.createElement("p");
  				dateP.innerHTML = moment(date).format("D MMM YYYY"); ; 
  				dateFragment.appendChild(dateP);
  			}

  			//Now add the event date fragment to the layout and display it
        	this.ui.eventDate.html(dateFragment);

  			//Build the list of event admins 
  			var adminFragment = document.createDocumentFragment();

  			var drawAdmin = _.bind(function (admin) {
	            imgEl = document.createElement("img");
	            var user = event.findAdminAsUser(admin, users); 
	            imgEl.src = user.get("picture"); 
	            adminFragment.appendChild(imgEl);

	        }, this);  //drawAdmin 

        	_.each(this.model.get("admins"), function(admin) { 
        		drawAdmin(admin); 
        	});

        	//Now add the event admins fragment to the layout 
        	//and display it
        	this.ui.eventAdmins.html(adminFragment);

	    },
    });

    var EventAdminAdder = Backbone.View.extend({
	    template: _.template($('#event-admin-adder').html()),
	    
	    events: {
	        'click .close, .cancel': 'close',
	        'click .add': 'add',
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
	    	addAdminToEvent(email, this.event);

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
	
	var EventAdminRemover = Backbone.View.extend({
	    template: _.template($('#event-admin-remover').html()),
	    
	    events: {
	        'click .close, .cancel': 'close',
	        'click .remove': 'remove',
	        'keydown .filter-email': 'removeInputErrors'
	    },

	    initialize: function(options) {
	        _.bindAll(this, "close", "render", "remove");
	        this.event = options.event; 
	    },

	    remove: function() {
	    	this.$el.show();

	    	modalConfirmAdminRemoval = new EventConfirmAdminRemoval({event: this.event});
	        modalConfirmAdminRemoval.render();

	        modalConfirmAdminRemoval.css('z-index', 1040);	        
	    },

	    close: function() {
	        this.$el.on("hidden", this.remove);
	        this.$el.modal("hide");
	    },

	    render: function() {
	        this.$el.addClass("modal fade");

	        //Initially show the remove class and modal body
	        this.$el.find(".modal-body").html("");
	        this.$el.find(".remove").removeClass("hide");
        	this.$el.find(".remove").addClass("show");

	        this.$el.html(this.template({
	            event: this.event,
	        }));
		
	        this.$el.modal("show");

	        adminsToBeRemoved = [];

	        //remove the admin row select classes
	        $(this).removeClass("admin-row-selected");	
	        $(this).removeClass("admin-row-unselected");

	        //Build the list of event admins to be shown for removal
  			var adminFragment = document.createDocumentFragment();

  			var drawAdminRow = _.bind(function (admin) {
  				divEl = document.createElement("div");
	            imgEl = document.createElement("img");
	          
	            var user = this.event.findAdminAsUser(admin, users); 

	            pElName = document.createTextNode(user.get("displayName"));
	            pElEmail = document.createElement("span");
	            pElEmail.innerHTML = "&nbsp; <a href='mailto:" + user.get("emails")[0].value + "'>" + user.get("emails")[0].value +  "</a>";
	            
	            imgEl.src = user.get("picture"); 
	            divEl.id = user.get("id");

	            divEl.appendChild(imgEl);
	            divEl.appendChild(pElName)
	            divEl.appendChild(pElEmail);

	            divEl.onclick = selectAdminRow; 
	            adminFragment.appendChild(divEl);

	            function selectAdminRow() {
	            	if(this.className == undefined || this.className == "") {
	            		$(this).addClass("admin-row-selected");	
	            		$(this).removeClass("admin-row-unselected");

	            		listOfAdminsForRemoval(this.id, "add");

	            	} else if(this.className == "admin-row-selected") {
	            		$(this).addClass("admin-row-unselected");
	            		$(this).removeClass("admin-row-selected");

	            		listOfAdminsForRemoval(this.id, "remove");

	            	} else if (this.className == "admin-row-unselected") {
	            		$(this).addClass("admin-row-selected");
	            		$(this).removeClass("admin-row-unselected");

	            		listOfAdminsForRemoval(this.id, "add");
	            	}
	            }

	            function listOfAdminsForRemoval(id, action) {
	            	if(action == "add") {
	            		adminsToBeRemoved.push(id);
	            	} else if (action == "remove") {
	            		if(adminsToBeRemoved && adminsToBeRemoved.indexOf(id) > -1) {

	            			for(var c = 0; c< adminsToBeRemoved.length; c++) {
	            				if(adminsToBeRemoved[c] == id) {
	            					adminsToBeRemoved.splice(c, 1); 
	            					break;
	            				}
	            			}

	            		}
	            	}

	            }

	        }, this);  //drawAdmin 

        	_.each(this.event.get("admins"), function(admin) { 
        		drawAdminRow(admin); 
        	});

        	this.$el.find(".event-admins").html(adminFragment);

        	if(this.event.get("admins").length == 0) {
        		this.$el.find(".modal-body").html("<b>Currently, there are no admins for this event</b>");
        		this.$el.find(".remove").addClass("hide");
        		this.$el.find(".remove").removeClass("show");
        	}
	    },
	});

	var EventConfirmAdminRemoval = Backbone.View.extend({
		template: _.template($('#event-confirm-admin-removal').html()),

		initialize: function(options) {
			this.event = options.event; 
		},

		events: {
	        'click .btn-close': 'close',
	        'click .btn-confirm': 'confirmAdminRemoval'
	    },

		render: function() {
	        this.$el.addClass("modal fade");
	        
	        this.$el.html(this.template({
	            event: this.event,
	        }));
	       
	        this.$el.find(".confirm-del-msg").text("Are you sure you would like to remove " + adminsToBeRemoved.length + " admin(s)?");
	        this.$el.modal("show");
	    },

	    confirmAdminRemoval: function() {
	    	removeAdminFromEvent(this.event);
	    	modalAdminRemover.close();
	    },

	    close: function() {
	    	modalAdminRemover.close();
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

	function addAdminToEvent(email, event) {
		// check if the email is blank 
		if(email == "") {
			var message = "Email cannot be left blank"; 
			showInputErrors(message); 
		}

		// check if the email is an invalid address 
		if(email && !validate.validateEmail(email)) {
			var message = "Please enter a valid email address";
			showInputErrors(message);
		}

       	getUserForEmailFilter(email); 	

       	// check if the user for the email address does not 
       	// exists in the user directory 
       	if(userFilter == "") {

       		var message = 'We could not find a user ' + 
				'with this email address in our directory. Please ' + 
				'ask them to login to the platform. ' +  
				'Then come back here ' + 
				'to add them as an admin.';

       		showInputErrors(message);
       	} 

       	var user = users.find(function(user) {
			if(user.get("id") ==  userFilter.get("id") ) {
				return user;
			}
		});

		// check if the user is already an admin 
		if(event.userIsAdmin(user)) {
			var message = 'User with this email address is already an admin';
			showInputErrors(message);
		}

		var admins = [];
		admins.push(user.get("id"));

       	postUserData({
            action: "add-event-admin",
            eventId: event.get("id"),
            admins: admins,
        }, function() {
        	event.addAdmin(userFilter);
            userFilter.trigger("change", userFilter);
        }, function(error) {
            alert("Server error");
            console.error(error);
        });
	}

	function removeAdminFromEvent(event) {

       	postUserData({
            action: "remove-event-admin",
            admins: adminsToBeRemoved,
            eventId: event.get("id"),
        }, function() {

        	for(var i = 0; i < adminsToBeRemoved.length; i++) {
        		var user = users.find(function(user) {
					if(user.get("id") ==  adminsToBeRemoved[i] ) {
						return user;
					}
				});

				event.removeAdmin(user);
				user.trigger("change", user);

        	}

        }, function(error) {
            alert("Server error");
            console.error(error);
        });

	}

	function postUserData(data, success, error) {

		var post = _.extend({eventId: data.eventId}, data);
        
        $.ajax({
            type: 'POST',
            url: '/myevents/',
            data: post,
            success: success,
            error: error
        });
	}

	function getUserForEmailFilter(email) {

		userFilter = [];

		_.filter(users.models, _.bind(function(user) {

       		if(email) {
       			var tokens = email.toLowerCase().split(" ");

       			var search = (user.get("displayName") + " " +
                _.pluck(user.get("emails"), "value").join(" ")).toLowerCase();

                for (var i = 0; i < tokens.length; i++) {

                    if (search.indexOf(tokens[i]) >= 0) { //matched
                    	userFilter = user;
                    	return false;
                    }
                   
                }
             
       		}

     		})

     	);
    }

	function showInputErrors(msg) {
		$(".email-validate-error").removeClass("hide");
   		$(".email-validate-error").addClass("show");

		$(".email-validate-error").text(msg); 
		
		$(".filter-email").addClass("error");
		$(".filter-email").removeClass("success");

		modalAdminAdder.addClass("show");
		return; 
    }

}); //document ready 

$("[rel=popover]").popover({container: "body", placement: "left"});
$("[title]").not("[rel=popover]").tooltip({container: "body"});

});
