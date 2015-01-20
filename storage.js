//The MIT License (MIT)
	
	//Copyright (c) 2014 Dave Winer
	
	//Permission is hereby granted, free of charge, to any person obtaining a copy
	//of this software and associated documentation files (the "Software"), to deal
	//in the Software without restriction, including without limitation the rights
	//to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	//copies of the Software, and to permit persons to whom the Software is
	//furnished to do so, subject to the following conditions:
	
	//The above copyright notice and this permission notice shall be included in all
	//copies or substantial portions of the Software.
	
	//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	//IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	//FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	//AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	//LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	//OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
	//SOFTWARE.

var myVersion = "0.62", myProductName = "nodeStorage";

var http = require ("http"); 
var urlpack = require ("url");
var twitterAPI = require ("node-twitter-api");
var fs = require ("fs");
var request = require ("request");
var s3 = require ("./lib/s3.js");
var utils = require ("./lib/utils.js");
var dns = require ("dns");

//environment variables
	var myPort = process.env.PORT;
	var flEnabled = process.env.enabled; 
	var longPollTimeoutSecs = process.env.longPollTimeoutSecs; 
	var s3Path = process.env.s3Path; //where we store publicly accessible data, user files, logs
	var s3PrivatePath = process.env.s3PrivatePath; //where we store private stuff, user's prefs for example
	var myDomain = process.env.myDomain; 
	var bitlyApiKey = process.env.bitlyApiKey;
	var bitlyApiUsername = process.env.bitlyApiUsername;

var serverStats = {
	today: new Date (),
	ctHits: 0, 
	ctHitsThisRun: 0,
	ctHitsToday: 0,
	ctTweets: 0, 
	ctTweetsThisRun: 0,
	ctTweetsToday: 0, 
	ctTweetErrors: 0,
	whenServerStart: 0,
	ctHoursServerUp: 0,
	ctServerStarts: 0,
	version: 0,
	ctFileSaves: 0, //8/3/14 by DW
	ctLongPollPushes: 0,  //12/16/14 by DW
	ctLongPollPops: 0,  //12/16/14 by DW
	ctLongPollTimeouts: 0,  //12/16/14 by DW
	ctLongPollUpdates: 0, //12/16/14 by DW
	ctCurrentLongPolls: 0,  //12/16/14 by DW
	ctLongPollsToday: 0,  //12/17/14 by DW
	recentTweets: []
	};
var fnameStats = "data/serverStats.json", flStatsDirty = false, maxrecentTweets = 500; 

var serverPrefs = {
	flArchiveTweets: true
	};
var fnamePrefs = "data/serverPrefs.json";
var fnameTweetsFolder = "data/tweets/";

var requestTokens = []; //used in the OAuth dance
var screenNameCache = []; 

function httpReadUrl (url, callback) {
	request (url, function (error, response, body) {
		if (!error && (response.statusCode == 200)) {
			callback (body) 
			}
		});
	}

//request token cache -- part of the OAuth dance
	function findRequestToken (theRequestToken, flDelete) {
		for (var i = 0; i < requestTokens.length; i++) {
			if (requestTokens [i].rt == theRequestToken) {
				var secret = requestTokens [i].secret;
				requestTokens.splice (i, 1);
				return (secret);
				}
			}
		return (undefined);
		}
	function saveRequestToken (requestToken, requestTokenSecret) {
		var obj = new Object ();
		obj.rt = requestToken;
		obj.secret = requestTokenSecret;
		requestTokens [requestTokens.length] = obj;
		}
//whitelist -- 11/18/14 by DW
	var urlWhitelist = process.env.urlUserWhitelist, userWhitelist = [];
	
	function readUserWhitelist (callback) {
		if (urlWhitelist != undefined) {
			httpReadUrl (urlWhitelist, function (s) {
				try {
					userWhitelist = JSON.parse (s);
					console.log ("readWhitelist: " + userWhitelist.length + " names on the list.");
					}
				catch (err) {
					console.log ("readWhitelist: error parsing whitelist JSON -- \"" + err + "\"");
					}
				if (callback != undefined) {
					callback ();
					}
				});
			}
		else {
			if (callback != undefined) {
				callback ();
				}
			}
		}
	function isWhitelistedUser (username) {
		if (urlWhitelist == undefined) { //no whitelist, everyone is whitelisted
			return (true);
			}
		else {
			username = utils.stringLower (username);
			for (var i = 0; i < userWhitelist.length; i++) {
				if (utils.stringLower (userWhitelist [i]) == username) {
					return (true);
					}
				}
			return (false);
			}
		}
	
	
