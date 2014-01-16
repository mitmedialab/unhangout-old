DEVELOPMENT
===========

This file contains some collected notes from development to help guide future developers in adding features or understanding why existing features work the way they do. 

Code Organization
-----------------

	``/bin`` - contains all files intended to be executed directly, using, e.g. `node seed.js`
		``get-all-user-emails.js`` -  helper script for extracting all emails users have logged in with
		``seed.js``  _wipes_ and populates the redis database with basic models
		``unhangout-server`` primary executable for starting the server
	``/lib`` - various server-side libraries
        __Server lifecycle__
        ``unhangout-server.js`` - starting, stopping Unhangout
        ``logging.js`` - logging and analytics
        ``redirect-https.js`` - simple http => https redirect server

        __MVC__
        ``unhangout-db.js`` - Hoisting and access to in-memory database, persistence to redis.
        ``server-models.js`` - Models (extending those in /public/js/models.js).
        ``unhangout-routes.js`` - Core express routes and handlers for HTTP requests
        ``permalink-routes.js`` - Express routes and handlers for the permalink service
        ``unhangout-sockets.js`` - Core routes for websocket messages

        __Libraries__
        ``room-manager.js`` - Manager of ``rooms``, with joining, leaving, and authentication, on top of SockJS.
        ``redis-sync.js`` - Interface between Backbone.js and Redis
        ``video-sync.js`` - Time-sync code for simultaneous video watching
		``hangout-farming.js`` - support code for farming valid unhangout urls from google calendar api
		``passport-mock.js`` - support for faking passport users during testing
        ``utils.js`` - Common utilities that don't easily fit elsewhere.

	``/logs``
	``/public`` - all static content, served by *express* at `/public/*`
	``/test`` - mocha and selenium unit and integration tests
	``/views`` - templates for rendering HTML pages
	``package.json`` - dependencies + other metadata
	``conf.json.example`` - example config file; should be copied into conf.json and edited appropriately.


Overall Architecture
--------------------

Unhangout is more or less a traditional model-view style architecture. The models are represented in `model.js` as *Backbone.js* model objects. They're quite thin - they're basically just a slight layer on top of a basic javascript-style object with some better hooks for inheritance (via `.extend()`) and abstracting getters and setters (through `.get(key)` and `.set(key, value)`). These models are used both on the client and on the server, with some variations on the server (as extended `server-models.js`). 

The unhangout-server plays a few distinct roles. First, it is an *express.js* HTTP server. In this mode, it handles requests for the front page, event pages, notification subscription, and login. It also provides HTTP endpoints for the hangout app to phone home. 

It also provides *SockJS* connectivity. This is a socket-like interface for client and server that supports a reliable and fast channel for communication. This channel is used for basically all communication on _event_ pages, i.e. `/event/:id`. Every client who has currently loaded an event page has an open connection on the server.

On the client side, we have a semi-traditional *Backbone.js* application (with *Marionette.js* extensions) with models and views. The major deviation from standard *Backbone.js* practice is the way we synchronize with the server. Reliable and effective generic model synchronization over a socket is a somewhat challenging prospect for many reasons, and given the prototype nature of this project we have basically elided the problem entirely. Instead, we embed a state snapshop in the page as a JSON object to bootstrap the models. Subsequent changes to those models are encoded as discrete "verbs" in the protocol (discussed in more length below) and each client is responsible for updating their models appropriately. This makes adding features to the models and protocol quite tedious, but it keeps our connection from being too chatty and makes it all quite readable. This approach is clearly not appropriate for a long term, large scale project, but works well enough here for now.


Persistence
-----------

The persistence model in unhangout is quite straightforward. We override Backbone's built in `.sync()` method to provide for saving, only. When saving, objects write themselves to a redis key (as determined by a call to `.url()`) as JSON strings. These records are _only read on startup_. Essentially, we treat redis as a journal and operate in memory for all interactions with the model. 

This model has a number of obvious deficiencies. The most problematic is that it makes moving from one server process to more than one a very difficult proposition. We have made our peace with that for now, but that sort of shift will be relatively challenging if/when the time comes. The other (potential) issue is that the server needs to load the entire data model from redis on startup. At this point, this is not an issue at all: redis is blazing fast on reads and we're not talking about that many records. Inflating the JSON record into a full model object is also not computationally challenging. Right now, loading from the database doesn't appear to be any delay at all.

As a developer, this means that you mostly just interact with the data model in memory like you would any other object. You can get and set fields, call methods, whatever. You do, however, need to remember to call `model.save()` whenever you make a change that you want to persist. This is a very fast operation, but not quite as fast as in-memory.


Protocol
--------

The *SockJS* based protocol is quite straightforward. Messages are encoded as JSON strings, and have one guaranteed field: `type`. Most messages also have an `args` field that contains the details of the message. All message types also have `*-err` and `*-ack` variants that the server uses to report errors or success in handling a particular messages.

The contents of message payloads are not particularly formal. I don't yet have a full protocol description anywhere since it changes frequently. In general, reading the part of `unhangout-server.js` where messages are handled is the best source of documentation for what the potential fields are in `args`. In general, the message type is used to specify the verb, and `args` contains an id of the object being acted on (all messages right now only act on one kind of object, e.g. a session or a user) and some extra metadata if necessary.


