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

let myScreenName = '';

// Read config file
nconf.argv()
   .file({ file: CONFIG_PATH });

let twitter = new twitterAPI({
    consumerKey: nconf.get('consumerKey'),
    consumerSecret: nconf.get('consumerSecret'),
    callback: nconf.get('callback')
});


getAuthenticatedUser()
	.then(function(screenName) {
		debug(`Hey there ${screenName}`);
		
		myScreenName = screenName;
		return getTweets();
	})
	.then(respondToTweets)
	.catch(function(error) {
		console.log(error);
	}); 


/**
 * Gets (a promise for) the currently authenticated user from the Twitter API.	
 * @return {Promise} A Promise for the currently authenticated user.
 */
function getAuthenticatedUser() {
	return new Promise(function(resolve, reject) {
		twitter.verifyCredentials(
			nconf.get('accessToken'),
			nconf.get('accessTokenSecret'),
			function(error, data, response) {
		    if (error) {
		        reject(Error(error));
		    } else {
		        resolve(data["screen_name"]);
		    }
		});
	});
}

/**
 * Gets (a promise for) any Tweets matching our seasrch criteria
 * @return {Promise} A Promise of a collection of Tweets matching our search
 */
function getTweets() {
	return new Promise(function(resolve, reject) {
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
			        reject(Error(error));
			    } else {
			    	resolve(data.statuses);
			    }
			}
		);
	});
}

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
		screenName = tweetArray[i].user.screen_name;
		if (myScreenName == screenName) {
			continue;
		}

		// Check to make sure this is an original tweet and NOT a retweet.
		if (tweetArray[i].retweeted_status != undefined) {
			continue;
		}

		if (tweetArray[i].id > maxId) {
			maxId = tweetArray[i].id;
		}
	}

	// We save the max message id because we can search for messages newer than
	// this next iteration.
	if (maxId != 0) {
		client.set(`${REDIS_PREFIX}LastId`, maxId);
		debug(`Most recent Tweet id is ${maxId}`);
	}

}