//long polling -- 12/15/14 by DW
	var waitingLongpolls = new Array ();
	
	function getLongpollTimeout () {
		if (longPollTimeoutSecs == undefined) { //the environment variable wasn't defined
			return (Number (20000.0)); //20 seconds
			}
		else {
			return (Number (longPollTimeoutSecs) * 1000.0);
			}
		}
	function pushLongpoll (urlToWatchFor, httpResponse) {
		var ctMilliseconds = getLongpollTimeout ();
		var whenExpires = new Date (Number (new Date ()) + ctMilliseconds);
		waitingLongpolls [waitingLongpolls.length] = {
			url: urlToWatchFor,
			whenTimeout: whenExpires,
			response: httpResponse
			}
		serverStats.ctLongPollPushes++; 
		serverStats.ctLongPollsToday++;
		flStatsDirty = true;
		console.log ("pushLongpoll: " + waitingLongpolls.length + " requests are waiting in the array.")
		}
	function checkLongpolls () { //expire timed-out longpolls
		var now = new Date ();
		for (var i = waitingLongpolls.length - 1; i >= 0; i--) {
			var obj = waitingLongpolls [i];
			if (now >= obj.whenTimeout) {
				console.log ("Timing-out request #" + i);
				obj.response.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
				obj.response.end ("timeout");    
				waitingLongpolls.splice (i, 1);
				serverStats.ctLongPollPops++; 
				serverStats.ctLongPollTimeouts++; 
				flStatsDirty = true;
				}
			}
		}
	function checkLongpollsForUrl (url, filetext) { //if someone was waiting for the url to change, their wait is over
		for (var i = waitingLongpolls.length - 1; i >= 0; i--) {
			var obj = waitingLongpolls [i];
			if (obj.url == url) {
				console.log ("Request #" + i + " is returning because the resource updated.");
				obj.response.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
				obj.response.end ("update\r" + filetext);    
				waitingLongpolls.splice (i, 1);
				serverStats.ctLongPollPops++; 
				serverStats.ctLongPollUpdates++; 
				flStatsDirty = true;
				}
			}
		}
	
	
//blocking -- 11/9/14 by DW
	function tweetContainsBlockedTag (twitterStatus) { //blocking is not present in this version -- 12/16/14 by DW
		return (false); 
		}
//stats & prefs -- 1/15/15 by DW
	function statsChanged () {
		flStatsDirty = true;
		}
	function loadStruct (fname, struct, callback) {
		s3.getObject (s3Path + fname, function (error, data) {
			if (data != null) {
				var oldStruct = JSON.parse (data.Body);
				for (var x in oldStruct) { 
					struct [x] = oldStruct [x];
					}
				}
			if (callback != undefined) {
				callback ();
				}
			});
		}
	function saveStruct (fname, struct, callback) {
		s3.newObject (s3Path + fname, utils.jsonStringify (struct));
		}
	function loadServerStats (callback) {
		loadStruct (fnameStats, serverStats, function () {
			serverStats.ctHitsThisRun = 0;
			serverStats.ctTweetsThisRun = 0;
			serverStats.whenServerStart = new Date ();
			serverStats.ctServerStarts++;
			if (callback != undefined) {
				callback ();
				}
			});
		}
	function saveServerStats () {
		flStatsDirty = false;
		serverStats.ctHoursServerUp = utils.secondsSince (serverStats.whenServerStart) / 3600; //4/28/14 by DW
		serverStats.ctCurrentLongPolls = waitingLongpolls.length; //12/16/14 by DW
		saveStruct (fnameStats, serverStats);
		}
	function loadServerPrefs (callback) {
		loadStruct (fnamePrefs, serverPrefs, function () {
			saveStruct (fnamePrefs, serverPrefs);
			if (callback != undefined) {
				callback ();
				}
			});
		}

