/* The MIT License (MIT)
	
	Copyright (c) 2014-2016 Dave Winer
	
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

var myVersion = "0.95b", myProductName = "nodeStorage"; 

var http = require ("http"); 
var urlpack = require ("url");
var twitterAPI = require ("node-twitter-api");
var websocket = require ("nodejs-websocket"); //11/11/15 by DW
var fs = require ("fs");
var request = require ("request");
var querystring = require ("querystring"); //8/31/15 by DW
var s3 = require ("./lib/s3.js");
var store = require ("./lib/store.js"); //7/28/15 by DW
var utils = require ("./lib/utils.js");
var names = require ("./lib/names.js");
var rss = require ("./lib/rss.js");
var callbacks = require ("./lib/callbacks.js");
var update = require ("./lib/update.js");
var dns = require ("dns");
var os = require ("os");
var qs = require ("querystring"); //4/28/16 by DW

//environment variables
	var myPort = process.env.PORT;
	var flEnabled = process.env.enabled; 
	var s3Path = process.env.s3Path; //where we store publicly accessible data, user files, logs
	var s3PrivatePath = process.env.s3PrivatePath; //where we store private stuff, user's prefs for example
	var twitterConsumerKey = process.env.twitterConsumerKey;  //5/8/15 by DW
	var twitterConsumerSecret = process.env.twitterConsumerSecret; //5/8/15 by DW
	var myDomain = process.env.myDomain;  //5/8/15 by DW
	
	var urlWhitelist = process.env.urlUserWhitelist; //5/8/15 by DW
	var bitlyApiKey = process.env.bitlyApiKey;
	var bitlyApiUsername = process.env.bitlyApiUsername;
	var longPollTimeoutSecs = process.env.longPollTimeoutSecs; 
	var flLocalFilesystem = false; //7/28/15 DW
	var basePublicUrl = undefined; //7/29/15 by DW
	var flForceTwitterLogin = false; //2/19/16 by DW

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
	
	chatLogStats: { //1/20/16 by DW
		logStats: new Object () //one for each chatlog
		},
	
	
	recentTweets: []
	};
var fnameStats = "data/serverStats.json", flStatsDirty = false, maxrecentTweets = 500; 
var s3RssPath = "rss.xml"; //10/6/15 by DW


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
var usersWhoCanCreateWebhooks; //8/30/15 by DW -- if it's undefined, no one can
var usersWhoCanModerate; //11/30/15 by DW -- if it's undefined, no one can
var flScheduledEveryMinute = false; //9/2/15 by DW
var urlPublicFolder; //10/6/15 by DW
var urlHomePageContent = "http://1999.io/dev/index.html"; //10/11/15 by DW -- what we serve when a request comes in for /
var websocketPort; //11/11/15 by DW
var homePageConfig = { //3/21/16 by DW
	};
var urlFavicon = "http://1999.io/favicon.ico"; //3/26/16 by DW
var indexFileName = "index.html"; //3/27/16 by DW
var theEditors = { //4/29/16 by DW
	};
var thePlugIns = { //5/14/16 by DW
	};
var theDomainMap = { //5/27/16 by DW
	};
var facebookAppId = undefined; //5/2/16 by DW
var url404page = undefined; //6/25/16 by DW


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
	var userWhitelist = [], flWhitelist = false;
	
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
		if (flWhitelist) {
			username = utils.stringLower (username);
			for (var i = 0; i < userWhitelist.length; i++) {
				if (utils.stringLower (userWhitelist [i]) == username) {
					return (true);
					}
				}
			return (false);
			}
		else { //no whitelist, everyone is whitelisted
			return (true);
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
		checkWebSocketCalls (); //11/11/15 by DW
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
		checkWebSocketCallsForUrl (url, filetext); //11/11/15 by DW
		}
	
	
//websockets rewrite -- 11/29/15 by DW
	var theWsServer;
	
	function checkWebSocketCalls () { //expire timed-out calls
		}
	function checkWebSocketCallsForUrl (url, filetext) { 
		if (theWsServer !== undefined) {
			var ctUpdates = 0;
			for (var i = 0; i < theWsServer.connections.length; i++) {
				var conn = theWsServer.connections [i];
				if (conn.chatLogData !== undefined) { //it's one of ours
					if (conn.chatLogData.urlToWatch !== undefined) { //we're watching a url
						if (conn.chatLogData.urlToWatch == url) { //it's our url
							try {
								conn.sendText ("update\r" + filetext);
								ctUpdates++;
								}
							catch (err) {
								}
							}
						}
					}
				}
			if (ctUpdates > 0) {
				console.log ("checkWebSocketCallsForUrl: " + ctUpdates + " sockets were updated.");
				}
			}
		}
	function handleWebSocketConnection (conn) { 
		var now = new Date ();
		
		function logToConsole (conn, verb, value) {
			getDomainName (conn.socket.remoteAddress, function (theName) { //log the request
				var freemem = gigabyteString (os.freemem ()), method = "WS:" + verb, now = new Date (); 
				if (theName === undefined) {
					theName = conn.socket.remoteAddress;
					}
				console.log (now.toLocaleTimeString () + " " + freemem + " " + method + " " + value + " " + theName);
				conn.chatLogData.domain = theName; 
				});
			}
		
		conn.chatLogData = {
			whenStarted: now
			};
		conn.on ("text", function (s) {
			var words = s.split (" ");
			if (words.length > 1) { //new protocol as of 11/29/15 by DW
				conn.chatLogData.whenLastUpdate = now;
				conn.chatLogData.lastVerb = words [0];
				switch (words [0]) {
					case "watch":
						conn.chatLogData.urlToWatch = utils.trimWhitespace (words [1]);
						logToConsole (conn, conn.chatLogData.lastVerb, conn.chatLogData.urlToWatch);
						break;
					}
				}
			else {
				conn.close ();
				}
			});
		conn.on ("close", function () {
			});
		conn.on ("error", function (err) {
			});
		}
	function webSocketStartup (thePort) {
		try {
			theWsServer = websocket.createServer (handleWebSocketConnection);
			theWsServer.listen (thePort);
			}
		catch (err) {
			console.log ("webSocketStartup: err.message == " + err.message);
			}
		}
	function countOpenSockets () {
		if (theWsServer === undefined) { //12/18/15 by DW
			return (0);
			}
		else {
			return (theWsServer.connections.length);
			}
		}
	function getOpenSocketsArray () { //return an array with data about open sockets
		var theArray = new Array ();
		for (var i = 0; i < theWsServer.connections.length; i++) {
			var conn = theWsServer.connections [i];
			if (conn.chatLogData !== undefined) { //it's one of ours
				theArray [theArray.length] = {
					arrayIndex: i,
					lastVerb: conn.chatLogData.lastVerb,
					urlToWatch: conn.chatLogData.urlToWatch,
					domain: conn.chatLogData.domain,
					whenStarted: utils.viewDate (conn.chatLogData.whenStarted),
					whenLastUpdate: utils.viewDate (conn.chatLogData.whenLastUpdate)
					};
				}
			}
		return (theArray);
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
					try {
						var oldStruct = JSON.parse (data.Body);
						for (var x in oldStruct) { 
							struct [x] = oldStruct [x];
							}
						}
					catch (err) {
						console.log ("loadStruct: error reading file \"" + fname + "\", err.message == " + err.message + "\n");
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
	var flChatEnabled = true; //default -- 3/26/16 by DW
	var chatRssHeadElements = { //10/6/15 by DW
		title: "nodeStorage chat feed",
		link: "http://nodestorage.io/",
		description: "A feed generated by the nodeStorage server app.",
		language: "en-us",
		generator: myProductName + " v" + myVersion,
		docs: "http://cyber.law.harvard.edu/rss/rss.html",
		maxFeedItems: 100,
		appDomain: "nodestorage.io"
		}
	var fnameChatLog = "data/chatLog.json", fnameChatLogPrefs = "data/chatLogPrefs.json";
	var chatNotEnabledError = "Can't post the chat message because the feature is not enabled on the server.";
	var maxChatLog = Infinity; //if you want to limit the amount of memory we use, make this smaller, like 250
	var maxLogLengthForClient = 50; //we won't return more than this number of log items to the client
	var flChatLogDirty = false, nameDirtyChatLog;
	var chatLogArray = new Array (); //10/26/15 by DW
	
	
	
	function initChatLogStats (name) { //1/20/16 by DW
		if (serverStats.chatLogStats.logStats [name] === undefined) {
			serverStats.chatLogStats.logStats [name] = {
				ctReads: 0, whenLastRead: new Date (0), 
				ctWrites: 0, whenLastWrite: new Date (0)
				};
			}
		return (serverStats.chatLogStats.logStats [name]);
		}
	function getAnyoneCanReply (theLog) {
		if (theLog.version == 2) {
			if (theLog.renderingPrefs !== undefined) { 
				if (theLog.renderingPrefs.flAnyoneCanReply !== undefined) { //owner has explicitly set it true or false
					return (utils.getBoolean (theLog.renderingPrefs.flAnyoneCanReply));
					}
				}
			return (true); //if not specified it's true in v2
			}
		else {
			return (utils.getBoolean (theLog.flAnyoneCanReply));
			}
		}
	function getChatLogSubset (log) { //1/19/16 by DW
		var flAnyoneCanReply = getAnyoneCanReply (log); //utils.getBoolean (log.flAnyoneCanReply) || (log.version == 2);
		var urlChatLogJson = (log.urlJsonFile !== undefined) ? log.urlJsonFile : log.urlPublicFolder + "chatLog.json"; //3/9/16 by DW
		function getIdLastPost () {
			if (log.chatLog.length == 0) {
				return (undefined);
				}
			else {
				return (log.chatLog [log.chatLog.length - 1].id);
				}
			}
		return ({
			prefs: log.prefs,
			usersWhoCanPost: log.usersWhoCanPost, 
			flAnyoneCanReply: flAnyoneCanReply, //11/20/15 by DW
			urlPublicFolder: log.urlPublicFolder,
			urlRssFeed: log.urlPublicFolder + s3RssPath, //11/22/15 by DW
			urlChatLogJson: urlChatLogJson, //3/9/16 by DW
			idLastPost: getIdLastPost () //3/14/16 by DW
			});
		}
	function getInitialChatLogStruct (nameChatLog) { //3/15/16 by DW
		var urlHome = urlPublicFolder + "users/" + nameChatLog + "/";
		var initialChatLogStruct = { //1/5/16 by DW
			chatLog: [],
			rssHeadElements: {
				"title": nameChatLog + "'s chatlog", //4/1/16 by DW
				"link": urlHome, //4/1/16 by DW
				"description": "",
				"language": "en-us",
				"generator": "1999.io",
				"docs": "http://cyber.law.harvard.edu/rss/rss.html",
				"maxFeedItems": 100,
				"appDomain": "domain.com",
				"flRssCloudEnabled": true,
				"rssCloudDomain": "rpc.rsscloud.io",
				"rssCloudPort": 5337,
				"rssCloudPath": "/pleaseNotify",
				"rssCloudRegisterProcedure": "",
				"rssCloudProtocol": "http-post",
				"flInstantArticlesSupport": true //4/6/16 by DW
				},
			renderingPrefs: { 
				siteName: nameChatLog,
				authorFacebookAccount: "",
				authorGithubAccount: "",
				authorLinkedInAccount: "",
				copyright: "",
				flAnyoneCanReply: true,
				urlBlogHome: urlHome //4/1/16 by DW
				},
			prefs: {
				serialNum: 1,
				whenLogPrefsCreated: new Date ()
				},
			version: 2, //the first version has no version element here
			flDirty: false
			}
		return (JSON.parse (JSON.stringify (initialChatLogStruct)));
		}
	function openUserChatlog (screenName, callback) { //1/5/16 by DW
		var theLog = findChatLog (screenName);
		if (theLog !== undefined) { //it's already open
			callback (getChatLogSubset (theLog));
			}
		else {
			var flprivate = false; //3/9/16 by DW
			var chatlogpath = getS3UsersPath (flprivate) + screenName + "/chatLog.json";
			var whenStartLoad = new Date ();
			store.getObject (chatlogpath, function (error, data) {
				var chatlogstruct = getInitialChatLogStruct (screenName);
				
				if ((!error) && (data != null)) {
					try {
						chatlogstruct = JSON.parse (data.Body);
						console.log ("openUserChatlog: chatlog for " + screenName + " has been opened."); 
						}
					catch (err) {
						console.log ("openUserChatlog: error opening chatlog for " + screenName + "."); 
						callback (undefined); //1/19/16 by DW
						}
					}
				else {
					console.log ("openUserChatlog: the chatlog for " + screenName + " does not exist."); 
					callback (undefined); //1/19/16 by DW
					}
				
				chatlogstruct.name = screenName;
				chatlogstruct.jsonPath = chatlogpath;
				
				chatlogstruct.s3Path = getS3UsersPath (false) + screenName + "/"; //where the chatlog's public files, such as the RSS feed, are stored
				
				if (urlPublicFolder !== undefined) { //2/19/16 by DW
					chatlogstruct.urlPublicFolder = urlPublicFolder + "users/" + screenName + "/";
					}
				if (chatlogstruct.usersWhoCanPost === undefined) { //3/3/16 by DW
					chatlogstruct.usersWhoCanPost = [screenName];
					}
				
				chatlogstruct.flDirty = false; //5/12/16 by DW -- prevent the RSS file from being rebuilt every time the file is opened
				
				chatLogArray [chatLogArray.length] = chatlogstruct;
				
				//stats -- 1/20/16 by DW
					var myStats = initChatLogStats (screenName);
					myStats.ctSecsLastRead = utils.secondsSince (whenStartLoad); //1/20/16 by DW
					myStats.ctReads++;
					myStats.whenLastRead = whenStartLoad;
					flStatsDirty = true;
					
					console.log ("openUserChatlog: screenName == " + screenName + ", stats == " + utils.jsonStringify (myStats));
				
				callback (getChatLogSubset (chatlogstruct));
				});
			}
		}
	function newUserChatlog (screenName, callback) { //3/15/16 by DW
		var jstruct = getInitialChatLogStruct (screenName); 
		jstruct.name = screenName;
		jstruct.jsonPath = getS3UsersPath (false) + screenName + "/chatLog.json";
		jstruct.s3Path = getS3UsersPath (false) + screenName + "/"; //where the chatlog's public files, such as the RSS feed, are stored
		if (urlPublicFolder !== undefined) { 
			jstruct.urlPublicFolder = urlPublicFolder + "users/" + screenName + "/";
			}
		jstruct.usersWhoCanPost = [screenName];
		chatLogArray [chatLogArray.length] = jstruct;
		callback (getChatLogSubset (jstruct));
		}
	function openAllUserChatlogs (callback) { //3/2/16 by DW
		function getUsersWhoHaveChatLogs (flprivate, callback) { //3/2/16 by DW 
			var theList = new Array (), usersPath = getS3UsersPath (flprivate);
			store.listObjects (usersPath, function (obj) { //loop over all the users' folders
				if (obj.flLastObject != undefined) {
					if (callback != undefined) {
						callback (theList);
						}
					}
				else {
					var path = obj.Key;
					if (utils.endsWith (path, "/chatLog.json")) {
						var username = utils.stringNthField (path, "/", utils.stringCountFields (path, "/") - 1);
						console.log ("openAllUserChatlogs: path == " + path + ", username == " + username);
						theList [theList.length] = username;
						}
					}
				});
			}
		if (flChatEnabled) {
			getUsersWhoHaveChatLogs (false, function (theList) {
				
				console.log ("openAllUserChatlogs: theList == " + utils.jsonStringify (theList));
				
				function openlog (ix) {
					if (ix >= theList.length) {
						if (callback !== undefined) {
							callback ();
							}
						}
					else {
						if ((theList [ix] === undefined) || (theList [ix].length === 0)) {
							openlog (ix + 1);
							}
						else {
							openUserChatlog (theList [ix], function () {
								openlog (ix + 1);
								});
							}
						}
					}
				openlog (0);
				});
			}
		else {
			if (callback !== undefined) {
				callback ();
				}
			}
		}
	function getChatLogList () { //10/29/15 by DW
		var jstruct = new Object ();
		for (var i = 0; i < chatLogArray.length; i++) {
			var log = chatLogArray [i];
			if (!log.prefs.flPrivate) {
				jstruct [log.name] = getChatLogSubset (log);
				}
			}
		return (jstruct);
		}
	function findChatLog (nameChatLog) {
		for (var i = 0; i < chatLogArray.length; i++) {
			var log = chatLogArray [i];
			if ((log.name == nameChatLog) || (log.owner == nameChatLog)) {
				return (log);
				}
			}
		return (undefined);
		}
	function chatLogChanged (nameChatLog) {
		flChatLogDirty = true;
		nameDirtyChatLog = nameChatLog;
		}
	function chatAnyoneCanReply (nameChatLog) { //11/21/15 by DW
		var theLog = findChatLog (nameChatLog);
		return (getAnyoneCanReply (theLog)); //3/1/16 by DW
		}
	function chatAnyoneCanLike (nameChatLog) { //4/10/16 by DW
		return (true); //Like is easy -- anyone can do it. maybe later we'll make this a setting -- 4/10/16 by DW
		}
	function bumpChatUpdateCount (item) { //10/18/15 by DW
		item.whenLastUpdate = new Date ();
		if (item.ctUpdates === undefined) { 
			item.ctUpdates = 1;
			}
		else {
			item.ctUpdates++;
			}
		}
	function getItemFile (item) { //10/5/15 by DW
		return (utils.getDatePath (item.when) + utils.padWithZeros (item.id, 4) + ".json");
		}
	function saveChatMessage (nameChatLog, item, callback) { 
		var theLog = findChatLog (nameChatLog), jsontext = utils.jsonStringify (item), relpath = getItemFile (item);
		var path = theLog.s3Path + relpath;
		store.newObject (path, jsontext, "application/json", undefined, function () {
			if (theLog.urlPublicFolder !== undefined) { //10/19/15 by DW
				if (item.urlJson === undefined) {
					item.urlJson = theLog.urlPublicFolder + getItemFile (item);
					saveChatMessage (nameChatLog, item, callback); //recurse, so the item gets saved again, this time with the urlJson element set -- 10/22/15 by DW
					chatLogChanged (nameChatLog);
					}
				else {
					if (callback !== undefined) {
						callback ();
						}
					}
				}
			else {
				if (callback !== undefined) {
					callback ();
					}
				}
			
			callbacks.callPublishCallbacks (relpath, jsontext, "application/json", nameChatLog); //4/17/16 by DW
			});
		}
	function findChatMessage (nameChatLog, id, callback) { //9/15/15 by DW
		var theLog = findChatLog (nameChatLog);
		var stack = [];
		function findInSubs (theArray) {
			for (var i = 0; i < theArray.length; i++) {
				var item = theArray [i];
				stack.push (item);
				if (item.id == id) {
					if (item.subs === undefined) {
						item.subs = new Array ();
						}
					callback (true, item, item.subs, stack [0]);
					return (true);
					}
				else {
					if (item.subs !== undefined) {
						if (findInSubs (item.subs, false)) {
							return (true);
							}
						}
					}
				stack.pop ();
				}
			return (false);
			}
		if (!findInSubs (theLog.chatLog)) {
			callback (false);
			}
		}
	function countItemsInChatlog (nameChatLog) { //10/28/15 by DW
		var theLog = findChatLog (nameChatLog);
		function countInArray (theArray) {
			if (theArray === undefined) {
				return (0);
				}
			else {
				var ct = 0;
				for (var i = 0; i < theArray.length; i++) {
					var item = theArray [i]
					ct += countInArray (item.subs) + 1;
					}
				return (ct);
				}
			}
		return (countInArray (theLog.chatLog));
		}
	function releaseChatLongpolls (nameChatLog, itemToReturn) { //anyone  waiting for "chatlog:xxx" to update will be notified 
		var flDeleteName = itemToReturn.chatLog === undefined;
		itemToReturn.chatLog = nameChatLog;
		jsontext = utils.jsonStringify (itemToReturn);
		delete itemToReturn.chatLog;
		checkLongpollsForUrl ("chatlog:" + nameChatLog, jsontext); 
		}
	function okToPostToChatLog (nameChatLog, screenName, flReply) { //10/29/15 by DW
		var theLog = findChatLog (nameChatLog), lowername = utils.stringLower (screenName);
		if (theLog.usersWhoCanPost !== undefined) {
			for (var i = 0; i < theLog.usersWhoCanPost.length; i++) {
				if (utils.stringLower (theLog.usersWhoCanPost [i]) == lowername) {
					return (true);
					}
				}
			}
		
		if (flReply && getAnyoneCanReply (theLog)) { //3/1/16 by DW
			return (true);
			}
		
		return (false);
		}
	function okToModerate (screenName) { //11/30/15 by DW
		if (usersWhoCanModerate !== undefined) {
			for (var i = 0; i < usersWhoCanModerate.length; i++) {
				if (usersWhoCanModerate [i].toLowerCase () == screenName.toLowerCase ()) {
					return (true);
					}
				}
			}
		return (false);
		}
	function okToEdit (item, screenName, nameChatLog) { //11/30/15 by DW
		if (utils.equalStrings (screenName, nameChatLog)) { //4/7/16 by DW
			return (true);
			}
		if (utils.equalStrings (item.name, screenName)) {
			return (true);
			}
		return (okToModerate (screenName));
		}
	function postChatMessage (screenName, nameChatLog, chatText, payload, idMsgReplyingTo, iconUrl, iconEmoji, flTwitterName, callback) {
		var flReply = idMsgReplyingTo !== undefined;
		
		if (okToPostToChatLog (nameChatLog, screenName, flReply)) {
			var theLog = findChatLog (nameChatLog);
			var now = new Date (), idChatPost, itemToReturn;
			
			var chatItem = {
				name: screenName,
				text: chatText,
				id: theLog.prefs.serialNum++,
				when: now
				};
			if (payload !== undefined) {
				try {
					chatItem.payload = JSON.parse (payload);
					}
				catch (err) {
					console.log ("postChatMessage: payload is not valid JSON == " + payload);
					callback (err, undefined);
					return;
					}
				}
			if (iconUrl !== undefined) {
				chatItem.iconUrl = iconUrl;
				}
			if (iconEmoji !== undefined) {
				chatItem.iconEmoji = iconEmoji;
				}
			if (!flTwitterName) {
				chatItem.flNotTwitterName = !flTwitterName; //the "name" field of struct is not a twitter screen name
				}
			
			if (flReply) {
				findChatMessage (nameChatLog, idMsgReplyingTo, function (flFound, item, subs, theTopItem) {
					if (flFound) {
						subs [subs.length] = chatItem;
						itemToReturn = theTopItem;
						itemToReturn.idLatestReply = chatItem.id; //9/22/15 by DW -- so the client can tell which reply is new
						console.log ("postChatMessage: itemToReturn == " + utils.jsonStringify (itemToReturn));
						}
					else {
						console.log ("postChatMessage: item to reply to not found.");
						callback ("Can't reply to the message because it isn't in the server chat log.", undefined);
						}
					});
				
				}
			else {
				if (theLog.chatLog.length >= maxChatLog) {
					theLog.chatLog.splice (0, 1); //remove first item
					}
				theLog.chatLog [theLog.chatLog.length] = chatItem;
				itemToReturn = chatItem;
				}
			
			callback (undefined, chatItem.id, itemToReturn); //pass it the id of the new post, and (11/26/15, the item we'll return via WebSockets)
			
			if (!utils.sameDay (serverStats.whenLastChatPost, now)) { 
				serverStats.ctChatPostsToday = 0;
				}
			serverStats.whenLastChatPost = now;
			serverStats.ctChatPostsToday++;
			flStatsDirty = true;
			
			
			chatLogChanged (nameChatLog);
			saveChatMessage (nameChatLog, itemToReturn, function () {
				releaseChatLongpolls (nameChatLog, itemToReturn); 
				if (itemToReturn.idLatestReply !== undefined) { //9/22/15 by DW
					delete itemToReturn.idLatestReply;
					}
				outgoingWebhookCall (screenName, chatText, chatItem.id, iconUrl, iconEmoji, flTwitterName);
				});
			}
		else {
			callback ("Can't post the message because the user \"" + screenName + "\" does not have permission.", undefined);
			}
		}
	function editChatMessage (screenName, nameChatLog, chatText, payload, idMessage, callback) { //9/11/15 by DW
		findChatMessage (nameChatLog, idMessage, function (flFound, item, subs, theTopItem) {
			if (flFound) {
				if (okToEdit (item, screenName, nameChatLog)) { //(item.name.toLowerCase () == screenName.toLowerCase ()) {
					item.text = chatText;
					if (payload !== undefined) {
						try {
							item.payload = JSON.parse (payload);
							}
						catch (err) {
							console.log ("editChatMessage: payload is not valid JSON == " + payload);
							callback (err, undefined);
							return;
							}
						}
					bumpChatUpdateCount (item); //10/18/15 by DW
					releaseChatLongpolls (nameChatLog, theTopItem); 
					saveChatMessage (nameChatLog, theTopItem); //10/8/15 by DW
					chatLogChanged (nameChatLog);
					callback (undefined, "We were able to update the post.", theTopItem);
					}
				else {
					callback ({message: "Can't update the post because \"" + screenName + "\" didn't create it."}); //4/7/16 by DW
					}
				}
			else {
				var theErrorString = "Can't update the post because an item with id == " + idMessage + " isn't in the server's chat log.";
				console.log ("editChatMessage: " + theErrorString);
				callback ({message: theErrorString});
				}
			});
		
		}
	function likeChatMessage (screenName, nameChatLog, idToLike, callback) { //9/27/15 by DW
		var now = new Date ();
		findChatMessage (nameChatLog, idToLike, function (flFound, item, subs, theTopItem) {
			if (flFound) {
				var fl = true;
				if (item.likes === undefined) {
					item.likes = new Object ();
					}
				if (item.likes [screenName] === undefined) {
					item.likes [screenName] = {
						when: now
						};
					}
				else {
					delete item.likes [screenName];
					fl = false;
					}
				bumpChatUpdateCount (item); //10/18/15 by DW
				chatLogChanged (nameChatLog);
				callback (fl); //return true if we liked, false if we unliked
				releaseChatLongpolls (nameChatLog, theTopItem); 
				saveChatMessage (nameChatLog, theTopItem); //10/8/15 by DW
				if (fl) { //only call callbacks on like, not unlike -- 4/24/16 by DW
					callbacks.callLikeCallbacks (screenName, nameChatLog, item); 
					}
				}
			else {
				console.log ("likeChatMessage: item to like to not found.");
				callback ("Can't like the post because an item with id == " + idToLike + " isn't in the server's chat log.");
				}
			});
		}
	function getMoreChatLogPosts (nameChatLog, idOldestPost, ctPosts) { //12/31/15 by DW
		var theLog = findChatLog (nameChatLog), jstruct = new Array (), ct = 0;
		if (theLog === undefined) {
			return (undefined);
			}
		for (var i = 0; i < theLog.chatLog.length; i++) {
			if (theLog.chatLog [i].id == idOldestPost) {
				for (j = i - 1; j >= 0; j--) {
					if (ct >= ctPosts) {
						break;
						}
					jstruct [jstruct.length] = theLog.chatLog [j];
					ct++;
					}
				return (jstruct);
				}
			}
		return (undefined); //didn't find the item
		}
	
	
	function getMonthChatLogPosts (nameChatLog, monthnum, yearnum) { //5/31/16 by DW
		var theLog = findChatLog (nameChatLog), jstruct = new Array ();
		if (theLog === undefined) {
			return (undefined);
			}
		
		var theMonth = new Date ();
		theMonth.setSeconds (0);
		theMonth.setMinutes (0);
		theMonth.setHours (0);
		theMonth.setDate (1);
		theMonth.setMonth (monthnum);
		theMonth.setFullYear (yearnum);
		
		for (var i = 0; i < theLog.chatLog.length; i++) {
			if (utils.sameMonth (new Date (theLog.chatLog [i].when), theMonth)) {
				jstruct [jstruct.length] = theLog.chatLog [i];
				}
			}
		
		return (jstruct);
		}
	
	
	function getChatLogIndex (nameChatLog) { //1/2/16 by DW
		var theLog = findChatLog (nameChatLog), jstruct = new Array (), ct = 0;
		if (theLog === undefined) {
			return (undefined);
			}
		for (var i = 0; i < theLog.chatLog.length; i++) {
			var item = theLog.chatLog [i], title = "", urlRendering = "", urlJson = "", flDeleted = undefined;
			if (item.payload !== undefined) {
				if (item.payload.title !== undefined) {
					title = item.payload.title;
					}
				if (item.payload.urlRendering !== undefined) {
					urlRendering = item.payload.urlRendering;
					}
				if (item.payload.flDeleted !== undefined) { //5/6/16 by DW
					flDeleted = utils.getBoolean (item.payload.flDeleted);
					}
				}
			if (item.urlJson !== undefined) {
				urlJson = item.urlJson;
				}
			jstruct [jstruct.length] = {
				id: item.id,
				name: item.name,
				when: item.when,
				title: title,
				flDeleted: flDeleted, //5/6/16 by DW
				urlHtml: urlRendering,
				urlJson: urlJson
				};
			}
		return (jstruct);
		}
	function writeIndividualFiles () { //10/5/15 by DW -- for possible future use
		var indentlevel = 0;
		function copyScalars (source, dest) { 
			for (var x in source) { 
				var type, val = source [x];
				if (val instanceof Date) { 
					val = val.toString ();
					}
				type = typeof (val);
				if ((type != "object") && (type != undefined)) {
					dest [x] = val;
					}
				}
			}
		function writefile (newitem) {
			var f = getItemFile (newitem);
			fs.writeFile (f, utils.jsonStringify (newitem), function (err) {
				if (err) {
					console.log ("writeIndividualFiles: error writing file == " + err.message + ", file == " + f);
					}
				});
			}
		function doArray (theArray) {
			var item, newitem;
			for (var i = 0; i < theArray.length; i++) {
				item = theArray [i];
				newitem = new Object ();
				copyScalars (item, newitem);
				if (item.subs !== undefined) {
					newitem.subs = new Array ();
					for (var j = 0; j < item.subs.length; j++) {
						newitem.subs [newitem.subs.length] = item.subs [j].id;
						}
					indentlevel++;
					doArray (item.subs);
					indentlevel--;
					}
				writefile (newitem);
				}
			}
		doArray (chatLog);
		}
	function buildChatLogRss (nameChatLog, callback) { //10/6/15 by DW
		var theLog = findChatLog (nameChatLog), headElements = new Object ();
		utils.copyScalars (theLog.rssHeadElements, headElements); //4/6/16 by DW
		if (utils.getBoolean (headElements.flInstantArticlesSupport)) { //3/4/16 by DW
			headElements.flUseContentEncoded = true;
			headElements.flTitledItemsOnly = true;
			headElements.flFacebookEncodeContent = true;
			}
		else { //4/6/16 by DW
			headElements.flUseContentEncoded = false;
			headElements.flTitledItemsOnly = false;
			headElements.flFacebookEncodeContent = false;
			}
		console.log ("buildChatLogRss: headElements == " + utils.jsonStringify (headElements));
		var xmltext = rss.chatLogToRss (headElements, theLog.chatLog);
		store.newObject (theLog.s3Path + s3RssPath, xmltext, "text/xml", undefined, function () {
			var urlFeed = undefined;
			if (theLog.urlPublicFolder !== undefined) {
				urlFeed = theLog.urlPublicFolder + s3RssPath;
				if (urlFeed != theLog.urlFeed) {
					theLog.urlFeed = urlFeed; 
					theLog.flDirty = true;
					}
				console.log ("buildChatLogRss: urlFeed == " + urlFeed); 
				}
			callbacks.callPublishCallbacks (s3RssPath, xmltext, "text/xml", nameChatLog); //3/23/16 by DW
			if (callback !== undefined) {
				callback (urlFeed);
				}
			});
		}
	function saveChatLog (nameChatLog, callback) {
		var theLog = findChatLog (nameChatLog), whenStartWrite = new Date ();
		function doStats () { //1/20/16 by DW
			var myStats = initChatLogStats (nameChatLog);
			myStats.ctSecsLastWrite = utils.secondsSince (whenStartWrite); 
			myStats.ctWrites++;
			myStats.whenLastWrite = whenStartWrite;
			flStatsDirty = true;
			}
		function buildRss () {
			buildChatLogRss (nameChatLog, function (urlFeed) {
				if (theLog.rssHeadElements.flRssCloudEnabled) {
					var domain = theLog.rssHeadElements.rssCloudDomain;
					var port = theLog.rssHeadElements.rssCloudPort;
					var path = theLog.rssHeadElements.rssCloudPath;
					var urlServer = "http://" + domain + ":" + port + path;
					rss.cloudPing (urlServer, urlFeed);
					if (callback !== undefined) {
						callback ();
						}
					}
				});
			}
		if (theLog.version == 2) {
			store.newObject (theLog.jsonPath, utils.jsonStringify (theLog), "application/json", undefined, function () {
				doStats ();
				buildRss ();
				});
			}
		else {
			var chatlogpath = theLog.s3Path + fnameChatLog, prefspath = theLog.s3Path + fnameChatLogPrefs;
			store.newObject (chatlogpath, utils.jsonStringify (theLog.chatLog), "application/json", undefined, function () {
				
				if (theLog.stats === undefined) { //3/9/16 by DW
					theLog.stats = {
						ctPrefsSaves: 0
						};
					}
				
				
				var prefsStruct = {
					prefs: theLog.prefs,
					usersWhoCanPost: theLog.usersWhoCanPost, 
					renderingPrefs: theLog.renderingPrefs,
					rssHeadElements: {
						title: theLog.rssHeadElements.title,
						link: theLog.rssHeadElements.link,
						description: theLog.rssHeadElements.description
						},
					stats: {
						ctPrefsSaves: ++theLog.stats.ctPrefsSaves,
						whenLastSave: new Date ().toLocaleString ()
						}
					};
				store.newObject (prefspath, utils.jsonStringify (prefsStruct), "application/json", undefined, function () {
					doStats ();
					buildRss ();
					});
				});
			}
		}
	function loadChatLogs (callback) { //load the version 1 chatlogs
		if (flChatEnabled) {
			function loadNextLog (ix) {
				if (ix == chatLogArray.length) {
					callback ();
					}
				else {
					var log = chatLogArray [ix], whenStartLoad = new Date ();
					log.flDirty = false;
					log.version = 1; //1/5/16 by DW
					var chatlogpath = log.s3Path + fnameChatLog;
					console.log ("loadChatLogs: path == " + chatlogpath);
					store.getObject (chatlogpath, function (error, data) {
						if ((!error) && (data != null)) {
							try {
								log.chatLog = JSON.parse (data.Body);
								}
							catch (err) {
								log.chatLog = [];
								}
							}
						var prefspath = log.s3Path + fnameChatLogPrefs;
						log.urlJsonFile = log.urlPublicFolder + fnameChatLog; //3/9/16 by DW
						store.getObject (prefspath, function (error, data) {
							if ((!error) && (data != null)) {
								
								var jstruct = JSON.parse (data.Body);
								if (jstruct.prefs !== undefined) {
									log.prefs = jstruct.prefs;
									log.usersWhoCanPost = jstruct.usersWhoCanPost;
									if (log.renderingPrefs === undefined) {
										log.renderingPrefs = new Object ();
										}
									if (jstruct.renderingPrefs !== undefined) {
										for (var x in jstruct.renderingPrefs) {
											log.renderingPrefs [x] = jstruct.renderingPrefs [x];
											}
										}
									if (jstruct.rssHeadElements !== undefined) {
										for (var x in jstruct.rssHeadElements) {
											log.rssHeadElements [x] = jstruct.rssHeadElements [x];
											}
										}
									
									if (jstruct.stats === undefined) {
										log.stats = {
											ctPrefsSaves: 0
											}
										}
									else {
										log.stats = jstruct.stats;
										}
									
									}
								else {
									log.prefs = jstruct;
									}
								}
							else {
								console.log ("loadChatLogs: creating new prefs file, prefspath == " + prefspath);
								log.prefs = {
									serialNum: countItemsInChatlog (log.name),
									whenLogPrefsCreated: new Date ()
									};
								log.flDirty = true;
								}
							
							//stats -- 1/20/16 by DW
								var myStats = initChatLogStats (log.name);
								myStats.ctSecsLastRead = utils.secondsSince (whenStartLoad); //1/20/16 by DW
								myStats.ctReads++;
								myStats.whenLastRead = whenStartLoad;
								flStatsDirty = true;
								
								console.log ("loadChatLogs: log.name == " + log.name + ", myStats == " + utils.jsonStringify (myStats));
							
							loadNextLog (ix + 1);
							});
						});
					}
				}
			loadNextLog (0);
			
			}
		else {
			callback ();
			}
		}
	function publishChatLogFileV1 (nameChatLog, screenName, relpath, type, body, callback) { //1/6/16 by DW
		var theLog = findChatLog (nameChatLog);
		var myRelpath = "users/" + screenName + "/" + relpath;
		var s3path = theLog.s3Path + myRelpath;
		var flprivate = false; //all our files are public
		var metadata = {whenLastUpdate: new Date ().toString ()};
		store.newObject (s3path, body, type, getS3Acl (false), function (error, data) {
			if (error) {
				callback (error);    
				}
			else {
				metadata.url = theLog.urlPublicFolder + myRelpath;
				callback (undefined, metadata);
				serverStats.ctFileSaves++;
				statsChanged ();
				if (!flprivate) { //12/15/14 by DW
					checkLongpollsForUrl (metadata.url, body);
					callbacks.callPublishCallbacks (relpath, body, type, nameChatLog); //10/14/15 by DW
					}
				}
			}, metadata);
		}
	function getChatlogForClient (nameChatLog) { //9/20/15 by DW
		function initRenderingPrefs () { //3/30/16 by DW
			if (theLog.renderingPrefs === undefined) { 
				theLog.renderingPrefs = new Object ();
				}
			if (theLog.renderingPrefs.siteName === undefined) {
				theLog.renderingPrefs.siteName = nameChatLog;
				}
			if (theLog.renderingPrefs.authorFacebookAccount === undefined) {
				theLog.renderingPrefs.authorFacebookAccount = "";
				}
			if (theLog.renderingPrefs.authorGithubAccount === undefined) {
				theLog.renderingPrefs.authorGithubAccount = "";
				}
			if (theLog.renderingPrefs.authorLinkedInAccount === undefined) {
				theLog.renderingPrefs.authorLinkedInAccount = "";
				}
			if (theLog.renderingPrefs.copyright === undefined) {
				theLog.renderingPrefs.copyright = "";
				}
			if (theLog.renderingPrefs.flAnyoneCanReply === undefined) {
				theLog.renderingPrefs.flAnyoneCanReply = true;
				}
			}
		var theLog = findChatLog (nameChatLog);
		if (theLog === undefined) {
			return (undefined);
			}
		
		initRenderingPrefs (); //3/30/16 by DW
		
		var jstruct = new Object ();
		jstruct.metadata = {
			name: nameChatLog,
			
			usersWhoCanPost: theLog.usersWhoCanPost, 
			rssHeadElements: {
				title: theLog.rssHeadElements.title,
				link: theLog.rssHeadElements.link,
				description: theLog.rssHeadElements.description,
				flInstantArticlesSupport: theLog.rssHeadElements.flInstantArticlesSupport //4/6/16 by DW
				},
			renderingPrefs: theLog.renderingPrefs, //2/21/16 by DW
			urlFeed: theLog.urlFeed, 
			
			server: {
				productName: myProductName,
				version: myVersion,
				now: new Date ()
				}
			};
		jstruct.chatLog = new Array ();
		
		if (theLog.chatLog.length > 0) { //6/1/16 by DW
			var theMonth = theLog.chatLog [theLog.chatLog.length - 1].when; //the date of the most recent item in the chatlog
			for (var i = theLog.chatLog.length - 1; i >= 0; i--) {
				var item = theLog.chatLog [i];
				jstruct.chatLog.unshift (item); //insert at beginning of the array
				if (!utils.sameMonth (item.when, theMonth)) { //return all items in current month, even if it exceeds the max
					if (jstruct.chatLog.length >= maxLogLengthForClient) {
						break;
						}
					}
				}
			}
		
		return (jstruct);
		}
	function setChatLogMetadata (nameChatLog, metadata, callback) { //2/19/16 by DW
		var jstruct;
		try {
			jstruct = JSON.parse (metadata);
			}
		catch (err) {
			callback (err, undefined);
			return;
			}
		var theLog = findChatLog (nameChatLog);
		function lookFor (elementName) {
			if (jstruct [elementName] !== undefined) {
				theLog [elementName] = jstruct [elementName];
				theLog.flDirty = true;
				}
			}
		lookFor ("usersWhoCanPost");
		lookFor ("renderingPrefs"); //2/21/16 by DW
		if (jstruct.rssHeadElements !== undefined) { //the user changed something in the RSS feed
			function lookForHeadElement (name) {
				if (jstruct.rssHeadElements [name] !== undefined) {
					theLog.rssHeadElements [name] = jstruct.rssHeadElements [name];
					theLog.flDirty = true;
					console.log ("setChatLogMetadata: theLog.rssHeadElements." + name + " == " + jstruct.rssHeadElements [name]);
					}
				}
			lookForHeadElement ("title");
			lookForHeadElement ("link");
			lookForHeadElement ("description");
			lookForHeadElement ("flInstantArticlesSupport"); //3/4/16 by DW
			lookForHeadElement ("appDomain"); //3/4/16 by DW
			}
		callback (undefined, jstruct);
		}
	function publishChatLogHomePage (nameChatLog, screenName, htmltext, callback) { //3/3/16 by DW
		if (okToPostToChatLog (nameChatLog, screenName, false)) {
			var theLog = findChatLog (nameChatLog);
			var path = theLog.s3Path + indexFileName;
			store.newObject (path, htmltext, "text/html", undefined, function (err, data) {
				if (err) {
					if (callback != undefined) {
						callback (err);
						}
					}
				else {
					callbacks.callPublishCallbacks (indexFileName, htmltext, "text/html", nameChatLog); //4/12/16 by DW
					if (callback != undefined) {
						var jstruct = {
							urlHomePage: theLog.urlPublicFolder
							}
						callback (undefined, jstruct);
						}
					}
				});
			}
		else {
			callback ({message: "Can't save the home page because you are not authorized to post."});
			}
		}
	function chatLogEverySecond () {
		if (flChatLogDirty) {
			saveChatLog (nameDirtyChatLog);
			flChatLogDirty = false; 
			nameDirtyChatLog = undefined;
			}
		for (var i = 0; i < chatLogArray.length; i++) {
			var log = chatLogArray [i];
			if (log.flDirty) {
				saveChatLog (log.name);
				log.flDirty = false;
				}
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
						var channel = theHook.channel; //10/29/15 by DW -- we now have more than one chatlog per server
						
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
						
						postChatMessage (screenName, channel, slackProcessText (jstruct.text),  undefined, undefined, iconUrl, iconEmoji, flTwitterName, function (id) {
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
					try {
						console.log ("callNextHook: token == " + outgoingData.token + ", res.statusCode == " + res.statusCode);
						}
					catch (err) {
						console.log ("callNextHook: token == " + outgoingData.token + ", err.message == " + err.message);
						}
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
//utility functions -- 2/19/16 by DW
	function getDomainName (clientIp, callback) { //11/14/15 by DW
		if (clientIp === undefined) {
			if (callback !== undefined) {
				callback ("undefined");
				}
			}
		else {
			dns.reverse (clientIp, function (err, domains) {
				var name = clientIp;
				if (!err) {
					if (domains.length > 0) {
						name = domains [0];
						}
					}
				if (callback !== undefined) {
					callback (name);
					}
				});
			}
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
	console.log ("\neveryMinute: " + now.toLocaleTimeString () + ", v" + myVersion + ", " + countOpenSockets () + " open sockets");
	readUserWhitelist (); //11/18/14 by DW
	update.doUpdate (); //3/24/16 by DW
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
	chatLogEverySecond ();
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
		function returnRedirect (url, code) {
			if (code === undefined) {
				code = 302;
				}
			httpResponse.writeHead (code, {"location": url, "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
			httpResponse.end (code + " REDIRECT");    
			}
			
		function addOurDataToReturnObject (returnObject) {
			return; //disabled -- 2/21/15 by DW
			
			returnObject ["#smallpict"] = {
				productname: myProductName,
				version: myVersion
				};
			}
		function checkPathForIllegalChars (path) {
			function isIllegal (ch) {
				if (utils.isAlpha (ch) || utils.isNumeric (ch)) {
					return (false);
					}
				switch (ch) {
					case "/": case "_": case "-": case ".":  case " ": case "*":
						return (false);
					}
				return (true);
				}
			for (var i = 0; i < path.length; i++) {
				if (isIllegal (path [i])) {
					return (false);
					}
				}
			if (utils.stringContains (path, "./")) {
				return (false);
				}
			return (true);
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
		function getConfigJson () { //3/24/16 by DW
			var jstruct = new Object ();
			for (var x in homePageConfig) {
				jstruct [x] = homePageConfig [x];
				}
			if (jstruct.urlTwitterServer === undefined) {
				jstruct.urlTwitterServer = "http://" + myDomain + "/";
				}
			if ((jstruct.urlChatLogSocket === undefined) && (websocketPort !== undefined)) {
				var domain = utils.stringNthField (myDomain, ":", 1); //remove port, if present
				jstruct.urlChatLogSocket = "ws://" + domain + ":" + websocketPort + "/";
				}
			if (jstruct.urlPageTemplate === undefined) {
				jstruct.urlPageTemplate = "/template.html";
				}
			jstruct.flEditChatUsePostBody = true; //signal to the client they can use this feature, we support it -- 4/28/16 by DW
			jstruct.facebookAppId = facebookAppId; //5/2/16 by DW
			jstruct.server = { //4/29/16 by DW
				productName: myProductName,
				version: myVersion,
				now: new Date ()
				}
			//jstruct.editors
				jstruct.editors = new Object ();
				for (var x in theEditors) {
					jstruct.editors [x] = {
						name: theEditors [x].name
						};
					}
			//jstruct.plugIns
				jstruct.plugIns = new Object ();
				for (var x in thePlugIns) {
					jstruct.plugIns [x] = {
						name: thePlugIns [x].name
						};
					}
			return (utils.jsonStringify (jstruct));
			}
		function get404page (callback) { //6/25/16 by DW
			function plainReturn () {
				callback ("Not found.", "text/plain");
				}
			if (url404page !== undefined) {
				request (url404page, function (error, response, body) {
					if (!error && (response.statusCode == 200)) {
						callback (body, "text/html");
						}
					else {
						plainReturn ();
						}
					});
				}
			else {
				plainReturn ();
				}
			
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
		
		function requestHomeFile (lowerpath, callback) { //3/19/16 by DW
			if (urlHomePageContent === undefined) {
				callback ({message: "Can't get the file because the server isn't configured for it."});
				}
			else {
				var url = utils.stringPopLastField (urlHomePageContent, "/") + lowerpath;
				console.log ("requestHomeFile: url == " + url);
				request (url, function (err, response, body) {
					callback (err, body);    
					});
				}
			}
		function requestEditor (editorname, callback) { //4/29/16 by DW
			var editor = theEditors [editorname];
			if (editor === undefined) {
				callback ({message: "There is no editor named \"" + editorname + ".\""});    
				}
			else {
				if (editor.url === undefined) {
					callback ({message: "The editor, \"" + editorname + ",\" doesn't have a url value."});    
					}
				else {
					console.log ("requestEditor: editor.url == " + editor.url);
					request (editor.url, function (err, response, body) {
						callback (err, body);    
						});
					}
				}
			}
		function requestPlugIn (plugInName, plugInStruct, typeString, callback) { //4/29/16 by DW
			var plugin = plugInStruct [plugInName];
			if (plugin === undefined) {
				callback ({message: "There is no " + typeString + " named \"" + plugInName + ".\""});    
				}
			else {
				if (plugin.url === undefined) {
					callback ({message: "The " + typeString + ", \"" + plugInName + ",\" doesn't have a url value."});    
					}
				else {
					console.log ("requestEditor: plugin.url == " + plugin.url);
					request (plugin.url, function (err, response, body) {
						callback (err, body);    
						});
					}
				}
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
			getDomainName (clientIp, function (theName) { //log the request
				var freemem = gigabyteString (os.freemem ()); 
				console.log (now.toLocaleTimeString () + " " + freemem + " " + httpRequest.method + " " + host + ":" + port + " " + lowerpath + " " + referrer + " " + theName);
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
												var flNotWhitelisted = false; //11/24/15 AM by DW
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
																	callbacks.callPublishCallbacks (relpath, body, type, screenName); //10/14/15 by DW
																	}
																}
															}, metadata);
														}
													}, flNotWhitelisted);
												break;
											case "/publishchatlogfile": //1/6/16 by DW
												var accessToken = parsedUrl.query.oauth_token;
												var accessTokenSecret = parsedUrl.query.oauth_token_secret;
												var relpath = parsedUrl.query.relpath;
												var type = parsedUrl.query.type;
												var nameChatLog = parsedUrl.query.chatLog; 
												var flprivate = false; //this endpoint is only used to publish, not for private storage
												getScreenName (accessToken, accessTokenSecret, function (screenName) {
													if (screenName === undefined) {
														errorResponse ({message: "Can't publish the file because the accessToken is not valid."});    
														}
													else {
														var theLog = findChatLog (nameChatLog);
														if (theLog.version == 1) { //special publish method to grandfather-in version 1 format chatlogs
															publishChatLogFileV1 (nameChatLog, screenName, relpath, type, body, function (err, metadata) {
																if (err) {
																	errorResponse ({message: err.message});    
																	}
																else {
																	dataResponse (metadata);
																	}
																});
															}
														else { //do exactly what we'd do if we weren't publishing for a chatlog
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
																		callbacks.callPublishCallbacks (relpath, body, type, screenName); //10/14/15 by DW
																		}
																	}
																}, metadata);
															}
														}
													});
												break;
											case "/chat": //8/25/15 by DW
												if (flChatEnabled) {
													var theQuery = parsedUrl.query; //4/28/16 by DW
													if (body.length > 0) { 
														theQuery = qs.parse (body);
														console.log ("/chat: the params came to us in the body, not on the URL.");
														}
													
													var accessToken = theQuery.oauth_token;
													var accessTokenSecret = theQuery.oauth_token_secret;
													var flNotWhitelisted = utils.getBoolean (theQuery.flNotWhitelisted);
													var chatText = theQuery.text;
													var payload = theQuery.payload;
													var idMsgReplyingTo = theQuery.idMsgReplyingTo;
													var nameChatLog = theQuery.chatLog; //10/26/15 by DW
													
													flNotWhitelisted = false; //11/21/15 by DW
													if (idMsgReplyingTo !== undefined) { //it's a reply -- 11/21/15 by DW
														flNotWhitelisted = chatAnyoneCanReply (nameChatLog);
														}
													
													getScreenName (accessToken, accessTokenSecret, function (screenName) {
														if (screenName === undefined) {
															errorResponse ({message: "Can't post the chat message because the accessToken is not valid."});    
															}
														else {
															console.log ("/chat: idMsgReplyingTo == " + idMsgReplyingTo);
															postChatMessage (screenName, nameChatLog, chatText, payload, idMsgReplyingTo, undefined, undefined, true, function (err, idMessage, itemToReturn) {
																if (err) {
																	errorResponse ({message: err.message});    
																	}
																else {
																	dataResponse ({id: idMessage, item: itemToReturn});
																	}
																});
															}
														}, flNotWhitelisted);
													}
												else {
													errorResponse ({message: chatNotEnabledError});    
													}
												break;
											case "/editchatmessage": //9/11/15 by DW
												if (flChatEnabled) {
													var theQuery = parsedUrl.query; //4/28/16 by DW
													if (body.length > 0) { 
														theQuery = qs.parse (body);
														console.log ("/editchatmessage: the params came to us in the body, not on the URL.");
														}
													var accessToken = theQuery.oauth_token;
													var accessTokenSecret = theQuery.oauth_token_secret;
													var flNotWhitelisted = utils.getBoolean (theQuery.flNotWhitelisted);
													var chatText = theQuery.text;
													var idMessage = theQuery.id;
													var payload = theQuery.payload;
													var nameChatLog = theQuery.chatLog; //10/26/15 by DW
													
													flNotWhitelisted = chatAnyoneCanReply (nameChatLog); //11/21/15 by DW -- we won't let you edit if you didn't create the message
													
													getScreenName (accessToken, accessTokenSecret, function (screenName) {
														if (screenName === undefined) {
															errorResponse ({message: "Can't post the chat message because the accessToken is not valid."});    
															}
														else {
															editChatMessage (screenName, nameChatLog, chatText, payload, idMessage, function (err, msg, itemToReturn) {
																if (err) {
																	errorResponse ({message: err.message});    
																	}
																else {
																	dataResponse ({msg: msg, item: itemToReturn});
																	}
																});
															}
														}, flNotWhitelisted);
													}
												else {
													errorResponse ({message: chatNotEnabledError});    
													}
												break;
											case "/setchatlogmetadata": //2/19/16 by DW
												if (flChatEnabled) {
													var accessToken = parsedUrl.query.oauth_token;
													var accessTokenSecret = parsedUrl.query.oauth_token_secret;
													var jsontext = parsedUrl.query.metadata;
													getScreenName (accessToken, accessTokenSecret, function (screenName) {
														if (screenName === undefined) {
															errorResponse ({message: "Can't set the metadata message because the accessToken is not valid."});    
															}
														else {
															setChatLogMetadata (screenName, jsontext, function (err, data) {
																if (err) {
																	errorResponse ({message: err.message});    
																	}
																else {
																	dataResponse ({metadata: data});
																	}
																});
															}
														});
													}
												else {
													errorResponse ({message: chatNotEnabledError});    
													}
												break;
											case "/publishchatloghomepage": //3/3/16 by DW
												if (flChatEnabled) {
													var accessToken = parsedUrl.query.oauth_token;
													var accessTokenSecret = parsedUrl.query.oauth_token_secret;
													var nameChatLog = parsedUrl.query.chatLog; 
													getScreenName (accessToken, accessTokenSecret, function (screenName) {
														if (screenName === undefined) {
															errorResponse ({message: "Can't publish the home page because the accessToken is not valid."});    
															}
														else {
															publishChatLogHomePage (nameChatLog, screenName, body, function (err, data) {
																if (err) {
																	errorResponse ({message: err.message});    
																	}
																else {
																	dataResponse (data);
																	}
																});
															}
														});
													}
												else {
													errorResponse ({message: chatNotEnabledError});    
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
											if (flForceTwitterLogin) { //2/19/16 by DW
												twitterOauthUrl += "&force_login=true"; //https://dev.twitter.com/oauth/reference/get/oauth/authenticate
												}
											
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
											var url = parsedUrl.query.redirectUrl + "?oauth_token=" + encodeURIComponent (accessToken) + "&oauth_token_secret=" + encodeURIComponent (accessTokenSecret) + "&user_id=" + encodeURIComponent (results.user_id) + "&screen_name=" + encodeURIComponent (results.screen_name);
											
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
									var flNotWhitelisted = false; //11/24/15 AM by DW
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
									doHttpReturn (200, "text/plain", utils.jsonStringify (isWhitelistedUser (screenName)));
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
									var flNotWhitelisted = false; //11/24/15 AM by DW
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
									var flNotWhitelisted = false; //11/24/15 AM by DW
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
									var name = parsedUrl.query.chatLog;
									var jstruct = getChatlogForClient (name);
									if (jstruct === undefined) {
										errorResponse ({message: "Can't get the chatlog named \"" + name + "\" because it doesn't exist."});    
										}
									else {
										dataResponse (jstruct);
										}
									break;
								case "/morechatlog": //12/31/15 by DW
									var name = parsedUrl.query.chatLog;
									var id = parsedUrl.query.idOldestPost;
									var ct = parsedUrl.query.ctPosts;
									var jstruct = getMoreChatLogPosts (name, id, ct);
									if (jstruct === undefined) {
										errorResponse ({message: "Can't get more chatlog items before id " + id + " because the chatlog doesn't exist or the post doesn't."});
										}
									else {
										dataResponse (jstruct);
										}
									break
								case "/chatlogindex": //1/2/16 by DW
									var name = parsedUrl.query.chatLog;
									var jstruct = getChatLogIndex (name);
									if (jstruct === undefined) {
										errorResponse ({message: "Can't get the index for the chatlog named \"" + name + "\" because it doesn't exist."});    
										}
									else {
										dataResponse (jstruct);
										}
									break
								case "/chatloglist": //10/29/15 by DW
									dataResponse (getChatLogList ());
									break;
								case "/getchatmessage": //9/20/15 by DW
									var nameChatLog = parsedUrl.query.chatLog; //10/26/15 by DW
									findChatMessage (nameChatLog, parsedUrl.query.id, function (flFound, item, subs, theTopItem) {
										if (flFound) {
											dataResponse ({
												item: item
												});
											}
										else {
											errorResponse ({message: "Can't get the message because it isn't in the server chat log."});    
											}
										});
									break;
								case "/chatlike": //9/27/15 by DW
									var accessToken = parsedUrl.query.oauth_token;
									var accessTokenSecret = parsedUrl.query.oauth_token_secret;
									var nameChatLog = parsedUrl.query.chatLog; //10/26/15 by DW
									var id = parsedUrl.query.id;
									var flNotWhitelisted = chatAnyoneCanLike (nameChatLog); //4/10/16 by DW
									getScreenName (accessToken, accessTokenSecret, function (screenName) {
										if (screenName !== undefined) { //11/21/15 by DW
											if (flChatEnabled) {
												likeChatMessage (screenName, nameChatLog, id, function (fl) {
													dataResponse ({
														flLiked: fl
														});
													});
												}
											else {
												errorResponse ({message: webhookNotEnabledError});    
												}
											}
										else {
											errorResponse ({message: "Can't 'like' the message because your accessToken isn't valid."});    
											}
										}, flNotWhitelisted);
									break;
								case "/openuserchatlog": //1/5/16 by DW
									var accessToken = parsedUrl.query.oauth_token;
									var accessTokenSecret = parsedUrl.query.oauth_token_secret;
									getScreenName (accessToken, accessTokenSecret, function (screenName) {
										openUserChatlog (screenName, function (theLog) {
											if (theLog === undefined) {
												newUserChatlog (screenName, function (theNewLog) { //3/15/16 by DW
													dataResponse (theNewLog);
													});
												}
											else {
												dataResponse (theLog);
												}
											});
										});
									break;
								case "/opennamedchatlog": //1/6/16 by DW
									openUserChatlog (parsedUrl.query.chatLog, function (theLog) {
										dataResponse (theLog);
										});
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
								case "/opensockets": //11/29/15 by DW -- for debugging
									dataResponse (getOpenSocketsArray ());
									break;
								case "/httpreadurl": //5/9/16 by DW -- simple proxy to work around CORS limits
									request (parsedUrl.query.url, function (error, response, body) {
										if (error) {
											doHttpReturn (500, "text/plain", error.message);
											}
										else {
											doHttpReturn (response.statusCode, response.headers ["content-type"], body);
											}
										});
									break;
								
								case "/chat.css": //3/19/16 by DW
									requestHomeFile (lowerpath, function (err, data) {
										if (err) {
											doHttpReturn (500, "text/plain", err.message);
											}
										else {
											doHttpReturn (200, "text/css", data);
											}
										});
									break;
								case "/chat.js": //3/19/16 by DW
									requestHomeFile (lowerpath, function (err, data) {
										if (err) {
											doHttpReturn (500, "text/plain", err.message);
											}
										else {
											var searchFor = "twStorageData.urlTwitterServer = homePageConfig.urlTwitterServer;";
											var replaceWith = "twStorageData.urlTwitterServer = \"" + homePageConfig.urlTwitterServer + "\";";
											data = utils.replaceAll (data, searchFor, replaceWith);
											doHttpReturn (200, "application/javascript", data);
											}
										});
									break;
								case "/config.json": //3/20/16 by DW
									doHttpReturn (200, "application/json", getConfigJson ());
									break;
								case "/template.html": //3/20/16 by DW
									request ("http://1999.io/code/publish/template.html", function (error, response, body) {
										if (error) {
											doHttpReturn (500, "text/plain", error.message);
											}
										else {
											doHttpReturn (200, "text/html", body);
											}
										});
									break;
								case "/favicon.ico": //3/26/16 by DW
									returnRedirect (urlFavicon);
									break;
								case "/editor": //4/29/16 by DW
									requestEditor (parsedUrl.query.name, function (err, data) {
										if (err) {
											doHttpReturn (500, "text/plain", err.message);
											}
										else {
											doHttpReturn (200, "text/html", data);
											}
										});
									break;
								case "/plugin": //5/14/16 by DW
									requestPlugIn (parsedUrl.query.name, thePlugIns, "plug-in", function (err, data) {
										if (err) {
											doHttpReturn (500, "text/plain", err.message);
											}
										else {
											doHttpReturn (200, "text/html", data);
											}
										});
									break;
								
								case "/getmonthchatmessages": //5/31/16 by DW
									var monthnum = parsedUrl.query.monthnum;
									var yearnum = parsedUrl.query.yearnum;
									var nameChatLog = parsedUrl.query.chatLog; 
									
									var jstruct = getMonthChatLogPosts (nameChatLog, monthnum, yearnum);
									if (jstruct === undefined) {
										errorResponse ({message: "Can't get chatlog items for month # " + monthnum + " in " + yearnum + " because the chatlog doesn't exist or the posts don't."});
										}
									else {
										dataResponse (jstruct);
										}
									
									break;
								
								default:
									var path = parsedUrl.pathname;
									path = decodeURI (path); //6/28/16 by DW
									
									if (theDomainMap [lowerhost] !== undefined) {
										path = theDomainMap [lowerhost] + path;
										}
									else {
										if (!utils.getBoolean (parsedUrl.query.noredirect)) { //7/17/16 by DW, noredirect param not specified or not true
											for (var x in theDomainMap) {
												if (utils.beginsWith (path, theDomainMap [x])) { 
													var addport = (port == 80) ? "" : ":" + port;
													var urlRedirect = "http://" + x + addport + utils.stringDelete (path, 1, theDomainMap [x].length);
													returnRedirect (urlRedirect);
													return;
													}
												}
											}
										}
									
									if ((path == "/") && (urlHomePageContent !== undefined)) { //10/11/15 by DW
										request (urlHomePageContent, function (error, response, body) {
											if (error) {
												httpResponse.writeHead (500, {"Content-Type": "text/plain"});
												httpResponse.end ("Error accessing home page content: " + error.message);    
												}
											else {
												httpResponse.writeHead (response.statusCode, {"Content-Type": response.headers ["content-type"]});
												httpResponse.end (body);    
												}
											});
										}
									else {
										if (checkPathForIllegalChars (path)) {
											if (utils.endsWith (path, "/")) {
												path += indexFileName;
												}
											store.serveObject (path, function (code, headers, bodytext, internalErrorCode) { //7/28/15 by DW -- try to serve the object from the store
												if (internalErrorCode !== undefined) { //5/2/16 by DW
													switch (internalErrorCode) {
														case 1: //path points to a directory, not a file
															returnRedirect (path + "/");
															return;
														}
													}
												
												if (code == 500) { //6/25/16 by DW
													try {
														var jstruct = JSON.parse (bodytext);
														if (jstruct.code == "NoSuchKey") {
															get404page (function (bodytext, type) {
																doHttpReturn (404, type, bodytext);
																});
															return;
															}
														}
													catch (err) {
														}
													}
												
												headers ["Access-Control-Allow-Origin"] = "*"; //5/29/16 by DW
												httpResponse.writeHead (code, headers);
												httpResponse.end (bodytext);
												});
											}
										else {
											httpResponse.writeHead (500, {"Content-Type": "text/plain"});
											httpResponse.end ("The file name contains illegal characters.");    
											}
										}
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
				flWhitelist = true; //3/30/16 by DW
				}
			if (config.userWhitelist !== undefined) { //3/30/16 by DW
				userWhitelist = config.userWhitelist;
				flWhitelist = true; 
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
			if (config.chatRssHeadElements !== undefined) { //10/6/15 by DW
				chatRssHeadElements = config.chatRssHeadElements;
				}
			if (config.urlPublicFolder !== undefined) { //10/6/15 by DW
				urlPublicFolder = config.urlPublicFolder;
				}
			if (config.urlHomePageContent !== undefined) { //10/11/15 by DW
				urlHomePageContent = config.urlHomePageContent;
				}
			if (config.s3RssPath !== undefined) { //10/12/15 by DW
				s3RssPath = config.s3RssPath;
				}
			if (config.websocketPort !== undefined) { //11/11/15 by DW
				websocketPort = config.websocketPort;
				}
			if (config.usersWhoCanModerate !== undefined) { //11/30/15 by DW
				usersWhoCanModerate = config.usersWhoCanModerate;
				}
			if (config.chatLogs !== undefined) { //10/26/15 by DW
				chatLogArray = config.chatLogs;
				}
			if (config.flForceTwitterLogin !== undefined) { //2/19/16 by DW
				flForceTwitterLogin = config.flForceTwitterLogin;
				}
			if (config.homePage !== undefined) { //3/21/16 by DW
				homePageConfig = config.homePage;
				}
			if (config.updates !== undefined) { //3/25/16 by DW
				update.init (config.updates);
				}
			if (config.editors !== undefined) { //4/29/16 by DW
				theEditors = config.editors;
				}
			if (config.plugIns !== undefined) { //5/14/16 by DW
				thePlugIns = config.plugIns;
				}
			if (config.domains !== undefined) { //5/27/16 by DW
				theDomainMap = config.domains;
				}
			if (config.facebookAppId !== undefined) { //5/2/16 by DW
				facebookAppId = config.facebookAppId;
				}
			if (config.url404page !== undefined) { //6/25/16 by DW
				url404page = config.url404page;
				}
			
			//give values to optional params -- 3/24/16 by DW
				if ((basePublicUrl === undefined) && (myDomain !== undefined)) {
					basePublicUrl = "http://" + myDomain + "/";
					}
				if (urlPublicFolder === undefined) {
					if (basePublicUrl !== undefined) {
						urlPublicFolder = basePublicUrl;
						}
					else {
						if (myDomain !== undefined) {
							urlPublicFolder = "http://" + myDomain + "/";
							}
						}
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
						loadChatLogs (function () { //8/25/15 by DW
							readUserWhitelist (function () {
								openAllUserChatlogs (function () { //3/2/16 by DW
									names.init (s3PrivatePath); //7/12/15 by DW
									//start up http server
										try {
											http.createServer (handleHttpRequest).listen (myPort);
											}
										catch (err) {
											console.log ("startup: error creating HTTP server, err.message == " + err.message + ", myPort == " + myPort);
											}
									if (websocketPort !== undefined) { //11/11/15 by DW
										console.log ("startup: websockets port is " + websocketPort);
										webSocketStartup (websocketPort); //11/29/15 by DW
										}
									setInterval (everySecond, 1000); 
									});
								});
							});
						});
					});
				});
			});
		});
	}

startup ();
