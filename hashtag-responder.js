"use strict";

var twitterAPI = require('node-twitter-api'),
 	fs    = require('fs'),
    nconf = require('nconf'), 
    debug = require('debug')('hashtag');

const CONFIG_PATH = 'config.json';

nconf.argv()
   .file({ file: CONFIG_PATH });

let twitter = new twitterAPI({
    consumerKey: nconf.get('consumerKey'),
    consumerSecret: nconf.get('consumerSecret'),
    callback: nconf.get('callback')
});

twitter.search(
	{q: nconf.get('searchQuery')}, 
	nconf.get('accessToken'),
	nconf.get('accessTokenSecret'),
	function(error, data, response) {
	    if (error) {
	        debug("Something went wrong with tweet retrieval")
	    } else {
	        debug(data.statuses[0]);
	    }
	}
);