Hangout Plugins
---------------

The Google API for creating hangout plugins is relatively straightforward. The full API docs are available here: https://developers.google.com/+/hangouts/ and cover all the methods that are available within an application.

There are a few minor gotchas, though, when it comes to setting up a development environment for hangouts. You can programmatically force a client to load *one* hangout app when they load their hangout instance. This is done through a GET parameter appended to the url: `gid=HANGOUT_APP_ID`. The app id is set in `conf.json`, and should be a 12 digit integer. You're welcome to use our official hangout app id in your installation as well; our app id is `337607402011`. It should work with any installation equally well, since clients provide it the unhangout server host they connected from on load. 

If you want to make changes to the app, it gets a little bit tricky. First, you need to register a new hangout app witih Google: https://code.google.com/apis/console/ A hangout app is primarily an .xml file that specifies the markup and javascript that comprises the app. When the hangout interface loads, it makes separate HTTP requests for each of the `hangout.xml` files it needs for each app. Thus the server hosting those files needs to be accesible _to every hangout participant_. You set the fully qualified path for this file (and the associated privacy/support/terms documents) in the Google Developer API console. Although `localhost` will work here in some situations, I ran into some weird issues with apps that didn't have the "make public" flag set (at the bottom of the hangout app setup page), which in turn requires all the pieces of the app to be publically accessible (i.e., not on `localhost`.) So my recommendation is to get your instance of the unhangout server running on a publically accessible server, and then editing the deployed version's hangout.xml file. You can still use the unhangout-server running on `localhost`; you don't need to constantly deploy the actual server for this to work. The hangout app will happily phone home to a `localhost` address. But the easiest way to work with `hangout.xml` is to edit a pubically-visible version. 

The other option, which I haven't tested, is to maintain two separate hangout app ids; one for production (which points to your production unhangout server) and one for development (which points to `localhost`). This should work too, but I haven't tested it.


Templating
----------

There are two layers of templating in use in this app. There are templates that are processed by *Express* when a page is rendered out of the `/views` directory. There are also *Backbone*-style templates that are executed on the client side. These two varieties of template would like to use the same escape characters. Obviously, this would cause a major clash when the *Express* template tried to operate on *Backbone*'s in-view template `<script>` blocks. As a result, we operate the server-side templating with the prefix `<% ... %>` and the client-side templating uses `{{ ... }}`. 


Hangout Creation
----------------

There is no Google-provided API for creating a hangout link directly. This is obviously problematic for this system, because we need to be able to quickly route 100+ people to 10+ hangouts relatively rapidly and reliably. There are two well understood strategies for solving this problem: using Google Calendar events as a backdoor to getting hangout urls or building a simple Hangout app to phone home with a newly-created hangout url. We use the former strategy as the primary one, and if it doesn't work, we fall back to the latter.

The calendar-api-based strategy depends on an option in Google Calendar to "create hangout links for every event." If you create a google calendar event on an account with that option enabled, any event created on any calendar for that user will be populated with a "hangoutLink" field. The problem with this strategy is that Google has deprecated the ClientLogin API that let you present a username and password and get a valid API token for that user. This makes it difficult to act on behalf of a dummy user that has this bit set; the remaining OAuth flows that Google provides are predicated on user action and browser interaction of some sort or another. We might eventually shift to using a headless browser to emulate this behavior, but it is too difficult a task at the moment.

Until then, we provide a simple way to "farm" these hangout links. With the server running, you can go to `http://host:port/hangout-farming` and the server will redirect you to google to authenticate your account. After authentication, it will use your token to create a calendar event. If your account has the "create hangout links" option set (which it _must_ if this is going to work) then it will log the URL to redis and make it available for any future session on the platform. This means that before running a big event, you should make sure to farm 20 or 30 urls in advance. 

If there are no farmed urls available, the system falls back to a somewhat-more-clunky user experience. The first user to click "join hangout" will be designated as the hangout creator, and redirected to the "create a new hangout" URL. Included in that URL is our Hangout App Id, which will phone home to the server when the hangout is created successfully. Any requests after the first to join the hangout will be held open while waiting for the hangout to be created, and then redirected to that URL when the hangout has started up. Any later requests, after the hangout has started properly, will be redirected to the hangout. The problem with this approach is that if the designated first user fails to create the hangout for some reason (their account doesn't have a google+ profile, is a Google Apps for Domains account that has hangouts disabled, the plugin is not installed, they are currently in another hangout, etc) then we run into major problems. There are workarounds for these issues, but they add significant complexity and won't necessarily be totally reliable. We recommend farming hangouts in the manner described above.

Testing
-------

Tests are written with mocha; and integration tests with selenium.  Wherever possible, core functionality should be backed up with tests.  See INSTALLATION.md for instructions on running tests (with or without selenium, and with or without a headless X-server).

Common functions for starting up the server and building the selenium webdriver are found in ``test/common.js``.  Selenium webdriver uses a "promise" syntax to handle asynchronous code (see http://code.google.com/p/selenium/wiki/WebDriverJs for full documentation).