function newTwitter (myCallback) {
	var twitter = new twitterAPI ({
		consumerKey: process.env.twitterConsumerKey,
		consumerSecret: process.env.twitterConsumerSecret,
		callback: myCallback
		});
	return (twitter);
	}
function getScreenName (accessToken, accessTokenSecret, callback) { //7/9/14 by DW
	//see if we can get it from the cache first
		for (var i = 0; i < screenNameCache.length; i++) {
			var obj = screenNameCache [i];
			if ((obj.accessToken == accessToken) && (obj.accessTokenSecret == accessTokenSecret)) {
				obj.ctAccesses++;
				
				if (isWhitelistedUser (obj.screenName)) { //11/18/14 by DW
					callback (obj.screenName);
					}
				else {
					callback (undefined);
					}
				return;
				}
			}
	//call Twitter
		var twitter = newTwitter ();
		twitter.verifyCredentials (accessToken, accessTokenSecret, function (error, data, response) {
			if (error) {
				callback (undefined);    
				console.log ("getScreenName: error getting name. " + utils.jsonStringify (error)); 
				}
			else {
				var obj = new Object ();
				obj.accessToken = accessToken;
				obj.accessTokenSecret = accessTokenSecret;
				obj.screenName = data.screen_name; //the whole point! ;-)
				obj.ctAccesses = 0;
				screenNameCache [screenNameCache.length] = obj;
				
				if (isWhitelistedUser (data.screen_name)) { //11/18/14 by DW
					callback (data.screen_name);
					}
				else {
					callback (undefined);
					}
				
				}
			});
	}
	
function saveTweet (theTweet) { //7/2/14 by DW
	if (serverPrefs.flArchiveTweets) {
		try {
			var idTweet = theTweet.id_str;
			if (idTweet != undefined) { //it would be undefined if there was an error, like "Status is over 140 characters."
				var filepath = s3Path + fnameTweetsFolder + utils.getDatePath (new Date (), true) + idTweet + ".json";
				s3.newObject (filepath, utils.jsonStringify (theTweet));
				}
			}
		catch (tryError) {
			console.log ("saveTweet error: " + tryError.message);    
			}
		}
	}
function addTweetToLog (tweetObject, startTime) { //4/27/14 by DW
	var now = new Date ();
	if (startTime == undefined) {
		startTime = now;
		}
	serverStats.ctTweets++;
	serverStats.ctTweetsThisRun++;
	serverStats.ctTweetsToday++;
	
	var obj = new Object ();
	obj.text = tweetObject.text;
	obj.id = tweetObject.id_str; //9/3/14 by DW
	obj.user = tweetObject.user.screen_name;
	
	//obj.inReplyToId
		{
			var x = tweetObject.in_reply_to_status_id;
			if (x == null) {
				x = 0;
				}
			obj.inReplyToId = x;
			}
	
	obj.when = now.toLocaleString ();
	
	obj.secs = utils.secondsSince (startTime); 
	serverStats.recentTweets.unshift (obj);  //add at beginning of array
	while (serverStats.recentTweets.length > maxrecentTweets) { //keep array within max size
		serverStats.recentTweets.pop ();
		}
	statsChanged ();
	}
function getS3UsersPath (flPrivate) { //8/3/14 by DW
	if (utils.getBoolean (flPrivate)) {
		return (s3PrivatePath + "users/");
		}
	else {
		return (s3Path + "users/");
		}
	}
function getS3Acl (flPrivate) { //8/3/14 by DW
	if (utils.getBoolean (flPrivate)) {
		return ("private");
		}
	else {
		return ("public-read");
		}
	}
