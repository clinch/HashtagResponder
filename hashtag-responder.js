"use strict";

var twitterAPI = require('node-twitter-api'),
 	fs    = require('fs'),
    nconf = require('nconf'), 
    redis = require("redis"),
    process = require('process'),
    debug = require('debug')('hashtag'),
    tempTweet = require('debug')('tweet');

const CONFIG_PATH = 'config.json';

// Use MAX_TWEET_COUNT as a safety measure in case you get a huge search result
// which starts your client responding. 
const MAX_TWEET_COUNT = 15;

let dryRun = false;
// Watch for dry run
if (process.argv.length > 2) {
	if (process.argv[2] === '--dry-run') {
		dryRun = true;
		console.log('Dry run. Will not send any tweets, but will update database.');
	}
}

// Set up Redis connection
let client = redis.createClient();
client.on("error", err => console.log("Redis Error " + err));

let myScreenName = '';

// Read config file
nconf.argv()
   .file({ file: CONFIG_PATH });

// Check
let redisPrefix = "hashtag-responder:";
if (nconf.get('redisPrefix')) {
	redisPrefix = nconf.get('redisPrefix');
}

let twitter = new twitterAPI({
    consumerKey: nconf.get('consumerKey'),
    consumerSecret: nconf.get('consumerSecret'),
    callback: nconf.get('callback')
});

let maxId = 0;

searchForMaxId()
	.then(function(result) {
		if (result === null) {
			console.log('There was no previous Max ID stored. Is this the first time you are running? Be careful out there.');
		} else {
			maxId = result;
		}
		return getAuthenticatedUser();
	})
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
 * Searches Redis for a previous maximum tweet Id. To be efficient, only search for 
 * tweets newer than this. Promise will resolve as long as search does not error. 
 * 
 * @return {Promise}         A promise which will resolve with data
 */
function searchForMaxId() {
	return new Promise(function(resolve, reject) {
		client.get(`${redisPrefix}LastId`, function(err, result) {
			if (err) {
				reject(Error(err));
			} else {
				resolve(result);
			}
		});
	});
}

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
		let query = {
				q: nconf.get('searchQuery'),
				result_type: 'recent',
				include_entities: true,
				count: MAX_TWEET_COUNT
			};
		if (maxId > 0) {
			debug(`Only searching for tweets newer than ${maxId}`);
			query.since_id = maxId;
		}

		// Perform the twitter search.
		twitter.search(
			query, 
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
	let maxIdStr = "";
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

		if (currentTweet.id_str > maxIdStr) {
			maxId = currentTweet.id;
			maxIdStr = currentTweet.id_str;
		}
	}

	// We save the max message id because we can search for messages newer than
	// this next iteration.
	if (maxIdStr != "") {
		client.set(`${redisPrefix}LastId`, maxIdStr);
		debug(`Most recent Tweet id is ${maxIdStr}`);
	}

}

/**
 * Sends the response out to the Twitterverse.
 * @param  {Tweet} tweet    The full, original tweet
 * @param  {String} response The response to send to the original tweeter.
 */
function tweetOut(tweet, response) {

	// Look to see if we've already responded to this tweet.
	searchForExisting(tweet.id_str)
		.then(() => { 
			// Log the send.
			client.set(`${redisPrefix}${tweet.id}`, response);
			
			// Send
			tempTweet("response to " + tweet.id_str + " " + response);
			if (!dryRun) {
				twitter.statuses('update', {
						status: response,
						in_reply_to_status_id: tweet.id_str
					}, 
					nconf.get('accessToken'),
					nconf.get('accessTokenSecret'),
					function(error, data, response) {
						if (error) {
							console.log(error);
						}
					}
				);
			}

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
		client.get(`${redisPrefix}${tweetId}`, function(err, result) {
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

/**
 * Replaces keywords with appropriate filler text
 * @param  {Tweet} tweet    The original full Tweet 
 * @param  {String} response The template response.
 * @return {String}          The template populated with appropriate values
 */
function fillTemplate(tweet, response) {
	return response.split('$SCREEN_NAME$').join('@' + tweet.user.screen_name);
}
