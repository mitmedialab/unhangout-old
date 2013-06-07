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
 4. [Eventually, we will also need to set up a dedicated google account for owning the calendar that creates hangout links for us.]