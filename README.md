unhangout
=========

A platform for running large scale online un-conference-style events using Google Hangouts for many simultaneous small sessions.


Dependencies
------------

Full library dependencies are shown in `package.json`. The major tools this platform depends on are:

 - express
 - sockjs
 - redis
 - backbone

Settings
--------

The server expects a variety of environment variables to specify server settings. The required variables are in conf.sh.example. I recommend copying that file to conf.sh, and then running `source conf.sh` to put those variables in your environment. 


Google Configuration
--------------------

The GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET fields are app credentials used for signing OAuth requests. They can be setup and configured at [https://code.google.com/apis/console/](https://code.google.com/apis/console/).

If you are creating a new Google API project, make sure to:

 1. Create a "Client ID for web applications"
	a. Set redirect URLs for both your local development environment (i.e. http://localhost:7777/auth/google/callback) and whatever production URL you configure.
	b. Set JavaScript origins for both local development (i.e. http://localhost:7777) and production environments.
 2. Turn on relevant API services. We use Calendar API, Google+ API, and Google+ Hangouts API. 
 3. [Eventually, there will be Google+ Hangout App setup here, too, but we don't need that yet.]
 

Running
----------

The `package.json` file provides a number of scripts to help with running the unhangout server. They are:

 * `npm setup` - loads the current `conf.sh` file into the environment.
 * `npm start` - used for development purposes; output is sent to the console by default
 * `npm test` - runs the test suite. Expects the server not to be running - it will start its own instance for tests.
 * `npm forever-start` - starts the server as a background daemon, in a forever container that will restart it if it crashes
 * `npm forever-list` - list the forever processes currently running
 * `npm forever-stop` - stop the background instance of the server.

 The `forever-*` commands depend on the forever tool. You can install it with `[sudo] npm install forever -g`. The forever commands run in a sudo context because in most production situations you'll want to be running on port 80. It would be nice to shed these priveleges after binding to 80, but we don't support that yet. If you're super concerned about it, you could run the server behind a websocket-friendly proxy like HAProxy.


Notes on Hangout Creation
-------------------------

There is no Google-provided API for creating a hangout link directly. This is obviously problematic for this system, because we need to be able to quickly route 100+ people to 10+ hangouts relatively rapidly and reliably. There are two well understood strategies for solving this problem: using Google Calendar events as a backdoor to getting hangout urls or building a simple Hangout app to phone home with a newly-created hangout url. We use the former strategy as the primary one, and if it doesn't work, we fall back to the latter.

The calendar-api-based strategy depends on an option in Google Calendar to "create hangout links for every event." If you create a google calendar event on an account with that option enabled, any event created on any calendar for that user will be populated with a "hangoutLink" field. The problem with this strategy is that Google has deprecated the ClientLogin API that let you present a username and password and get a valid API token for that user. This makes it difficult to act on behalf of a dummy user that has this bit set; the remaining OAuth flows that Google provides are predicated on user action and browser interaction of some sort or another. We might eventually shift to using a headless browser to emulate this behavior, but it is too difficult a task at the moment.

Until then, we provide a simple way to "farm" these hangout links. With the server running, you can go to `http://host:port/hangout-farming` and the server will redirect you to google to authenticate your account. After authentication, it will use your token to create a calendar event. If your account has the "create hangout links" option set (which it _must_ if this is going to work) then it will log the URL to redis and make it available for any future session on the platform. This means that before running a big event, you should make sure to farm 20 or 30 urls in advance. Events are created and then immediately deleted so as to not clutter up your calendar. As far as we can tell, 

If there are no farmed urls available, the system falls back to a somewhat-more-clunky user experience. The first user to click "join hangout" will be designated as the hangout creator, and redirected to the "create a new hangout" URL. Included in that URL is our Hangout App Id, which will phone home to the server when the hangout is created successfully. Any requests after the first to join the hangout will be held open while waiting for the hangout to be created, and then redirected to that URL when the hangout has started up. Any later requests, after the hangout has started properly, will be redirected to the hangout. The problem with this approach is that if the designated first user fails to create the hangout for some reason (their account doesn't have a google+ profile, is a Google Apps for Domains account that has hangouts disabled, the plugin is not installed, they are currently in another hangout, etc) then we run into major problems. There are workarounds for these issues, but they add significant complexity and won't necessarily be totally reliable. We recommend farming hangouts in the manner described above.