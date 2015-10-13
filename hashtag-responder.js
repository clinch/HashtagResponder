"use strict";

var twitterAPI = require('node-twitter-api'),
 	fs    = require('fs'),
    nconf = require('nconf'), 
    debug = require('debug')('hashtag');

debug('Starting...');

nconf.argv()
   .file({ file: 'config.json' });
   
debug('Got config values. Eg key: ' + nconf.get('consumerKey'));

let twitter = new twitterAPI({
    consumerKey: nconf.get('consumerKey'),
    consumerSecret: nconf.get('consumerSecret'),
    callback: nconf.get('callback')
});

twitter.search(//"tweets", 
	{q: "#hansie"}, 
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