require([
  'jquery', 'underscore', 'transport', 'auth', 'client-models', 'logger', 'bootstrap', 
  'backbone.marionette'
], function($, _, transport, auth, models, logging) {

var views = {};
var logger = new logging.Logger("contact-info");

//Contact form view for filling preferred method of contact 
views.ContactFormView = Backbone.Marionette.ItemView.extend({
	
	events: {
		'click .submit-contact-form' : 'submitContactForm'
	},

	//Function to submit the contact information
	submitContactForm: function() {
		var contactPreferredType = $(".contact-type").val();
		var contactPreferredAddress = $(".contact-address").val();
	}
});

return views;

});