var SessionView = Marionette.ItemView.extend({
	template: '#session-template',
	
	ui: {
		attend: '.btn'
	},
	
	events: {
		'click .btn':'attend'
	},
	
	initialize: function() {
		this.listenTo(this.model, 'change', this.render, this);
	},
	
	onRender: function() {
		console.log("rendered session view");
	},
	
	destroy: function() {
		this.model.destroy();
	},
	
	attend: function() {
		console.log("attend pressed on " + this.model.id);
	}
});

var SessionListView = Backbone.Marionette.CompositeView.extend({
	template: "#session-list-template",
	itemView: SessionView,
	itemViewContainer: '#session-list',
	
	initialize: function() {
		this.listenTo(this.collection, 'all', this.update, this);
	},
	
	onRender: function() {
		this.update();
	},
	
	update: function() {
		// ?? don't think we need this.
		console.log("update");
	},
})

var UserView = Marionette.ItemView.extend({
	template: '#user-template',
	className: 'user',
	
	initialize: function() {
		this.listenTo(this.model, 'change', this.render, this);
	},	
});

var UserListView = Backbone.Marionette.CompositeView.extend({
	template: '#user-list-template',
	itemView: UserView,
	itemViewContainer: "#user-list",
	
	initialize: function() {
		this.listenTo(this.collection, 'all', this.update, this);
	}
})