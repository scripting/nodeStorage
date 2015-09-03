/* The MIT License (MIT)
	
	Copyright (c) 2014-2015 Dave Winer
	
	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:
	
	The above copyright notice and this permission notice shall be included in all
	copies or substantial portions of the Software.
	
	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
	SOFTWARE.
	
	structured listing: http://scripting.com/listings/storage.html
	*/

var myVersion = "0.78s", myProductName = "nodeStorage"; 

var http = require ("http"); 
var urlpack = require ("url");
var twitterAPI = require ("node-twitter-api");
var fs = require ("fs");
var request = require ("request");
var querystring = require ("querystring"); //8/31/15 by DW
var s3 = require ("./lib/s3.js");
var store = require ("./lib/store.js"); //7/28/15 by DW
var utils = require ("./lib/utils.js");
var names = require ("./lib/names.js");
var dns = require ("dns");
var os = require ("os");

//environment variables
	var myPort = process.env.PORT;
	var flEnabled = process.env.enabled; 
	var s3Path = process.env.s3Path; //where we store publicly accessible data, user files, logs
	var s3PrivatePath = process.env.s3PrivatePath; //where we store private stuff, user's prefs for example
	var myDomain = process.env.myDomain; 
	var twitterConsumerKey = process.env.twitterConsumerKey;  //5/8/15 by DW
	var twitterConsumerSecret = process.env.twitterConsumerSecret; //5/8/15 by DW
	var myDomain = process.env.myDomain;  //5/8/15 by DW
	
	var urlWhitelist = process.env.urlUserWhitelist; //5/8/15 by DW
	var bitlyApiKey = process.env.bitlyApiKey;
	var bitlyApiUsername = process.env.bitlyApiUsername;
	var longPollTimeoutSecs = process.env.longPollTimeoutSecs; 
	var flLocalFilesystem = false; //7/28/15 DW
	var basePublicUrl = undefined; //7/29/15 by DW

var fnameConfig = "config.json"; //config, another way of setting environment variables -- 5/8/15 by DW

var serverStats = {
	today: new Date (),
	ctStatsSaves: 0,
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
	currentLogPolls: new Array (), //1/29/15 by DW
	ctChatPosts: 0, //8/25/15 by DW
	ctChatPostsToday: 0, //8/29/15 by DW
	whenLastChatPost: new Date (0), //8/25/15 by DW
	recentTweets: []
	};
var fnameStats = "data/serverStats.json", flStatsDirty = false, maxrecentTweets = 500; 


var serverPrefs = {
	flArchiveTweets: true
	};
var fnamePrefs = "data/serverPrefs.json";
var fnameTweetsFolder = "data/tweets/";
var userDomain = undefined; //7/13/15 by DW

var requestTokens = []; //used in the OAuth dance
var screenNameCache = []; 