function getUserFileList (s3path, callback) { //12/21/14 by DW
	var now = new Date (), theList = new Array ();
	s3.listObjects (s3path, function (obj) {
		if (obj.flLastObject != undefined) {
			if (callback != undefined) {
				callback (undefined, theList);
				}
			}
		else {
			theList [theList.length] = obj;
			}
		});
	}
function everySecond () {
	checkLongpolls ();
	if (flStatsDirty) {
		saveServerStats ();
		}
	}
function everyMinute () {
	readUserWhitelist (); //11/18/14 by DW
	}

function handleHttpRequest (httpRequest, httpResponse) {
	try {
		var parsedUrl = urlpack.parse (httpRequest.url, true), now = new Date ();
		var startTime = now, flStatsSaved = false, host, lowerhost, port, referrer;
		var lowerpath = parsedUrl.pathname.toLowerCase ();
		
		function addOurDataToReturnObject (returnObject) {
			returnObject ["#smallpict"] = {
				productname: myProductName,
				version: myVersion
				};
			}
		function getTwitterTimeline (whichTimeline) {
			var accessToken = parsedUrl.query.oauth_token;
			var accessTokenSecret = parsedUrl.query.oauth_token_secret;
			var userId = parsedUrl.query.user_id;
			var sinceId = parsedUrl.query.since_id;
			var twitter = newTwitter ();
			var params = {user_id: userId, trim_user: "false"};
			
			if (sinceId != undefined) {
				params.since_id = sinceId;
				}
			
			twitter.getTimeline (whichTimeline, params, accessToken, accessTokenSecret, function (error, data, response) {
				if (error) {
					console.log ("getTwitterTimeline: error == " + error.message);
					httpResponse.writeHead (500, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"}); //changed from 503 -- 6/20/14 by DW
					httpResponse.end (utils.jsonStringify (error));    
					}
				else {
					httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
					addOurDataToReturnObject (data);
					httpResponse.end (utils.jsonStringify (data));    
					}
				});
			}
		function errorResponse (error) {
			httpResponse.writeHead (500, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
			httpResponse.end (utils.jsonStringify (error));    
			}
		function dataResponse (data) { //6/21/14 by DW
			httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
			addOurDataToReturnObject (data);
			httpResponse.end (utils.jsonStringify (data));    
			}
		function encode (s) {
			return (encodeURIComponent (s));
			}
		
		//stats
			serverStats.ctHits++;
			serverStats.ctHitsThisRun++;
			serverStats.ctHitsToday++;
			serverStats.version = myVersion;  //2/24/14 by DW
			if (!utils.sameDay (serverStats.today, now)) { //date rollover
				serverStats.today = now;
				serverStats.ctHitsToday = 0;
				serverStats.ctTweetsToday = 0;
				serverStats.ctLongPollsToday = 0;
				}
			statsChanged ();
		//set host, port
			host = httpRequest.headers.host;
			if (utils.stringContains (host, ":")) {
				port = utils.stringNthField (host, ":", 2);
				host = utils.stringNthField (host, ":", 1);
				}
			else {
				port = 80;
				}
			lowerhost = host.toLowerCase ();
		//set referrer
			referrer = httpRequest.headers.referer;
			if (referrer == undefined) {
				referrer = "";
				}
			
		//log the request
			dns.reverse (httpRequest.connection.remoteAddress, function (err, domains) {
				var client = httpRequest.connection.remoteAddress;
				if (!err) {
					if (domains.length > 0) {
						client = domains [0];
						}
					}
				console.log (now.toLocaleTimeString () + " " + httpRequest.method + " " + host + ":" + port + " " + lowerpath + " " + referrer + " " + client);
				});
		
		if (flEnabled) { 
			switch (httpRequest.method) {
				case "POST":
					var body = "";
					httpRequest.on ("data", function (data) {
						body += data;
						});
					httpRequest.on ("end", function () {
						switch (parsedUrl.pathname.toLowerCase ()) {
							case "/statuswithmedia": //6/30/14 by DW -- used in Little Card Editor
								var params = {
									url: "https://api.twitter.com/1.1/statuses/update_with_media.json",
									oauth: {
										consumer_key: process.env.twitterConsumerKey,
										consumer_secret: process.env.twitterConsumerSecret,
										token: parsedUrl.query.oauth_token,
										token_secret: parsedUrl.query.oauth_token_secret
										}
									}
								function requestCallback (error, response, body) {
									if (error) {
										errorResponse (error);
										}
									else {
										saveTweet (body); //7/2/14 by DW
										dataResponse (body);
										console.log (utils.jsonStringify (body));    
										}
									}
								var r = request.post (params, requestCallback);
								var form = r.form ();
								var buffer = new Buffer (body, "base64"); 
								form.append ("status", parsedUrl.query.status);
								form.append ("media[]", buffer, {filename: "picture.png"});
								break;
							case "/publishfile": //8/3/14 by DW
								var twitter = newTwitter ();
								var accessToken = parsedUrl.query.oauth_token;
								var accessTokenSecret = parsedUrl.query.oauth_token_secret;
								var relpath = parsedUrl.query.relpath;
								var type = parsedUrl.query.type;
								var flprivate = utils.getBoolean (parsedUrl.query.flprivate);
								getScreenName (accessToken, accessTokenSecret, function (screenName) {
									if (screenName === undefined) {
										errorResponse ({message: "Can't save the file because the accessToken is not valid."});    
										}
									else {
										var s3path = getS3UsersPath (flprivate) + screenName + "/" + relpath;
										var metadata = {whenLastUpdate: new Date ().toString ()};
										
										
										s3.newObject (s3path, body, type, getS3Acl (flprivate), function (error, data) {
											if (error) {
												errorResponse (error);    
												}
											else {
												metadata.url = "http:/" + s3path;
												dataResponse (metadata);
												serverStats.ctFileSaves++;
												statsChanged ();
												if (!flprivate) { //12/15/14 by DW
													checkLongpollsForUrl (metadata.url, body);
													}
												}
											}, metadata);
										}
									});
								break;
							default: 
								httpResponse.writeHead (200, {"Content-Type": "text/html"});
								httpResponse.end ("post received, pathname == " + parsedUrl.pathname);
								break;
							}
						});
					break;
				case "GET":
					switch (lowerpath) {
						case "/version":
							httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
							httpResponse.end (myVersion);    
							break;
						case "/now":
							httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
							httpResponse.end (now.toString ());    
							break;
						case "/status": 
							var myStatus = {
								version: myVersion, 
								now: now.toUTCString (), 
								whenServerStart: serverStats.whenServerStart.toUTCString (), 
								hits: serverStats.ctHits, 
								hitsToday: serverStats.ctHitsToday,
								tweets: serverStats.ctTweets,
								tweetsToday: serverStats.ctTweetsToday,
								ctFileSaves: serverStats.ctFileSaves
								};
							httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
							httpResponse.end (utils.jsonStringify (myStatus));    
							break;
						case "/connect": 
							var twitter = new twitterAPI ({
								consumerKey: process.env.twitterConsumerKey,
								consumerSecret: process.env.twitterConsumerSecret,
								callback: "http://" + myDomain + "/callbackFromTwitter?redirectUrl=" + encodeURIComponent (parsedUrl.query.redirect_url)
								});
							twitter.getRequestToken (function (error, requestToken, requestTokenSecret, results) {
								if (error) {
									errorResponse (error); //6/30/14 by DW
									}
								else {
									saveRequestToken (requestToken, requestTokenSecret);
									
									
									var twitterOauthUrl = "https://twitter.com/oauth/authenticate?oauth_token=" + requestToken;
									httpResponse.writeHead (302, {"location": twitterOauthUrl});
									httpResponse.end ("302 REDIRECT");    
									}
								});
							break;
						case "/callbackfromtwitter":
							
							var twitter = new twitterAPI ({
								consumerKey: process.env.twitterConsumerKey,
								consumerSecret: process.env.twitterConsumerSecret,
								callback: undefined
								});
							
							var myRequestToken = parsedUrl.query.oauth_token;
							var myTokenSecret = findRequestToken (myRequestToken, true);
							
							
							twitter.getAccessToken (myRequestToken, myTokenSecret, parsedUrl.query.oauth_verifier, function (error, accessToken, accessTokenSecret, results) {
								if (error) {
									console.log ("twitter.getAccessToken: error == " + error.message);
									}
								else {
									
									var url = parsedUrl.query.redirectUrl + "?oauth_token=" + encode (accessToken) + "&oauth_token_secret=" + encode (accessTokenSecret) + "&user_id=" + encode (results.user_id) + "&screen_name=" + encode (results.screen_name);
									
									httpResponse.writeHead (302, {"location": url});
									httpResponse.end ("302 REDIRECT");    
									}
								});
							break;
						case "/getmytweets":
							getTwitterTimeline ("user");
							break;
						case "/getmymentions":
							getTwitterTimeline ("mentions");
							break;
						case "/tweet":
							var accessToken = parsedUrl.query.oauth_token;
							var accessTokenSecret = parsedUrl.query.oauth_token_secret;
							var twitterStatus = parsedUrl.query.status;
							var inReplyToId = parsedUrl.query.in_reply_to_status_id;
							var params = {status: twitterStatus, in_reply_to_status_id: inReplyToId};
							var twitter = newTwitter ();
							
							if (tweetContainsBlockedTag (twitterStatus)) { //11/9/14 by DW
								httpResponse.writeHead (500, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
								httpResponse.end ("Tweet contains a blocked tag.");    
								}
							else {
								twitter.statuses ("update", params, accessToken, accessTokenSecret, function (error, data, response) {
									if (error) {
										httpResponse.writeHead (500, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
										httpResponse.end (utils.jsonStringify (error));    
										serverStats.ctTweetErrors++;
										statsChanged ();
										}
									else {
										httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
										addOurDataToReturnObject (data);
										httpResponse.end (utils.jsonStringify (data));    
										addTweetToLog (data, startTime);
										saveTweet (data); //1/15/15 by DW
										}
									});
								}
							
							break;
						case "/getembedcode": //6/20/14 by DW
							
							var url = "https://api.twitter.com/1/statuses/oembed.json?id=" + parsedUrl.query.id;
							
							function addParam (name) {
								if (parsedUrl.query [name] != undefined) {
									url += "&" + name + "=" + parsedUrl.query [name];
									}
								}
							addParam ("maxwidth");
							addParam ("hide_media");
							addParam ("hide_thread");
							addParam ("omit_script");
							addParam ("align");
							addParam ("related");
							addParam ("lang");
							
							request (url, function (error, response, body) {
								if (!error && (response.statusCode == 200)) {
									httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
									httpResponse.end (body);    
									}
								else {
									httpResponse.writeHead (500, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
									httpResponse.end (utils.jsonStringify (error));    
									}
								});
							break;
						case "/getuserinfo": //6/21/14 by DW
							var accessToken = parsedUrl.query.oauth_token;
							var accessTokenSecret = parsedUrl.query.oauth_token_secret;
							var screenName = parsedUrl.query.screen_name;
							var params = {screen_name: screenName};
							var twitter = newTwitter ();
							twitter.users ("show", params, accessToken, accessTokenSecret, function (error, data, response) {
								if (error) {
									errorResponse (error);
									}
								else {
									dataResponse (data);
									}
								});
							break;
						case "/gettweetinfo": //6/25/14 by DW
							var accessToken = parsedUrl.query.oauth_token;
							var accessTokenSecret = parsedUrl.query.oauth_token_secret;
							var params = {id: parsedUrl.query.id};
							var twitter = newTwitter ();
							twitter.statuses ("show", params, accessToken, accessTokenSecret, function (error, data, response) {
								if (error) {
									errorResponse (error);
									}
								else {
									dataResponse (data);
									}
								});
							break;
						case "/retweet": //7/3/14 by DW
							var accessToken = parsedUrl.query.oauth_token;
							var accessTokenSecret = parsedUrl.query.oauth_token_secret;
							var params = {id: parsedUrl.query.id};
							var twitter = newTwitter ();
							twitter.statuses ("retweet", params, accessToken, accessTokenSecret, function (error, data, response) {
								if (error) {
									errorResponse (error);
									}
								else {
									dataResponse (data);
									}
								});
							break;
						case "/getmyscreenname": //7/9/14 by DW -- mostly for testing the new cached getScreenName function
							var accessToken = parsedUrl.query.oauth_token;
							var accessTokenSecret = parsedUrl.query.oauth_token_secret;
							getScreenName (accessToken, accessTokenSecret, function (screenName) {
								dataResponse ({screenName: screenName});
								});
							break;
						case "/getfile": //8/9/14 by DW
							var accessToken = parsedUrl.query.oauth_token;
							var accessTokenSecret = parsedUrl.query.oauth_token_secret;
							var relpath = parsedUrl.query.relpath;
							var flprivate = utils.getBoolean (parsedUrl.query.flprivate);
							var flIncludeBody = utils.getBoolean (parsedUrl.query.flIncludeBody);
							getScreenName (accessToken, accessTokenSecret, function (screenName) {
								if (screenName === undefined) {
									errorResponse ({message: "Can't get the file because the accessToken is not valid."});    
									}
								else {
									var s3path = getS3UsersPath (flprivate) + screenName + "/" + relpath;
									s3.getObject (s3path, function (error, data) {
										if (error) {
											errorResponse (error);    
											}
										else {
											if (flIncludeBody) {
												data.filedata = data.Body.toString (); 
												}
											delete data.Body;
											dataResponse (data);
											}
										});
									}
								});
							break;
						case "/derefurl": //7/31/14 by DW
							var accessToken = parsedUrl.query.oauth_token;
							var accessTokenSecret = parsedUrl.query.oauth_token_secret;
							var shortUrl = parsedUrl.query.url;
							getScreenName (accessToken, accessTokenSecret, function (screenName) {
								if (screenName === undefined) {
									errorResponse ({message: "Can't get the deref the URL because the accessToken is not valid."});    
									}
								else {
									var theRequest = {
										method: "HEAD", 
										url: shortUrl, 
										followAllRedirects: true
										};
									request (theRequest, function (error, response) {
										if (error) {
											errorResponse ({message: "Can't get the deref the URL because there was an error making the HTTP request."});    
											}
										else {
											var theResponse = {
												url: shortUrl,
												longurl: response.request.href
												};
											dataResponse (theResponse);
											}
										});
									}
								});
							break;
						case "/shortenurl": //8/25/14 by DW
							var longUrl = parsedUrl.query.url;
							var apiUrl = "http://api.bitly.com/v3/shorten";
							var apiKey = bitlyApiKey, username = bitlyApiUsername; //1/17/15 by DW -- removed hard-coded constants
							if ((apiKey == undefined) || (username == undefined)) {
								errorResponse ({message: "Can't shorten the URL because the server is not configured to shorten URLs."});    
								}
							else {
								function encode (s) {
									return (encodeURIComponent (s));
									}
								apiUrl += "?login=" + encode (username)
								apiUrl += "&apiKey=" + encode (apiKey)
								apiUrl += "&longUrl=" + encode (longUrl)
								apiUrl += "&format=json"
								request (apiUrl, function (error, response, body) {
									if (!error && (response.statusCode == 200)) {
										var jstruct = JSON.parse (body);
										if (jstruct.status_code != 200) {
											errorResponse ({message: "Can't shorten the URL because bitly returned an error code of " + jstruct.status_code + "."});    
											}
										else {
											var theResponse = {
												shortUrl: jstruct.data.url,
												longUrl: longUrl
												};
											dataResponse (theResponse);
											}
										}
									else { 
										errorResponse ({message: "Can't shorten the URL because there was an error making the HTTP request."});    
										}
									});
								}
							break;
						case "/getrecentposts": //9/16/14 by DW
							var twitter = newTwitter ();
							var accessToken = parsedUrl.query.oauth_token;
							var accessTokenSecret = parsedUrl.query.oauth_token_secret;
							var ctposts = 25; //parsedUrl.query.ctposts;
							getScreenName (accessToken, accessTokenSecret, function (screenName) {
								if (screenName === undefined) {
									errorResponse ({message: "Can't get recent posts because the accessToken is not valid."});    
									}
								else {
									var s3path = getS3UsersPath (true) + screenName + "/";
									s3.getObject (s3path + "postsData.json", function (error, data) {
										if (error) {
											errorResponse (error);    
											}
										else {
											var postsData = JSON.parse (data.Body.toString ());
											var lastpostnum = postsData.nextfilenum - 1;
											var postsArray = [], ct = 0;
											function getOnePost (postnum) {
												var filepath = s3path + "posts/" + utils.padWithZeros (postnum, 7) + ".json";
												
												
												s3.getObject (filepath, function (error, data) {
													if (!error) {
														var jstruct = JSON.parse (data.Body.toString ());
														
														
														postsArray [postsArray.length] = jstruct;
														if ((++ct < ctposts) && (postnum > 0)) {
															getOnePost (postnum - 1);
															}
														else {
															dataResponse (postsArray);
															}
														}
													});
												}
											getOnePost (lastpostnum);
											}
										});
									}
								});
							break;
						case "/iswhitelisted": //11/18/14 by DW
							var screenName = parsedUrl.query.screen_name;
							httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
							httpResponse.end (utils.jsonStringify (isWhitelistedUser (screenName)));    
							break;
						case "/configuration":
							var params = {};
							var twitter = newTwitter ();
							twitter.help ("configuration", params, accessToken, accessTokenSecret, function (error, data, response) {
								if (error) {
									httpResponse.writeHead (500, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
									httpResponse.end (error.message);    
									}
								else {
									httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
									addOurDataToReturnObject (data);
									httpResponse.end (utils.jsonStringify (data));    
									}
								});
							break;
						case "/returnwhenready": //12/15/14 by DW -- long polling
							pushLongpoll (parsedUrl.query.url, httpResponse)
							break;
						case "/stats": //12/16/14 by DW
							httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
							httpResponse.end (utils.jsonStringify (serverStats));    
							break;
						case "/getfilelist": //12/21/14 by DW
							var accessToken = parsedUrl.query.oauth_token;
							var accessTokenSecret = parsedUrl.query.oauth_token_secret;
							var flprivate = utils.getBoolean (parsedUrl.query.flprivate);
							getScreenName (accessToken, accessTokenSecret, function (screenName) {
								if (screenName === undefined) {
									errorResponse ({message: "Can't get the file list because the accessToken is not valid."});    
									}
								else {
									var s3path = getS3UsersPath (flprivate) + screenName + "/";
									getUserFileList (s3path, function (error, theList) {
										if (error) {
											errorResponse (error);    
											}
										else {
											dataResponse (theList);
											}
										});
									}
								});
							break; 
						default: //404 not found
							httpResponse.writeHead (404, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
							httpResponse.end ("\"" + parsedUrl.pathname.toLowerCase () + "\" is not one of the endpoints defined by this server.");
						}
					break;
				}
			}
		else {
			httpResponse.writeHead (503, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
			httpResponse.end ("Can't process the request because the server is disabled.");    
			}
		}
	catch (tryError) {
		httpResponse.writeHead (500, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
		httpResponse.end (tryError.message);    
		}
	}

function startup () {
	console.log ();
	console.log (myProductName + " v" + myVersion + " running on port " + myPort + ".");
	console.log ();
	
	myDomain = process.env.myDomain; 
	if (myDomain == undefined) {
		console.log ("Can't start the server because the \"myDomain\" parameter is not specified.");
		}
	
	if (flEnabled === undefined) { //11/16/14 by DW
		flEnabled = true;
		}
	else {
		flEnabled = utils.getBoolean (flEnabled);
		}
	
	loadServerStats (function () {
		loadServerPrefs (function () {
			readUserWhitelist (function () {
				http.createServer (handleHttpRequest).listen (myPort);
				
				setInterval (everySecond, 1000); 
				setInterval (everyMinute, 60000); 
				});
			});
		});
	}
startup ();

