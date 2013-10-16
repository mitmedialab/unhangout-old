Setting up the development environment
--------------------------------------

Unhangout is an un-conference style platform for organizing Google hangout sessions. Following are the steps for 
setting up the development environment on Ubuntu/Debian machine.

A. Installing node.js (any version)

   - Update your system <br>
     $ sudo apt-get update
             
   - Setup the system to handle compiling and installing from source <br>
     $ sudo apt-get build-essential
     
   - To enable SSL support install libssl-dev <br>
     $ sudo apt-get install libssl-dev
     
   - Install curl used by install script<br>
     $ sudo apt-get install curl
   
   - Cloning into node.js repository <br>
     $ git clone https://github.com/joyent/node.git <br> 
     $ cd node 
     
   - Checkout a specific version of node.js <br>
     $ git tag # Gives you a list of released versions <br> 
     $ git checkout v0.9.9 
     
   - Compile and install node <br>
     $ ./configure <br>
     $ make 
     $ sudo make install 
     
   - To check if the node is installed properly <br>
     $ node -v <br>
     $ v0.9.9
     
B. Setting up npm (Node Package Management)

  - Install from NPM script using curl <br>
    $ curl https://npmjs.org/install.sh -L -o -| sh
    
  - Check npm version <br>
    $ npm -v <br>
    $1.3.1
    
C. Cloning the Repository.

  - Clone unhangout repository from github <br>
    $ git clone http://github.com/drewww/unhangout <br>
    $ cd unhangout
    
  - Create a file and copy the contents of conf.json.example file in it. Name this file conf.json. 
    conf.json.example file contains environment variables to specify server settings. GOOGLE_CLIENT_ID &
    GOOGLE_CLIENT_SECRET fields are app credentials that can be configured and obtained at 
    http://code.google.com/apis/console/

    In the Google API console, you should make a "Client ID for web applications" - that will create
    the necessary CLIENT_ID and CLIENT_SECRET you need to authenticate with Google and create
    calendar events.

    $ touch conf.json <br>
    $ gedit conf.json [copy contents from conf.json.example here]
    
  - Install data structure redis server <br>
    $ sudo apt-get install redis-server 
    
  - Install the required dependencies in local node_modules folder <br>
    $ npm install

  - We strongly recommend running the unhangout-server with SSL enabled. Google Hangouts are always run over SSL, and trying to run a hangout application over http causes many browsers to refuse to send requests, which causes a number of insidious issues. 
    - ensure that UNHANGOUT_USE_SSL in conf.json is set to true.
    - for development purposes, a self-signed certificate will work fine. These instructions from Heroku are quite good: https://devcenter.heroku.com/articles/ssl-certificate-self If you follow those instructions, you will have two resulting files:
      - server.key is your private key, move it to `ssl/` and set the path to that file in UNHANGOUT_PRIVATE_KEY
      - server.crt is your certificate, move it to `ssl/` and set the path to that file in UNHANGOUT_CERTIFICATE
    - for production purposes, you will need to buy a formal certificate. The Heroku instructions for SSL certificates will show you how to generate a certificate signing request, which you will provide to an SSL issuer: https://devcenter.heroku.com/articles/ssl-endpoint#acquire-ssl-certificate
      - after submitting the CSR, the certificate provider will issue you a certificate. Put the private key you used to generate the CSR as well as the associated certificate in `ssl/` and set the paths in UNHANGOUT_PRIVATE_KEY and UNHANGOUT_CERTIFICATE to point to those files.
    - in most production situations, you will want to enable UNHANGOUT_REDIRECT_HTTP. This will start a separate HTTP server that will redirect any requests to their HTTPS equivalent. This presumes that you're using default ports: 80 for HTTP, and 443 for HTTPS, so it requres sudo to bind to privileged ports. In development contexts, set UNHANGOUT_REDIRECT_HTTP to false, and use HTTPS on whatever port you desire.

  - Start the node server and run it in the browser <br>
    $ npm start <br>
    $ 127.0.0.1:7777/ [In browser]

D. Making changes to the codebase

  - Create a new branch in git unhangout repository <br>
    $ git branch branch-name

  - Push the newly created branch on github <br>
    $ git push origin branch-name

  - Switch to the new branch <br>
    $ git checkout branch-name

  - Be sure to be in the newly created branch <br>
    $ git branch <br>
    $ *branch-name <br>
    $  master 

  - Make desired changes in the code base and push them to github <br>
    $ git add file-name <br>
    $ git commit -m "commit-message" <br>
    $ git push origin branch-name <br>
    Go to github and send a pull request. 
