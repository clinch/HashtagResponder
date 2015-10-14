"use strict";

var twitterAPI = require('node-twitter-api'),
 	fs    = require('fs'),
    nconf = require('nconf'), 
    redis = require("redis"),
    debug = require('debug')('hashtag');

const CONFIG_PATH = 'config.json';

// Use MAX_TWEET_COUNT as a safety measure in case you get a huge search result
// which starts your client responding. 
const MAX_TWEET_COUNT = 15;

const REDIS_PREFIX = "hashtag-responder:";

// Set up Redis connection
let client = redis.createClient();
client.on("error", err => console.log("Redis Error " + err));


// Read config file
nconf.argv()
   .file({ file: CONFIG_PATH });

let twitter = new twitterAPI({
    consumerKey: nconf.get('consumerKey'),
    consumerSecret: nconf.get('consumerSecret'),
    callback: nconf.get('callback')
});


// Get info on currently-authenticated user
// https://dev.twitter.com/rest/reference/get/account/settings


// Perform the twitter search.
twitter.search(
	{
		q: nconf.get('searchQuery'),
		result_type: 'recent',
		include_entities: true,
		count: MAX_TWEET_COUNT
	}, 
	nconf.get('accessToken'),
	nconf.get('accessTokenSecret'),
	function(error, data, response) {
	    if (error) {
	        debug("Something went wrong with tweet retrieval")
	    } else {
	    	respondToTweets(data.statuses);
	    }
	}
);

/**
 * Analyzes the current tweet/status array, and then responds to them.
 * @param  {Array} tweetArray An array of twitter Tweet objects.
 *                            https://dev.twitter.com/overview/api/tweets
 */
function respondToTweets(tweetArray) {

	let maxId = 0;
	let screenName = '';

	for (let i = 0; i < tweetArray.length; i++) {
		// Check to make sure this isn't a tweet that we made ourselves
		

		// Check to make sure this is an original tweet and NOT a retweet.


		screenName = `@${tweetArray[i].user.screen_name}`;

		debug(screenName + ": " + tweetArray[i].text);
		if (tweetArray[i].id > maxId) {
			maxId = tweetArray[i].id;
		}
	}

	// We save the max message id because we can search for messages newer than
	// this next iteration.
	if (maxId != 0) {
		client.set(`${REDIS_PREFIX}LastId`, maxId);
	}

}
