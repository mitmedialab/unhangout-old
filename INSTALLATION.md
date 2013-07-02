Un-Hangout : setting up the development environment
---------------------------------------------------

Unhangout is an un-conference style platform for organizing Google hangout sessions. Following are the steps for 
setting up the development environment on Ubuntu/Debian machine.

A. Installing node.js (any version)

   - Step 1. Update your system
     $ sudo apt-get update
             
   - Step 2. Setup the system to handle compiling and installing from source
     $ sudo apt-get build-essential
     
   - Step 3. To enable SSL support install libssl-dev
     $ sudo apt-get install libssl-dev
     
   - Step 4. Install curl used by install script.
     $ sudo apt-get install curl
   
   - Step 5. Cloning into node.js repository
     $ git clone https://github.com/joyent/node.git 
     $ cd node
     
   - Step 6. Checkout a specific version of node.js
     $ git tag # Gives you a list of released versions 
     $ git checkout v0.9.9 
     
   - Step 7. Compile and install node
     $ ./configure 
     $ make 
     $ sudo make install 
     
   - Step 8. To check if the node is installed properly
     $ node -v
     $ v0.9.9
     
B. Setting up npm (Node Package Management)

  - Step 1. Install from NPM script using curl
    $ curl https://npmjs.org/install.sh -L -o -| sh
    
  - Step 2. Check npm version
    $ npm -v
    $1.3.1
    
C. Cloning the Repository.

  - Step 1. Clone unhangout repository from github
    $ git clone http://github.com/drewww/unhangout
    $ cd unhangout
    
  - Step 2. Create a file and copy the contents of conf.sh.example file in it. Name this file as conf.sh. 
    conf.sh.example file contains environment variables to specify server settings. GOOGLE_CLIENT_ID &
    GOOGLE_CLIENT_SECRET fields are app credentials that can be configured and obtained at 
    http://code.google.com/apis/console/

    $ touch conf.sh
    $ gedit conf.sh[copy contents from conf.sh.example here]
    
  - Step 3. Set the environment variables to specify server settings.
    $ source conf.sh 
    
  - Step 4. Install data structure redis server
    $ sudo apt-get install redis-server 
    
  - Step 5. Install the required dependencies in local node_modules folder.
    $ npm install
    
  - Step 6. Start the node server and run it in the browser.
    $ npm start
    $ 127.0.0.1:7777/ [In browser]

D. Making changes to the codebase

  - Step 1. Create a new branch in git unhangout repository.
    $ git branch branch-name

  - Step 2. Push the newly created branch on github
    $ git push origin branch-name

  - Step 3. Switch to the new branch
    $ git checkout branch-name

  - Step 4. Be sure to be in the newly created branch.
    $ git branch
    $ *branch-name
    $  master 

  - Step 5. Make desired changes in the code base and push them to github.
    $ git add file-name
    $ git commit -m "commit-message"
    $ git push origin branch-name
    Go to github and send a pull request. 
