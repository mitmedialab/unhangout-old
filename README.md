unhangout
=========

A platform for running large scale online un-conference-style events using Google Hangouts for many simultaneous small sessions..

You can read more about the vision and motivation for this project here: http://dmlcentral.net/blog/philipp-schmidt/unhangouts


Dependencies
------------

Full library dependencies are shown in `package.json`. The major tools this platform depends on are:

 - express
 - sockjs
 - redis
 - backbone
 - marionette
 - mocha (for testing)

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

 * `npm run-script setup` - loads the current `conf.sh` file into the environment.
 * `npm start` - used for development purposes; output is sent to the console by default
 * `npm test` - runs the test suite. Expects the server not to be running - it will start its own instance for tests.
 * `npm run-script forever-start` - starts the server as a background daemon, in a forever container that will restart it if it crashes
 * `npm run-script forever-list` - list the forever processes currently running
 * `npm run-script forever-stop` - stop the background instance of the server.
 * `npm run-script forever-restart` - restart the background instance of the server.


The `forever-*` commands depend on the forever tool. You can install it with `[sudo] npm install forever -g`. The forever commands run in a sudo context because in most production situations you'll want to be running on port 80. It would be nice to shed these priveleges after binding to 80, but we don't support that yet. If you're super concerned about it, you could run the server behind a websocket-friendly proxy like HAProxy.

Typically, deployment means checking out the latest version on the server and then calling `forever-restart`. A running server doesn't read from any files during operation, so it's safe to replace the files out from under it without causing a problem.