var flWatchAppDateChange = false, fnameApp = "storage.js", origAppModDate; //8/26/15 by DW -- can only be sent through config.json
var domainIncomingWebhook; //8/28/15 by DW
var usersWhoCanCreateWebhooks; //8/30/15 by DW -- if it's undefined, anyone can
var flScheduledEveryMinute = false; //9/2/15 by DW

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
	var userWhitelist = [];
	
	function readUserWhitelist (callback) {
		if ((urlWhitelist !== undefined) && (urlWhitelist.length > 0)) {
			httpReadUrl (urlWhitelist, function (s) {
				try {
					userWhitelist = JSON.parse (s);
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
		if ((urlWhitelist == undefined) || (urlWhitelist.length == 0)) { //no whitelist, everyone is whitelisted
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
			return (60000); //60 seconds
			}
		else {
			return (Number (longPollTimeoutSecs) * 1000.0);
			}
		}
	function pushLongpoll (urlToWatchFor, httpResponse, clientIpAddress) {
		var ctMilliseconds = getLongpollTimeout ();
		var whenExpires = new Date (Number (new Date ()) + ctMilliseconds);
		waitingLongpolls [waitingLongpolls.length] = {
			url: urlToWatchFor,
			whenTimeout: whenExpires,
			client: clientIpAddress,
			response: httpResponse
			}
		serverStats.ctLongPollPushes++; 
		serverStats.ctLongPollsToday++;
		flStatsDirty = true;
		}
	function checkLongpolls () { //expire timed-out longpolls
		var now = new Date ();
		for (var i = waitingLongpolls.length - 1; i >= 0; i--) {
			var obj = waitingLongpolls [i];
			if (now >= obj.whenTimeout) {
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
		store.getObject (s3Path + fname, function (error, data) {
			if (!error) {
				if (data != null) {
					var oldStruct = JSON.parse (data.Body);
					for (var x in oldStruct) { 
						struct [x] = oldStruct [x];
						}
					}
				}
			if (callback != undefined) {
				callback ();
				}
			});
		}
	function saveStruct (fname, struct, callback) {
		store.newObject (s3Path + fname, utils.jsonStringify (struct), "application/json", undefined, function () {
			if (callback !== undefined) {
				callback ();
				}
			});
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
		serverStats.ctStatsSaves++; //1/30/15 by DW
		serverStats.ctHoursServerUp = utils.secondsSince (serverStats.whenServerStart) / 3600; //4/28/14 by DW
		serverStats.ctCurrentLongPolls = waitingLongpolls.length; //12/16/14 by DW
		
		//add info about current longPolls -- 1/29/15 by DW
			serverStats.currentLogPolls = new Array ();
			for (var i = 0; i < waitingLongpolls.length; i++) {
				var obj = waitingLongpolls [i];
				serverStats.currentLogPolls [i] = {
					url: obj.url,
					client: obj.client
					};
				}
		
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
//chat -- 8/25/15 by DW
	var flChatEnabled = false;
	var fnameChatLog = "data/chatLog.json";
	var chatLog = new Array (), maxChatLog = 250;
	var todaysChatLog = {
		today: new Date (0),
		theLog: new Array ()
		};
	var flChatLogDirty = false;
	
	function postChatMessage (screenName, chatText, iconUrl, iconEmoji, flTwitterName, callback) {
		var now = new Date (), idChatPost;
		if (chatLog.length >= maxChatLog) {
			chatLog.splice (0, 1); //remove first item
			}
		var chatItem = {
			name: screenName,
			text: chatText,
			id: serverStats.ctChatPosts++,
			when: now
			};
		if (iconUrl !== undefined) {
			chatItem.iconUrl = iconUrl;
			}
		if (iconEmoji !== undefined) {
			chatItem.iconEmoji = iconEmoji;
			}
		if (!flTwitterName) {
			chatItem.flNotTwitterName = !flTwitterName; //the "name" field of struct is not a twitter screen name
			}
		chatLog [chatLog.length] = chatItem;
		callback (chatItem.id); //pass it the id of the new post
		serverStats.whenLastChatPost = now;
		if (!utils.sameDay (todaysChatLog.today, now)) { //date rollover
			todaysChatLog.today = now;
			todaysChatLog.theLog = new Array ();
			serverStats.ctChatPostsToday = 0;
			}
		todaysChatLog.theLog [todaysChatLog.theLog.length] = chatItem;
		serverStats.ctChatPostsToday++;
		flStatsDirty = true;
		flChatLogDirty = true;
		
		checkLongpollsForUrl ("chatlog", utils.jsonStringify (chatLog)); //anyone who's waiting for "chatlog" to update will be notified now
		
		outgoingWebhookCall (screenName, chatText, chatItem.id, iconUrl, iconEmoji, flTwitterName);
		}
	function saveChatLog (callback) {
		flChatLogDirty = false;
		saveStruct (fnameChatLog, chatLog, function () {
			var f = "data/" + utils.getDatePath () + "todaysChatlog.json";
			saveStruct (f, todaysChatLog, function () {
				});
			});
		}
	function loadChatLog (callback) {
		if (flChatEnabled) {
			loadStruct (fnameChatLog, chatLog, function () {
				var f = "data/" + utils.getDatePath () + "todaysChatlog.json";
				loadStruct (f, todaysChatLog, function () {
					callback ();
					});
				});
			}
		else {
			callback ();
			}
		}
//webhooks -- 8/28/15 by DW
	var webhooks = {
		incoming: {}, 
		outgoing: {}
		};
	var flWebhooksDirty = false, fnameWebhooks = "data/hooks.json";
	var webhookNotEnabledError = "Can't create the webhook because the feature is not enabled on the server, or you are not authorized to create one."; //8/31/15 by DW
	var webhookAccessTokenError = "Can't create a new webhook because the accessToken is not valid."; //8/31/15 by DW
	var nameWebhookDefaultChannel = "default"; //we only have one channel, this is its name, can be overridden with a config.json setting -- 9/3/15 by DW
	
	function loadWebhooks (callback) {
		store.getObject (s3PrivatePath + fnameWebhooks, function (error, data) {
			if ((!error) && (data != null)) {
				webhooks = JSON.parse (data.Body);
				console.log ("loadWebhooks: webhooks == " + utils.jsonStringify (webhooks));
				}
			callback ();
			});
		}
	function saveWebhooks () {
		flWebhooksDirty = false;
		store.newObject (s3PrivatePath + fnameWebhooks, utils.jsonStringify (webhooks));
		}
	function okToCreateHook (screenName) {
		if (usersWhoCanCreateWebhooks !== undefined) {
			for (var i = 0; i < usersWhoCanCreateWebhooks.length; i++) {
				if (usersWhoCanCreateWebhooks [i].toLowerCase () == screenName.toLowerCase ()) {
					return (true);
					}
				}
			}
		return (false);
		}
	function newIncomingHook (screenName, channel, description, customName, urlCustomIcon, customEmoji, callback) {
		var id, urlwebhook;
		if (channel == undefined) {
			channel = nameWebhookDefaultChannel;
			}
		if (description == undefined) {
			description = "";
			}
		while (true) {
			id = utils.getRandomPassword (8);
			if (webhooks.incoming [id] == undefined) {
				var newHook = {
					name: screenName, //the user who created the hook
					channel: channel, //maybe someday we'll have more than one channel
					description: description,
					whenCreated: new Date (),
					ctCalls: 0, whenLastCall: new Date (0)
					};
				
				if (customName != undefined) {
					newHook.customName = customName;
					}
				if (urlCustomIcon != undefined) {
					newHook.urlCustomIcon = urlCustomIcon;
					}
				if (customEmoji != undefined) {
					newHook.customEmoji = customEmoji;
					}
				webhooks.incoming [id] = newHook;
				urlwebhook = "http://" + domainIncomingWebhook + "/" + id;
				callback (urlwebhook); 
				flWebhooksDirty = true;
				return;
				}
			}
		}
	function newOutgoingHook (screenName, channel, triggerWords, urlsToCall, description, customName, urlCustomIcon, customEmoji, callback) {
		var id, urlwebhook;
		if (channel == undefined) {
			channel = nameWebhookDefaultChannel;
			}
		if (description == undefined) {
			description = "";
			}
		console.log ("newOutgoingHook: params == " + screenName + ", " +  channel + ", " +  triggerWords + ", " +  urlsToCall + ", " +  description + ", " +  customName + ", " +  urlCustomIcon + ", " +  customEmoji);
		while (true) {
			id = utils.getRandomPassword (24);
			if (webhooks.incoming [id] === undefined) {
				var newHook = {
					name: screenName, //the user who created the hook
					channel: channel, //maybe someday we'll have more than one channel
					description: description,
					token: id,
					whenCreated: new Date (),
					ctCalls: 0, whenLastCall: new Date (0)
					};
				
				if (triggerWords !== undefined) {
					newHook.triggerWords = triggerWords;
					}
				if (urlsToCall !== undefined) {
					newHook.urlsToCall = urlsToCall;
					}
				if (customName !== undefined) {
					newHook.customName = customName;
					}
				if (urlCustomIcon !== undefined) {
					newHook.urlCustomIcon = urlCustomIcon;
					}
				if (customEmoji !== undefined) {
					newHook.customEmoji = customEmoji;
					}
				console.log ("newOutgoingHook: newHook == " + utils.jsonStringify (newHook));
				webhooks.outgoing [id] = newHook;
				callback (id); 
				flWebhooksDirty = true;
				return;
				}
			}
		}
	function incomingWebhookCall (host, lowerpath, payload, callback) {
		var now = new Date ();
		function slackProcessText (s) {
			function processPart (s) {
				var parts = s.split ("|");
				if (parts.length == 2) {
					return ("<a href=\"" + parts [0] + "\">" + parts [1] + "</a>");
					}
				return ("<a href=\"" + s + "\">" + s + "</a>");
				}
			var outputstring = "";
			while (s.length > 0) {
				var ch = s [0];
				if (ch == "<") {
					var ix = s.indexOf (">");
					if (ix >= 0) { 
						var part = s.slice (1, ix);
						s = s.substr (ix + 1); //pop off the text betw angle brackets, including the angle brackets
						outputstring += processPart (part);
						}
					}
				else {
					s = s.substr (1); //pop off first character
					outputstring += ch;
					}
				}
			return (outputstring);
			}
		if (domainIncomingWebhook == undefined) {
			callback (false); //we don't consume the call
			}
		else {
			if (host == domainIncomingWebhook) {
				var key = utils.stringDelete (lowerpath, 1, 1); //pop off leading slash
				var theHook = webhooks.incoming [key];
				if (theHook == undefined) {
					callback (true, 404, "text/plain", "Can't call the web hook because it has not been defined.");
					}
				else {
					var jstruct;
					try {jstruct = JSON.parse (payload);}
						catch (err) {
							callback (true, 400, "text/plain", "Can't call the web hook because the payload is not correctly formatted JSON.");
							return;
							}
					if (jstruct.text != undefined) {
						var screenName = "incoming-webhook-bot", iconUrl = undefined, iconEmoji = undefined, flTwitterName = true;
						
						theHook.ctCalls++;
						theHook.whenLastCall = now;
						flWebhooksDirty = true;
						
						//first, apply the defaults for the hook
							if (theHook.customName !== undefined) {
								screenName = theHook.customName;
								flTwitterName = false;
								}
							if (theHook.urlCustomIcon !== undefined) {
								iconUrl = theHook.urlCustomIcon;
								}
							if (theHook.customEmoji !== undefined) {
								iconEmoji = theHook.customEmoji;
								}
						//second, apply the values sent with the message (they override the other values
							if (jstruct.username != undefined) {
								screenName = jstruct.username;
								flTwitterName = false;
								}
							if (jstruct.icon_url != undefined) {
								iconUrl = jstruct.icon_url;
								}
							if (jstruct.icon_emoji != undefined) {
								iconEmoji = jstruct.icon_emoji;
								}
						
						postChatMessage (screenName, slackProcessText (jstruct.text),  iconUrl, iconEmoji, flTwitterName, function (id) {
							callback (true, 200, "text/plain", "We love you Burt!");
							});
						}
					else {
						callback (true, 400, "text/plain", "Can't call the web hook because there is no \"text\" object in the payload struct.");
						}
					}
				}
			else {
				callback (false); //we don't consume the call
				}
			}
		}
	function outgoingWebhookCall (screenName, chatText, idMessage, iconUrl, iconEmoji, flTwitterName, webhookCallback) {
		var callArray = [];
		var outgoingData = {
			token: undefined,
			team_id: 0,
			team_domain: "",
			channel_id: "",
			channel_name: nameWebhookDefaultChannel, 
			timestamp: Number (new Date ()) + "." + idMessage,
			user_id: screenName,
			user_name: screenName,
			text: chatText,
			trigger_word: ""
			};
		function buildCallArray (chatText) {
			var lowerChatText = chatText.toLowerCase ();
			for (var x in webhooks.outgoing) {
				var theHook = webhooks.outgoing [x];
				var urls = theHook.urlsToCall, parts = urls.split ("\n");
				var triggers = theHook.triggerWords, flTriggered = false;
				if ((triggers !== undefined) && (triggers.length > 0)) {
					var wordsList = triggers.split (",");
					for (var ixlist = 0; ixlist < wordsList.length; ixlist++) {
						var thisWord = utils.trimWhitespace (wordsList [ixlist]).toLowerCase ();
						if (utils.beginsWith (lowerChatText, thisWord)) {
							flTriggered = true;
							break;
							}
						else {
							}
						}
					}
				else {
					flTriggered = true; //no trigger words
					}
				if (flTriggered) {
					for (var i = 0; i < parts.length; i++) {
						callArray [callArray.length] = {
							url: parts [i],
							token: x,
							hook: theHook
							};
						}
					}
				}
			}
		function callNextHook (ix) {
			if (ix < callArray.length) {
				var theCall = callArray [ix];
				outgoingData.token = theCall.token;
				var rq = {
					uri: theCall.url,
					body: querystring.stringify (outgoingData)
					};
				request.post (rq, function (err, res, body) {
					console.log ("callNextHook: token == " + outgoingData.token + ", res.statusCode == " + res.statusCode);
					theCall.hook.ctCalls++;
					theCall.hook.whenLastCall = new Date ();
					flWebhooksDirty = true;
					callNextHook (ix + 1);
					});
				}
			else {
				if (webhookCallback !== undefined) {
					webhookCallback ();
					}
				}
			}
		buildCallArray (chatText);
		callNextHook (0);
		}

function newTwitter (myCallback) {
	var twitter = new twitterAPI ({
		consumerKey: twitterConsumerKey,
		consumerSecret: twitterConsumerSecret,
		callback: myCallback
		});
	return (twitter);
	}
function kilobyteString (num) { //1/24/15 by DW
	num = Number (num) / 1024;
	return (num.toFixed (2) + "K");
	}
function megabyteString (num) { //1/24/15 by DW
	var onemeg = 1024 * 1024;
	if (num <= onemeg) {
		return (kilobyteString (num));
		}
	num = Number (num) / onemeg;
	return (num.toFixed (2) + "MB");
	}
function gigabyteString (num) { //1/24/15 by DW
	var onegig = 1024 * 1024 * 1024;
	if (num <= onegig) {
		return (megabyteString (num));
		}
	num = Number (num) / onegig;
	return (num.toFixed (2) + "GB");
	}
function getScreenName (accessToken, accessTokenSecret, callback, flNotWhitelisted) { //7/9/14 by DW
	function checkWhitelist (name) { //2/23/15 by DW
		if (flNotWhitelisted) {
			return (true);
			}
		else {
			return (isWhitelistedUser (name));
			}
		}
	//see if we can get it from the cache first
		for (var i = 0; i < screenNameCache.length; i++) {
			var obj = screenNameCache [i];
			if ((obj.accessToken == accessToken) && (obj.accessTokenSecret == accessTokenSecret)) {
				obj.ctAccesses++;
				
				if (checkWhitelist (obj.screenName)) { //11/18/14 by DW
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
				if (checkWhitelist (data.screen_name)) { //11/18/14 by DW
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
				store.newObject (filepath, utils.jsonStringify (theTweet));
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
	store.listObjects (s3path, function (obj) {
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
function addComment (snCommenter, snAuthor, idPost, urlOpmlFile, callback) { //2/21/15 by DW
	var s3path = s3PrivatePath + "users/" + snAuthor + "/comments/" + idPost + ".json", now = new Date (), flprivate = true;
	store.getObject (s3path, function (error, data) {
		var jstruct, flnew = true, jstructsub;
		if (error) {
			jstruct = new Array ();
			}
		else {
			jstruct = JSON.parse (data.Body.toString ());
			}
		
		for (var i = 0; i < jstruct.length; i++) {
			if (jstruct [i].commenter == snCommenter) {
				flnew = false;
				jstructsub = jstruct [i];
				break;
				}
			}
		if (flnew) {
			var ixnew = jstruct.length;
			jstruct [ixnew] = {
				commenter: snCommenter,
				ctUpdates: 0,
				whenCreated: now,
				whenUpdated: now
				};
			jstructsub = jstruct [ixnew];
			}
		
		
		jstructsub.whenUpdated = now;
		jstructsub.ctUpdates++;
		jstructsub.urlOpmlFile = urlOpmlFile;
		
		
		store.newObject (s3path, utils.jsonStringify (jstruct), "application/json", getS3Acl (flprivate), function (error, data) {
			if (error) {
				if (callback != undefined) {
					callback (error, undefined);
					}
				}
			else {
				var returnStruct = {
					filepath: s3path,
					whenCreated: jstructsub.whenCreated,
					whenUpdated: jstructsub.whenUpdated,
					ctUpdates: jstructsub.ctUpdates
					};
				if (callback != undefined) {
					callback (undefined, returnStruct);
					}
				}
			});
		});
	}
function getComments (snAuthor, idPost, callback) {
	var s3path = s3PrivatePath + "users/" + snAuthor + "/comments/" + idPost + ".json";
	store.getObject (s3path, function (error, data) {
		if (error) {
			if (callback != undefined) {
				callback (error, undefined);
				}
			}
		else {
			var jstruct = JSON.parse (data.Body.toString ());
			if (callback != undefined) {
				callback (undefined, jstruct);
				}
			}
		});
	}
function getUserCommentsOpml (s3path, callback) {
	var opmltext = "", indentlevel = 0;
	function add (s) {
		opmltext += utils.filledString ("\t", indentlevel) + s + "\r\n";
		}
	add ("<?xml version=\"1.0\"?>");
	add ("<opml version=\"2.0\">"); indentlevel++;
	//add head
		add ("<head>"); indentlevel++;
		add ("<title>Comments</title>");
		add ("</head>"); indentlevel--;
	add ("<body>"); indentlevel++;
	store.listObjects (s3path, function (obj) { 
		if (obj.flLastObject != undefined) {
			add ("</body>"); indentlevel--;
			add ("</opml>"); indentlevel--;
			if (callback != undefined) {
				callback (opmltext);
				}
			}
		else {
			if (obj.Size > 0) { //it's a file
				var filepath = obj.s3path;
				var url = "http://" + filepath;
				var fname = utils.stringNthField (filepath, "/", utils.stringCountFields (filepath, "/")); //something like 1424570840000.opml
				var numpart = utils.stringNthField (fname, ".", 1);
				var when = new Date (Number (numpart));
				add ("<outline text=\"" + when + "\" type=\"include\" url=\"" + url + "\" />");
				}
			}
		});
	}
function everyMinute () {
	var now = new Date ();
	console.log ("\neveryMinute: " + now.toLocaleTimeString () + ", v" + myVersion);
	readUserWhitelist (); //11/18/14 by DW
	}
function everySecond () {
	if (!flScheduledEveryMinute) { //9/2/15 by DW
		if (new Date ().getSeconds () == 0) {
			setInterval (everyMinute, 60000); 
			flScheduledEveryMinute = true;
			everyMinute (); //it's the top of the minute, we have to do one now
			}
		}
	checkLongpolls ();
	if (flStatsDirty) {
		saveServerStats ();
		}
	if (flChatLogDirty) { //8/25/15 by DW
		saveChatLog ();
		}
	if (flWatchAppDateChange) { //8/26/15 by DW
		utils.getFileModDate (fnameApp, function (theModDate) {
			if (theModDate != origAppModDate) {
				console.log ("everySecond: " + fnameApp + " has been updated. " + myProductName + " is quitting now.");
				process.exit (0);
				}
			});
		}
	if (flWebhooksDirty) {
		saveWebhooks ();
		}
	}
function handleHttpRequest (httpRequest, httpResponse) {
	try {
		var parsedUrl = urlpack.parse (httpRequest.url, true), now = new Date ();
		var startTime = now, flStatsSaved = false, host, lowerhost, port, referrer;
		var lowerpath = parsedUrl.pathname.toLowerCase (), clientIp = httpRequest.connection.remoteAddress;
		
		function doHttpReturn (code, type, s) { //8/28/15 by DW
			httpResponse.writeHead (code, {"Content-Type": type, "Access-Control-Allow-Origin": "*"});
			httpResponse.end (s);    
			}
		function addOurDataToReturnObject (returnObject) {
			return; //disabled -- 2/21/15 by DW
			
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
			dns.reverse (clientIp, function (err, domains) {
				var client = httpRequest.connection.remoteAddress;
				var freemem = gigabyteString (os.freemem ()); //1/24/15 by DW
				if (!err) {
					if (domains.length > 0) {
						client = domains [0];
						}
					}
				console.log (now.toLocaleTimeString () + " " + freemem + " " + httpRequest.method + " " + host + ":" + port + " " + lowerpath + " " + referrer + " " + client);
				});
		
		if (flEnabled) { 
			names.serveThroughName (host, port, httpRequest, userDomain, function (flMatch, code, contentType, data) {
				if (flMatch) {
					httpResponse.writeHead (code, {"Content-Type": contentType, "Access-Control-Allow-Origin": "*"});
					httpResponse.end (data);
					}
				else {
					switch (httpRequest.method) {
						case "POST":
							var body = "";
							httpRequest.on ("data", function (data) {
								body += data;
								});
							httpRequest.on ("end", function () {
								var payload = parsedUrl.query.payload;
								if (payload == undefined) {
									payload = body;
									}
								incomingWebhookCall (host, lowerpath, payload, function (flMatch, code, contentType, data) {
									if (flMatch) {
										doHttpReturn (code, contentType, data);
										}
									else {
										switch (parsedUrl.pathname.toLowerCase ()) {
											case "/statuswithmedia": //6/30/14 by DW -- used in Little Card Editor
												var params = {
													url: "https://api.twitter.com/1.1/statuses/update_with_media.json",
													oauth: {
														consumer_key: twitterConsumerKey,
														consumer_secret: twitterConsumerSecret,
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
												var flNotWhitelisted = utils.getBoolean (parsedUrl.query.flNotWhitelisted);
												getScreenName (accessToken, accessTokenSecret, function (screenName) {
													if (screenName === undefined) {
														errorResponse ({message: "Can't save the file because the accessToken is not valid."});    
														}
													else {
														var s3path = getS3UsersPath (flprivate) + screenName + "/" + relpath;
														var metadata = {whenLastUpdate: new Date ().toString ()};
														
														
														store.newObject (s3path, body, type, getS3Acl (flprivate), function (error, data) {
															if (error) {
																errorResponse (error);    
																}
															else {
																metadata.url = store.getUrl (s3path); //"http:/" + s3path;
																dataResponse (metadata);
																serverStats.ctFileSaves++;
																statsChanged ();
																if (!flprivate) { //12/15/14 by DW
																	checkLongpollsForUrl (metadata.url, body);
																	}
																}
															}, metadata);
														}
													}, flNotWhitelisted);
												break;
											case "/chat": //8/25/15 by DW
												if (flChatEnabled) {
													var accessToken = parsedUrl.query.oauth_token;
													var accessTokenSecret = parsedUrl.query.oauth_token_secret;
													var flNotWhitelisted = utils.getBoolean (parsedUrl.query.flNotWhitelisted);
													var chatText = parsedUrl.query.text;
													getScreenName (accessToken, accessTokenSecret, function (screenName) {
														if (screenName === undefined) {
															errorResponse ({message: "Can't post the chat message because the accessToken is not valid."});    
															}
														else {
															postChatMessage (screenName, chatText, undefined, undefined, true, function (idMessage) {
																dataResponse ({id: idMessage});
																});
															}
														}, flNotWhitelisted);
													}
												else {
													errorResponse ({message: "Can't post the chat message because the feature is not enabled on the server."});    
													}
												break;
											default: 
												httpResponse.writeHead (200, {"Content-Type": "text/html"});
												httpResponse.end ("post received, pathname == " + parsedUrl.pathname);
												break;
											}
										}
									});
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
										consumerKey: twitterConsumerKey,
										consumerSecret: twitterConsumerSecret,
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
										consumerKey: twitterConsumerKey,
										consumerSecret: twitterConsumerSecret,
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
									var flNotWhitelisted = utils.getBoolean (parsedUrl.query.flNotWhitelisted);
									getScreenName (accessToken, accessTokenSecret, function (screenName) {
										if (screenName === undefined) {
											errorResponse ({message: "Can't get the file because the accessToken is not valid."});    
											}
										else {
											var s3path = getS3UsersPath (flprivate) + screenName + "/" + relpath;
											store.getObject (s3path, function (error, data) {
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
										}, flNotWhitelisted);
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
											store.getObject (s3path + "postsData.json", function (error, data) {
												if (error) {
													errorResponse (error);    
													}
												else {
													var postsData = JSON.parse (data.Body.toString ());
													var lastpostnum = postsData.nextfilenum - 1;
													var postsArray = [], ct = 0;
													function getOnePost (postnum) {
														var filepath = s3path + "posts/" + utils.padWithZeros (postnum, 7) + ".json";
														
														
														store.getObject (filepath, function (error, data) {
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
									pushLongpoll (parsedUrl.query.url, httpResponse, clientIp)
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
													var returnedList = new Array (); //return a processed array -- 3/5/15 by DW
													for (var i = 0; i < theList.length; i++) {
														var obj = new Object (), s3obj = theList [i];
														//set obj.path -- start copying into the object path when we pass the user's screen name
															var splitlist = s3obj.Key.split ("/"), flcopy = false, objectpath = "";
															for (var j = 0; j < splitlist.length; j++) {
																if (flcopy) {
																	if (objectpath.length > 0) {
																		objectpath += "/";
																		}
																	objectpath += splitlist [j];
																	}
																else {
																	if (splitlist [j] == screenName) {
																		flcopy = true;
																		}
																	}
																}
															obj.path = objectpath;
														obj.whenLastChange = s3obj.LastModified;
														obj.ctChars = s3obj.Size;
														returnedList [i] = obj;
														}
													dataResponse (returnedList);
													}
												});
											}
										});
									break; 
								case "/api.js": //1/20/15 by DW
									httpResponse.writeHead (200, {"Content-Type": "application/javascript", "Access-Control-Allow-Origin": "*"});
									fs.readFile ("api.js", function (err, data) {
										if (err) {
											httpResponse.writeHead (500, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
											httpResponse.end (err.message);    
											}
										else {
											httpResponse.writeHead (200, {"Content-Type": "application/javascript", "Access-Control-Allow-Origin": "*"});
											httpResponse.end (data.toString ());    
											}
										});
									break;
								case "/addcomment": //2/21/15 by DW
									var accessToken = parsedUrl.query.oauth_token;
									var accessTokenSecret = parsedUrl.query.oauth_token_secret;
									var snAuthor = parsedUrl.query.author;
									var idPost = parsedUrl.query.idpost;
									var urlOpmlFile = parsedUrl.query.urlopmlfile;
									var flNotWhitelisted = true; //2/23/15 by DW
									getScreenName (accessToken, accessTokenSecret, function (snCommenter) {
										addComment (snCommenter, snAuthor, idPost, urlOpmlFile, function (error, jstruct) {
											if (jstruct !== undefined) {
												dataResponse (jstruct);
												}
											else {
												errorResponse (error);    
												}
											});
										}, flNotWhitelisted);
									break;
								case "/getcomments": //2/21/15 by DW
									var accessToken = parsedUrl.query.oauth_token;
									var accessTokenSecret = parsedUrl.query.oauth_token_secret;
									var snAuthor = parsedUrl.query.author;
									var idPost = parsedUrl.query.idpost;
									var flNotWhitelisted = true; //2/23/15 by DW
									getScreenName (accessToken, accessTokenSecret, function (snReader) {
										getComments (snAuthor, idPost, function (error, jstruct) {
											if (jstruct !== undefined) {
												dataResponse (jstruct);
												}
											else {
												console.log ("/getcomments: error == ", JSON.stringify (error, undefined, 4));
												if (error.statusCode == 404) {
													dataResponse (new Array ());
													}
												else {
													errorResponse (error);    
													}
												}
											});
										}, flNotWhitelisted);
									break;
								case "/opmlcomments": //2/23/15 by DW
									var username = parsedUrl.query.user, returnedstring = "";
									var s3path = "/liveblog.co/users/" + username + "/comments/";
									console.log ("/opmlcomments: s3path == " + s3path);
									getUserCommentsOpml (s3path, function (opmltext) {
										httpResponse.writeHead (200, {"Content-Type": "text/xml", "Access-Control-Allow-Origin": "*"});
										httpResponse.end (opmltext);    
										});
									
									
									
									
									
									break;
								case "/isnameavailable": //7/12/15 by DW
									names.isNameAvailable (parsedUrl.query.name, function (theName, flAvailable, msg) {
										var jstruct = {
											name: theName,
											flAvailable: flAvailable,
											msg: msg
											};
										httpResponse.writeHead (200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"});
										httpResponse.end (utils.jsonStringify (jstruct));
										});
									break;
								case "/newoutlinename": //7/12/15 by DW
									var accessToken = parsedUrl.query.oauth_token;
									var accessTokenSecret = parsedUrl.query.oauth_token_secret;
									getScreenName (accessToken, accessTokenSecret, function (screenName) {
										names.reserveName (parsedUrl.query.name, parsedUrl.query.url, screenName, function (theName, flNameWasCreated, msg) {
											var jstruct = {
												name: theName,
												flNameWasCreated: flNameWasCreated,
												msg: msg
												};
											httpResponse.writeHead (200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"});
											httpResponse.end (utils.jsonStringify (jstruct));
											});
										});
									break;
								case "/lookupname": //7/13/15 by DW
									names.lookupName (parsedUrl.query.name, function (data) {
										httpResponse.writeHead (200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"});
										httpResponse.end (utils.jsonStringify (data));
										});
									break;
								case "/chatlog": //8/26/15 by DW
									dataResponse (chatLog);
									break;
								
								case "/newincomingwebhook": //8/28/15 by DW
									var accessToken = parsedUrl.query.oauth_token;
									var accessTokenSecret = parsedUrl.query.oauth_token_secret;
									var channel = parsedUrl.query.channel;
									var description = parsedUrl.query.description;
									var customName = parsedUrl.query.customname;
									var urlCustomIcon = parsedUrl.query.urlcustomicon;
									var customEmoji = parsedUrl.query.customemoji;
									getScreenName (accessToken, accessTokenSecret, function (screenName) {
										if (screenName === undefined) {
											errorResponse ({message: webhookAccessTokenError});    
											}
										else {
											if ((flChatEnabled) && (domainIncomingWebhook !== undefined) && (okToCreateHook (screenName))) {
												newIncomingHook (screenName, channel, description, customName, urlCustomIcon, customEmoji, function (urlhook) {
													dataResponse (urlhook);
													});
												}
											else {
												errorResponse ({message: webhookNotEnabledError});    
												}
											}
										});
									break;
								case "/newoutgoingwebhook": //8/31/15 by DW
									var accessToken = parsedUrl.query.oauth_token;
									var accessTokenSecret = parsedUrl.query.oauth_token_secret;
									var channel = parsedUrl.query.channel;
									var triggerWords = parsedUrl.query.triggerwords;
									var urlsToCall = parsedUrl.query.urlstocall;
									var description = parsedUrl.query.description;
									var customName = parsedUrl.query.customname;
									var urlCustomIcon = parsedUrl.query.urlcustomicon;
									var customEmoji = parsedUrl.query.customemoji;
									getScreenName (accessToken, accessTokenSecret, function (screenName) {
										if (screenName === undefined) {
											errorResponse ({message: webhookAccessTokenError});    
											}
										else {
											if ((flChatEnabled) && (okToCreateHook (screenName))) {
												newOutgoingHook (screenName, channel, triggerWords, urlsToCall, description, customName, urlCustomIcon, customEmoji, function (token) {
													dataResponse (token);
													});
												}
											else {
												errorResponse ({message: webhookNotEnabledError});    
												}
											}
										});
									break;
								
								default: //try to serve the object from the store -- 7/28/15 by DW
									store.serveObject (lowerpath, function (code, headers, bodytext) { //7/28/15 by DW
										httpResponse.writeHead (code, headers);
										httpResponse.end (bodytext);
										});
									break;
								}
							break;
						}
					}
				});
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
function loadConfig (callback) { //5/8/15 by DW
	fs.readFile (fnameConfig, function (err, data) {
		if (!err) {
			var config = JSON.parse (data.toString ());
			console.log ("\n\nloadConfig: config == " + JSON.stringify (config, undefined, 4) + "\n\n"); //5/20/15 by DW
			if (config.enabled !== undefined) {
				flEnabled = utils.getBoolean (config.enabled);
				}
			if (config.myDomain !== undefined) {
				myDomain = config.myDomain;
				}
			if (config.s3Path !== undefined) {
				s3Path = config.s3Path;
				}
			if (config.s3PrivatePath !== undefined) {
				s3PrivatePath = config.s3PrivatePath;
				}
			if (config.twitterConsumerKey !== undefined) {
				twitterConsumerKey = config.twitterConsumerKey;
				}
			if (config.twitterConsumerSecret !== undefined) {
				twitterConsumerSecret = config.twitterConsumerSecret;
				}
			if (config.myPort !== undefined) {
				myPort = config.myPort;
				}
			if (config.urlUserWhitelist !== undefined) {
				urlWhitelist = config.urlUserWhitelist;
				}
			if (config.longPollTimeoutSecs !== undefined) {
				longPollTimeoutSecs = config.longPollTimeoutSecs;
				}
			if (config.bitlyApiKey !== undefined) {
				bitlyApiKey = config.bitlyApiKey;
				}
			if (config.bitlyApiUsername !== undefined) {
				bitlyApiUsername = config.bitlyApiUsername;
				}
			if (config.userDomain !== undefined) { //7/13/15 by DW
				userDomain = config.userDomain;
				}
			if (config.basePublicUrl !== undefined) { //7/29/15 by DW
				basePublicUrl = config.basePublicUrl;
				}
			if (config.where !== undefined) { //7/28/15 by DW
				if ((config.where.publicPath === undefined) || (config.where.privatePath === undefined)) {
					console.log ("Can't use config.where because config.where.publicPath and/or config.where.privatePath were not specified.");
					}
				else {
					flLocalFilesystem = utils.getBoolean (config.where.flUseLocalFilesystem);
					s3Path = config.where.publicPath;
					s3PrivatePath = config.where.privatePath;
					}
				}
			if (config.flChatEnabled !== undefined) { //8/25/15 by DW
				flChatEnabled = utils.getBoolean (config.flChatEnabled);
				}
			if (config.flWatchAppDateChange !== undefined) { //8/26/15 by DW
				flWatchAppDateChange = utils.getBoolean (config.flWatchAppDateChange);
				}
			if (config.fnameApp !== undefined) { //8/26/15 by DW
				fnameApp = config.fnameApp;
				}
			if (config.domainIncomingWebhook !== undefined) { //8/28/15 by DW
				domainIncomingWebhook = config.domainIncomingWebhook;
				}
			if (config.maxChatLog !== undefined) { //8/29/15 by DW
				var theMax = Number (config.maxChatLog);
				if (theMax != NaN) {
					maxChatLog = theMac;
					}
				}
			if (config.usersWhoCanCreateWebhooks !== undefined) { //8/30/15 by DW
				usersWhoCanCreateWebhooks = config.usersWhoCanCreateWebhooks;
				}
			if (config.nameWebhookDefaultChannel !== undefined) { //9/3/15 by DW
				nameWebhookDefaultChannel = config.nameWebhookDefaultChannel;
				}
			
			store.init (flLocalFilesystem, s3Path, s3PrivatePath, basePublicUrl);
			}
		if (callback !== undefined) {
			callback ();
			}
		});
	}
function startup () {
	function notDefined (value, name) {
		if (value === undefined) {
			console.log ("Can't start the server because the \"" + name + "\" parameter is not specified.");
			return (true);
			}
		return (false);
		}
	loadConfig (function () {
		console.log ("\n" + myProductName + " v" + myVersion + " running on port " + myPort + ", freemem = " + gigabyteString (os.freemem ()) + ", urlWhitelist == " + urlWhitelist + "\n");
		
		if (notDefined (myDomain, "myDomain")) {
			return;
			}
		if (notDefined (s3Path, "s3Path")) {
			return;
			}
		if (notDefined (s3PrivatePath, "s3PrivatePath")) {
			return;
			}
		if (notDefined (twitterConsumerKey, "twitterConsumerKey")) {
			return;
			}
		if (notDefined (twitterConsumerSecret, "twitterConsumerSecret")) {
			return;
			}
		if (notDefined (myPort, "myPort")) {
			return;
			}
		
		if (flEnabled === undefined) { //11/16/14 by DW
			flEnabled = true;
			}
		else {
			flEnabled = utils.getBoolean (flEnabled);
			}
		
		//a little defensive driving -- 5/8/15; 6:16:09 PM by DW
			if (urlWhitelist !== undefined) {
				if (urlWhitelist.length == 0) { //yes, this happens
					urlWhitelist = undefined; 
					}
				}
		
		utils.getFileModDate (fnameApp, function (appModDate) { //set origAppModDate -- 8/26/15 by DW
			origAppModDate = appModDate;
			loadServerStats (function () {
				loadServerPrefs (function () {
					loadWebhooks (function () { //8/28/15M by DW
						loadChatLog (function () { //8/25/15 by DW
							readUserWhitelist (function () {
								
								names.init (s3PrivatePath); //7/12/15 by DW
								http.createServer (handleHttpRequest).listen (myPort);
								
								setInterval (everySecond, 1000); 
								});
							});
						});
					});
				});
			});
		});
	}
startup ();

