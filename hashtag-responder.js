"use strict";

var twitterAPI = require('node-twitter-api'),
 	fs    = require('fs'),
    nconf = require('nconf'), 
    redis = require("redis"),
    debug = require('debug')('hashtag'),
    tempTweet = require('debug')('tweet');

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

	let currentTweet;
	let excludeScreenNames = nconf.get('excludeScreenNames');

	let photoTweetsOnly = nconf.get('photoTweetsOnly');

	for (let i = 0; i < tweetArray.length; i++) {
		currentTweet = tweetArray[i];

		// Check to make sure this isn't a tweet that we made ourselves
		screenName = currentTweet.user.screen_name;
		if (myScreenName == screenName) {
			continue;
		}

		// Leave out any users that we don't want to tweet to.
		let matched = false;
		if (excludeScreenNames) {
			for (let i = 0; i < excludeScreenNames.length; i++) {
				if (excludeScreenNames[i] == screenName) {
					matched = true;
					break;
				}
			}
			if (matched) {
				debug(`Excluding ${screenName}`);
				continue;
			}
		}

		// Check to make sure this is an original tweet and NOT a retweet.
		if (currentTweet.retweeted_status != undefined) {
			continue;
		}

		// If we only want tweets with photos, now's the time
		if (photoTweetsOnly) {
			if (currentTweet.entities && currentTweet.entities.media) {
				let hasPic = false;
				for (let j = 0; j < currentTweet.entities.media.length; j++) {
					if (currentTweet.entities.media[j].type == 'photo') {
						hasPic = true;
					}
				}
				if (hasPic == false) {
					continue;
				}
			}
		}

		tweetOut(currentTweet, getResponse(currentTweet));	

		if (currentTweet.id > maxId) {
			maxId = currentTweet.id;
		}
	}

	// We save the max message id because we can search for messages newer than
	// this next iteration.
	if (maxId != 0) {
		client.set(`${REDIS_PREFIX}LastId`, maxId);
		debug(`Most recent Tweet id is ${maxId}`);
	}

}

/**
 * Sends the response out to the Twitterverse.
 * @param  {Tweet} tweet    The full, original tweet
 * @param  {String} response The response to send to the original tweeter.
 */
function tweetOut(tweet, response) {

	// Look to see if we've already responded to this tweet.
	searchForExisting(tweet.id)
		.then(() => { 
			// Log the send.
			client.set(REDIS_PREFIX + tweet.id, response);
			// Send
			tempTweet(response);
		})
		.catch(error => { debug(error) });
}

/**
 * Searches Redis for an existing tweet that we have responded to. Promise
 * will resolve if no previous tweet has been found. Will reject if found or 
 * if error.
 * @param  {Number} tweetId The id associated with the Tweet.
 * @return {Promise}         A promise which will resolve.
 */
function searchForExisting(tweetId) {
	return new Promise(function(resolve, reject) {
		client.get(REDIS_PREFIX + tweetId, function(err, result) {
			if (err) {
				reject(Error(err));
			} else {
				if (result === null) {
					resolve();
				} else {
					reject(`Response already sent to Tweet ${tweetId}`);
				}
			}
		});
	});
}

/**
 * Creates a response to the tweet passed as a parameter
 * @param  {Tweet} tweet A Twitter Tweet object. https://dev.twitter.com/overview/api/tweets
 * @return {String}       A response to send to the user
 */
function getResponse(tweet) {
	let allResponses;
	let response;

	if (tweet == undefined) {
		throw new Error('getResponse: No tweet defined.');
	}

	allResponses = nconf.get('replyWith');

	if (allResponses == undefined || allResponses.length == 0) {
		throw new Error('There are no responses defined in config file. Populate at least one response.');
	}

	response = allResponses[Math.floor(Math.random() * allResponses.length)];

	response = fillTemplate(tweet, response);

	return response;
}

function fillTemplate(tweet, response) {
	return response.split('$SCREEN_NAME$').join('@' + tweet.user.screen_name);
}
