var myVersion = "0.51", myProductName = "storage";
 
 
//last build 1/13/15; 9:52:21 AM 

var http = require ("http");
var AWS = require ("aws-sdk");
var s3 = new AWS.S3 ();
var urlpack = require ("url");
var twitterAPI = require ("node-twitter-api");
var fs = require ("fs");
var request = require ("request");

var myPort = process.env.PORT;
var flEnabled = process.env.enabled; //11/16/14 by DW
var longPollTimeoutSecs = process.env.longPollTimeoutSecs; //12/17/14 by DW
var s3Path = process.env.s3Path; //where we store publicly accessible data, user files, logs
var s3PrivatePath = process.env.s3PrivatePath; //where we private stuff, user's outlines for example -- 8/3/14 by DW
var s3UsersPath = s3Path + "users/"; //where we store users data
var whenServerStart = new Date ();
var ctHits = 0;
var requestTokens = [];
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
	nextUrlString: "0",
	ctFileSaves: 0, //8/3/14 by DW
	ctLongPollPushes: 0,  //12/16/14 by DW
	ctLongPollPops: 0,  //12/16/14 by DW
	ctLongPollTimeouts: 0,  //12/16/14 by DW
	ctLongPollUpdates: 0, //12/16/14 by DW
	ctCurrentLongPolls: 0,  //12/16/14 by DW
	ctLongPollsToday: 0,  //12/17/14 by DW
	recentTweets: []
	};
var flStatsDirty = false; //12/16/14 by DW
var maxrecentTweets = 500, pathHttpLogFile = "stats/tweetLog.json";
var macroStart = "<" + "%", macroEnd = "%" + ">"; 
var defaultOpmlAcl = "private"; //see table on this page: http://docs.aws.amazon.com/AmazonS3/latest/dev/acl-overview.html

var feed = {
	ctPosts: 0, ctPostsToday: 0, whenLastPost: new Date (0),
	recentPosts: []
	};
var maxFeedPosts = 100;
var s3FeedFolder = s3Path + "feed/";
var s3FeedPath = s3FeedFolder + "index.json";

var todaysFeed = []; //holds all items posted today
var dayForTodaysFeed = new Date ();
var s3CalendarFolder = s3FeedFolder + "calendar/";

var myDomain = process.env.myDomain; //6/30/14 AM by DW
if (myDomain == undefined) {
	myDomain = "fargotwitter.herokuapp.com";
	}

var screenNameCache = []; //7/9/14 by DW


 

var s3defaultType = "text/plain";
var s3defaultAcl = "public-read";

var s3stats = {
	ctReads: 0, ctBytesRead: 0, ctReadErrors: 0, 
	ctWrites: 0, ctBytesWritten: 0, ctWriteErrors: 0
	};

function s3SplitPath (path) { //split path like this: /tmp.scripting.com/testing/one.txt -- into bucketname and path.
	var bucketname = "";
	if (path.length > 0) {
		if (path [0] == "/") { //delete the slash
			path = path.substr (1); 
			}
		var ix = path.indexOf ("/");
		bucketname = path.substr (0, ix);
		path = path.substr (ix + 1);
		}
	return ({Bucket: bucketname, Key: path});
	}
function s3NewObject (path, data, type, acl, callback, metadata) {
	var splitpath = s3SplitPath (path);
	if (type === undefined) {
		type = s3defaultType;
		}
	if (acl === undefined) {
		acl = s3defaultAcl;
		}
	var params = {
		ACL: acl,
		ContentType: type,
		Body: data,
		Bucket: splitpath.Bucket,
		Key: splitpath.Key,
		Metadata: metadata
		};
	s3.putObject (params, function (err, data) { 
		if (err) {
			console.log ("s3NewObject: error == " + err.message);
			s3stats.ctWriteErrors++;
			if (callback != undefined) {
				callback (err, data);
				}
			}
		else {
			s3stats.ctWrites++;
			s3stats.ctBytesWritten += params.Body.length;
			if (callback != undefined) {
				callback (err, data);
				}
			}
		});
	}
function s3Redirect (path, url) { //1/30/14 by DW -- doesn't appear to work -- don't know why
	var splitpath = s3SplitPath (path);
	var params = {
		WebsiteRedirectLocation: url,
		Bucket: splitpath.Bucket,
		Key: splitpath.Key,
		Body: " "
		};
	s3.putObject (params, function (err, data) { 
		if (err != null) {
			consoleLog ("s3Redirect: err.message = " + err.message + ".");
			}
		else {
			consoleLog ("s3Redirect: path = " + path + ", url = " + url + ", data = ", JSON.stringify (data));
			}
		});
	}
function s3GetObjectMetadata (path, callback) {
	var params = s3SplitPath (path);
	s3.headObject (params, function (err, data) {
		callback (data);
		});
	}
function s3GetObject (path, callback) {
	var params = s3SplitPath (path);
	s3.getObject (params, function (err, data) {
		if (err) {
			s3stats.ctReadErrors++;
			}
		else {
			s3stats.ctReads++;
			s3stats.ctBytesRead += data.Body.length;
			}
		callback (err, data);
		});
	}
function s3ListObjects (path, callback) {
	var splitpath = s3SplitPath (path);
	function getNextGroup (marker) {
		var params = {Bucket: splitpath.Bucket, Prefix: splitpath.Key};
		if (marker != undefined) {
			params = {Bucket: splitpath.Bucket, Prefix: splitpath.Key, Marker: marker};
			}
		s3.listObjects (params, function (err, data) {
			if (err) {
				console.log ("s3ListObjects: error == " + err.message);
				}
			else {
				var lastobj = data.Contents [data.Contents.length - 1];
				for (var i = 0; i < data.Contents.length; i++) {
					data.Contents [i].s3path = splitpath.Bucket + "/" + data.Contents [i].Key; //5/22/14 by DW
					callback (data.Contents [i]);
					}
				if (data.IsTruncated) {
					getNextGroup (lastobj.Key);
					}
				else {
					var obj = new Object ();
					obj.flLastObject = true;
					callback (obj);
					}
				}
			});
		}
	getNextGroup ();
	}





function sameDay (d1, d2) { 
	//returns true if the two dates are on the same day
	d1 = new Date (d1);
	d2 = new Date (d2);
	return ((d1.getFullYear () == d2.getFullYear ()) && (d1.getMonth () == d2.getMonth ()) && (d1.getDate () == d2.getDate ()));
	}
function dayGreaterThanOrEqual (d1, d2) { //9/2/14 by DW
	d1 = new Date (d1);
	d1.setHours (0);
	d1.setMinutes (0);
	d1.setSeconds (0);
	
	d2 = new Date (d2);
	d2.setHours (0);
	d2.setMinutes (0);
	d2.setSeconds (0);
	
	return (d1 >= d2);
	}
function stringLower (s) {
	return (s.toLowerCase ());
	}
function secondsSince (when) { 
	var now = new Date ();
	when = new Date (when);
	return ((now - when) / 1000);
	}
function padWithZeros (num, ctplaces) { 
	var s = num.toString ();
	while (s.length < ctplaces) {
		s = "0" + s;
		}
	return (s);
	}
function getDatePath (theDate, flLastSeparator) {
	if (theDate === undefined) {
		theDate = new Date ();
		}
	else {
		theDate = new Date (theDate); //8/12/14 by DW -- make sure it's a date type
		}
	if (flLastSeparator === undefined) {
		flLastSeparator = true;
		}
	
	var month = padWithZeros (theDate.getMonth () + 1, 2);
	var day = padWithZeros (theDate.getDate (), 2);
	var year = theDate.getFullYear ();
	
	if (flLastSeparator) {
		return (year + "/" + month + "/" + day + "/");
		}
	else {
		return (year + "/" + month + "/" + day);
		}
	}
function multipleReplaceAll (s, adrTable, flCaseSensitive, startCharacters, endCharacters) { 
	if(flCaseSensitive===undefined){
		flCaseSensitive = false;
		}
	if(startCharacters===undefined){
		startCharacters="";
		}
	if(endCharacters===undefined){
		endCharacters="";
		}
	for( var item in adrTable){
		var replacementValue = adrTable[item];
		var regularExpressionModifier = "g";
		if(!flCaseSensitive){
			regularExpressionModifier = "gi";
			}
		var regularExpressionString = (startCharacters+item+endCharacters).replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
		var regularExpression = new RegExp(regularExpressionString, regularExpressionModifier);
		s = s.replace(regularExpression, replacementValue);
		}
	return s;
	}
function endsWith (s, possibleEnding, flUnicase) {
	if ((s === undefined) || (s.length == 0)) { 
		return (false);
		}
	var ixstring = s.length - 1;
	if (flUnicase === undefined) {
		flUnicase = true;
		}
	if (flUnicase) {
		for (var i = possibleEnding.length - 1; i >= 0; i--) {
			if (stringLower (s [ixstring--]) != stringLower (possibleEnding [i])) {
				return (false);
				}
			}
		}
	else {
		for (var i = possibleEnding.length - 1; i >= 0; i--) {
			if (s [ixstring--] != possibleEnding [i]) {
				return (false);
				}
			}
		}
	return (true);
	}
function stringContains (s, whatItMightContain, flUnicase) { //11/9/14 by DW
	if (flUnicase === undefined) {
		flUnicase = true;
		}
	if (flUnicase) {
		s = s.toLowerCase ();
		whatItMightContain = whatItMightContain.toLowerCase ();
		}
	return (s.indexOf (whatItMightContain) != -1);
	}
function beginsWith (s, possibleBeginning, flUnicase) { 
	if (s.length == 0) { //1/1/14 by DW
		return (false);
		}
	if (flUnicase === undefined) {
		flUnicase = true;
		}
	if (flUnicase) {
		for (var i = 0; i < possibleBeginning.length; i++) {
			if (stringLower (s [i]) != stringLower (possibleBeginning [i])) {
				return (false);
				}
			}
		}
	else {
		for (var i = 0; i < possibleBeginning.length; i++) {
			if (s [i] != possibleBeginning [i]) {
				return (false);
				}
			}
		}
	return (true);
	}
function isAlpha (ch) {
	return (((ch >= 'a') && (ch <= 'z')) || ((ch >= 'A') && (ch <= 'Z')));
	}
function isNumeric (ch) {
	return ((ch >= '0') && (ch <= '9'));
	}
function trimLeading (s, ch) {
	while (s.charAt (0) === ch) {
		s = s.substr (1);
		}
	return (s);
	}
function trimTrailing (s, ch) { 
	while (s.charAt (s.length - 1) === ch) {
		s = s.substr (0, s.length - 1);
		}
	return (s);
	}
function trimWhitespace (s) { //rewrite -- 5/30/14 by DW
	function isWhite (ch) {
		switch (ch) {
			case " ": case "\r": case "\n": case "\t":
				return (true);
			}
		return (false);
		}
	if (s === undefined) { //9/10/14 by DW
		return ("");
		}
	while (isWhite (s.charAt (0))) {
		s = s.substr (1);
		}
	while (s.length > 0) {
		if (!isWhite (s.charAt (0))) {
			break;
			}
		s = s.substr (1);
		}
	while (s.length > 0) {
		if (!isWhite (s.charAt (s.length - 1))) {
			break;
			}
		s = s.substr (0, s.length - 1);
		}
	return (s);
	}
function addPeriodAtEnd (s) {
	s = trimWhitespace (s);
	if (s.length == 0) {
		return (s);
		}
	switch (s [s.length - 1]) {
		case ".":
		case ",":
		case "?":
		case "\"":
		case "'":
		case ":":
		case ";":
		case "!":
			return (s);
		default:
			return (s + ".");
		}
	}
function getBoolean (val) { //12/5/13 by DW
	switch (typeof (val)) {
		case "string":
			if (val.toLowerCase () == "true") {
				return (true);
				}
			break;
		case "boolean":
			return (val);
			break;
		case "number":
			if (val == 1) {
				return (true);
				}
			break;
		}
	return (false);
	}
function bumpUrlString (s) { //5/10/14 by DW
	if (s === undefined) {
		s = "0";
		}
	function bumpChar (ch) {
		function num (ch) {
			return (ch.charCodeAt (0));
			}
		if ((ch >= "0") && (ch <= "8")) {
			ch = String.fromCharCode (num (ch) + 1);
			}
		else {
			if (ch == "9") {
				ch = "a";
				}
			else {
				if ((ch >= "a") && (ch <= "y")) {
					ch = String.fromCharCode (num (ch) + 1);
					}
				else {
					throw "rollover!";
					}
				}
			}
		return (ch);
		}
	try {
		var chlast = bumpChar (s [s.length - 1]);
		s = s.substr (0, s.length - 1) + chlast;
		return (s);
		}
	catch (tryError) {
		if (s.length == 1) {
			return ("00");
			}
		else {
			s = s.substr (0, s.length - 1);
			s = bumpUrlString (s) + "0";
			return (s);
			}
		}
	}
function stringDelete (s, ix, ct) {
	var start = ix - 1;
	var end = (ix + ct) - 1;
	var s1 = s.substr (0, start);
	var s2 = s.substr (end);
	return (s1 + s2);
	}
function replaceAll (s, searchfor, replacewith) {
	function escapeRegExp (string) {
		return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
		}
	return (s.replace (new RegExp (escapeRegExp (searchfor), 'g'), replacewith));
	}
function stringCountFields (s, chdelim) {
	var ct = 1;
	if (s.length == 0) {
		return (0);
		}
	for (var i = 0; i < s.length; i++) {
		if (s [i] == chdelim) {
			ct++;
			}
		}
	return (ct)
	}
function stringNthField (s, chdelim, n) {
	var splits = s.split (chdelim);
	if (splits.length >= n) {
		return splits [n-1];
		}
	return ("");
	}
function dateYesterday (d) {
	return (new Date (new Date (d) - (24 * 60 * 60 * 1000)));
	}
function stripMarkup (s) { //5/24/14 by DW
	if ((s === undefined) || (s == null) || (s.length == 0)) {
		return ("");
		}
	return (s.replace (/(<([^>]+)>)/ig, ""));
	}
function maxStringLength (s, len, flWholeWordAtEnd, flAddElipses) {
	if (flWholeWordAtEnd === undefined) {
		flWholeWordAtEnd = true;
		}
	if (flAddElipses === undefined) { //6/2/14 by DW
		flAddElipses = true;
		}
	if (s.length > len) {
		s = s.substr (0, len);
		if (flWholeWordAtEnd) {
			while (s.length > 0) {
				if (s [s.length - 1] == " ") {
					if (flAddElipses) {
						s += "...";
						}
					break;
					}
				s = s.substr (0, s.length - 1); //pop last char
				}
			}
		}
	return (s);
	}
function random (lower, upper) {
	var range = upper - lower + 1;
	return (Math.floor ((Math.random () * range) + lower));
	}
function removeMultipleBlanks (s) { //7/30/14 by DW
	return (s.toString().replace (/ +/g, " "));
	}
function stringAddCommas (x) { //5/27/14 by DW
	return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	}
function readHttpFile (url, callback, timeoutInMilliseconds) { //5/27/14 by DW
	if (timeoutInMilliseconds === undefined) {
		timeoutInMilliseconds = 30000;
		}
	var jxhr = $.ajax ({ 
		url: url,
		dataType: "text" , 
		timeout: timeoutInMilliseconds 
		}) 
	.success (function (data, status) { 
		callback (data);
		}) 
	.error (function (status) { 
		console.log ("readHttpFile: url == " + url + ", error == " + jsonStringify (status));
		callback (undefined);
		});
	}
function readHttpFileThruProxy (url, type, callback) { //10/25/14 by DW
	var urlReadFileApi = "http://pub.fargo.io/httpReadUrl";
	if (type === undefined) {
		type = "text/plain";
		}
	var jxhr = $.ajax ({ 
		url: urlReadFileApi + "?url=" + encodeURIComponent (url) + "&type=" + encodeURIComponent (type),
		dataType: "text" , 
		timeout: 30000 
		}) 
	.success (function (data, status) { 
		if (callback != undefined) {
			callback (data);
			}
		}) 
	.error (function (status) { 
		console.log ("readHttpFileThruProxy: url == " + url + ", error == " + status.statusText + ".");
		if (callback != undefined) {
			callback (undefined);
			}
		});
	}
function stringPopLastField (s, chdelim) { //5/28/14 by DW
	if (s.length == 0) {
		return (s);
		}
	if (endsWith (s, chdelim)) {
		s = stringDelete (s, s.length, 1);
		}
	while (s.length > 0) {
		if (endsWith (s, chdelim)) {
			return (stringDelete (s, s.length, 1));
			}
		s = stringDelete (s, s.length, 1);
		}
	return (s);
	}
function filledString (ch, ct) { //6/4/14 by DW
	var s = "";
	for (var i = 0; i < ct; i++) {
		s += ch;
		}
	return (s);
	}
function encodeXml (s) { //7/15/14 by DW
	var charMap = {
		'<': '&lt;',
		'>': '&gt;',
		'&': '&amp;',
		'"': '&'+'quot;'
		};
	s = s.toString();
	s = s.replace(/\u00A0/g, " ");
	var escaped = s.replace(/[<>&"]/g, function(ch) {
		return charMap [ch];
		});
	return escaped;
	}
function decodeXml (s) { //11/7/14 by DW
	return (s.replace (/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'));
	}
function hotUpText (s, url) { //7/18/14 by DW
	
	if (url === undefined) { //makes it easier to call -- 3/14/14 by DW
		return (s);
		}
	
	function linkit (s) {
		return ("<a href=\"" + url + "\" target=\"_blank\">" + s + "</a>");
		}
	var ixleft = s.indexOf ("["), ixright = s.indexOf ("]");
	if ((ixleft == -1) || (ixright == -1)) {
		return (linkit (s));
		}
	if (ixright < ixleft) {
		return (linkit (s));
		}
	
	var linktext = s.substr (ixleft + 1, ixright - ixleft - 1); //string.mid (s, ixleft, ixright - ixleft + 1);
	linktext = "<a href=\"" + url + "\" target=\"_blank\">" + linktext + "</a>";
	
	var leftpart = s.substr (0, ixleft);
	var rightpart = s.substr (ixright + 1, s.length);
	s = leftpart + linktext + rightpart;
	return (s);
	}
function getFavicon (url) { //7/18/14 by DW
	function getDomain (url) {
		if (( url != null ) && (url != "")) {
			url = url.replace("www.","").replace("www2.", "").replace("feedproxy.", "").replace("feeds.", "");
			var root = url.split('?')[0]; // cleans urls of form http://domain.com?a=1&b=2
			var url = root.split('/')[2];
		}
		return (url);
		};
	var domain = getDomain (url);
	return ("http://www.google.com/s2/favicons?domain=" + domain);
	};
function jsonStringify (jstruct) { //7/19/14 by DW
	return (JSON.stringify (jstruct, undefined, 4));
	}
function getURLParameter (name) { //7/21/14 by DW
	return (decodeURI ((RegExp(name + '=' + '(.+?)(&|$)').exec(location.search)||[,null])[1]));
	}
function urlSplitter (url) { //7/15/14 by DW
	var pattern = /^(?:([A-Za-z]+):)?(\/{0,3})([0-9.\-A-Za-z]+)(?::(\d+))?(?:\/([^?#]*))?(?:\?([^#]*))?(?:#(.*))?$/;
	var result = pattern.exec (url);
	if (result == null) {
		result = [];
		result [5] = url;
		}
	var splitUrl = {
		scheme: result [1],
		host: result [3],
		port: result [4],
		path: result [5],
		query: result [6],
		hash: result [7]
		};
	return (splitUrl);
	}
function innerCaseName (text) { //8/12/14 by DW
	var s = "", ch, flNextUpper = false;
	text = stripMarkup (text); 
	for (var i = 0; i < text.length; i++) {
		ch = text [i];
		if (isAlpha (ch) || isNumeric (ch)) { 
			if (flNextUpper) {
				ch = ch.toUpperCase ();
				flNextUpper = false;
				}
			else {
				ch = ch.toLowerCase ();
				}
			s += ch;
			}
		else {
			if (ch == ' ') { 
				flNextUpper = true;
				}
			}
		}
	return (s);
	}
function hitCounter (counterGroup, counterServer) { //8/12/14 by DW
	var defaultCounterGroup = "scripting", defaultCounterServer = "http://counter.fargo.io/counter";
	var thispageurl = location.href;
	if (counterGroup === undefined) {
		counterGroup = defaultCounterGroup;
		}
	if (counterServer === undefined) {
		counterServer = defaultCounterServer;
		}
	if (thispageurl === undefined) {
		thispageurl = "";
		}
	if (endsWith (thispageurl, "#")) {
		thispageurl = thispageurl.substr (0, thispageurl.length - 1);
		}
	var jxhr = $.ajax ({
		url: counterServer + "?group=" + encodeURIComponent (counterGroup) + "&referer=" + encodeURIComponent (document.referrer) + "&url=" + encodeURIComponent (thispageurl),
		dataType: "jsonp",
		jsonpCallback : "getData",
		timeout: 30000
		})
	.success (function (data, status, xhr) {
		console.log ("hitCounter: counter ping accepted by server.");
		})
	.error (function (status, textStatus, errorThrown) {
		console.log ("hitCounter: counter ping error: " + textStatus);
		});
	}
function stringMid (s, ix, len) { //8/12/14 by DW
	return (s.substr (ix-1, len));
	}
function getCmdKeyPrefix () { //8/15/14 by DW
	if (navigator.platform.toLowerCase ().substr (0, 3) == "mac") {
		return ("&#8984;");
		}
	else {
		return ("Ctrl+"); 
		}
	}
function getRandomSnarkySlogan () { //8/15/14 by DW
	var snarkySlogans = [
		"Good for the environment.", 
		"All baking done on premises.", 
		"Still diggin!", 
		"It's even worse than it appears.", 
		"Ask not what the Internet can do for you...", 
		"You should never argue with a crazy man.", 
		"Welcome back my friends to the show that never ends.", 
		"Greetings, citizen of Planet Earth. We are your overlords. :-)", 
		"We don't need no stinkin rock stars.", 
		"This aggression will not stand.", 
		"Pay no attention to the man behind the curtain.", 
		"Only steal from the best.", 
		"Reallll soooon now...", 
		"What a long strange trip it's been.", 
		"Ask not what the Internet can do for you.", 
		"When in doubt, blog.",
		"Shut up and eat your vegetables.",
		"Don't slam the door on the way out.",
		"Yeah well, that's just, you know, like, your opinion, man.",
		"So, it has come to this."
		]
	return (snarkySlogans [random (0, snarkySlogans.length - 1)]);
	}
function dayOfWeekToString (theDay) { //8/23/14 by DW
	var weekday = [
		"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
		];
	return (weekday[theDay]);
	}
function viewDate (when, flShortDayOfWeek)  {  //8/23/14 by DW
	var now = new Date ();
	when = new Date (when);
	if (sameDay (when, now))  { 
		return (timeString (when, false)) //2/9/13 by DW;
		}
	else  { 
		var oneweek = 1000 * 60 * 60 * 24 * 7;
		var cutoff = now - oneweek;
		if (when > cutoff)   { //within the last week
			var s = dayOfWeekToString (when.getDay ());
			if (flShortDayOfWeek)  { 
				s = s.substring (0, 3);
				}
			return (s);
			}
		else  { 
			return (when.toLocaleDateString ());
			}
		}
	}
function timeString (when, flIncludeSeconds) { //8/26/14 by DW
	var hour = when.getHours (), minutes = when.getMinutes (), ampm = "AM", s;
	if (hour >= 12) {
		ampm = "PM";
		}
	if (hour > 12) {
		hour -= 12;
		}
	if (hour == 0) {
		hour = 12;
		}
	if (minutes < 10) {
		minutes = "0" + minutes;
		}
	if (flIncludeSeconds) { 
		var seconds = when.getSeconds ();
		if (seconds < 10) {
			seconds = "0" + seconds;
			}
		s = hour + ":" + minutes + ":" + seconds + ampm;
		}
	else {
		s = hour + ":" + minutes + ampm;
		}
	return (s);
	}
function stringLastField (s, chdelim) { //8/27/14 by DW
	var ct = stringCountFields (s, chdelim);
	if (ct == 0) { //8/31/14 by DW
		return (s);
		}
	return (stringNthField (s, chdelim, ct));
	}
function maxLengthString (s, maxlength) { //8/27/14 by DW
	if (s.length > maxlength) {
		s = s.substr (0, maxlength);
		while (true) {
			var len = s.length; flbreak = false;
			if (len == 0) {
				break;
				}
			if (s [len - 1] == " ") {
				flbreak = true;
				}
			s = s.substr (0, len - 1);
			if (flbreak) {
				break;
				}
			}
		s = s + "...";
		}
	return (s);
	}
function formatDate (theDate, dateformat, timezone) { //8/28/14 by DW
	if (theDate === undefined) {
		theDate = new Date ();
		}
	if (dateformat === undefined) {
		dateformat = "%c";
		}
	if (timezone === undefined) {
		timezone =  - (new Date ().getTimezoneOffset () / 60);
		}
	try {
		var offset = new Number (timezone);
		var d = new Date (theDate);
		var localTime = d.getTime ();
		var localOffset = d.getTimezoneOffset () *  60000;
		var utc = localTime + localOffset;
		var newTime = utc + (3600000 * offset);
		return (new Date (newTime).strftime (dateformat));
		}
	catch (tryerror) {
		return (new Date (theDate).strftime (dateformat));
		}
	}
function addPeriodToSentence (s) { //8/29/14 by DW
	if (s.length > 0) {
		var fladd = true;
		var ch = s [s.length - 1];
		switch (ch) {
			case "!": case "?": case ":":
				fladd = false;
				break;
			default:
				if (endsWith (s, ".\"")) {
					fladd = false;
					}
				else {
					if (endsWith (s, ".'")) {
						fladd = false;
						}
					}
			}
		if (fladd) {
			s += ".";
			}
		}
	return (s);
	}
function copyScalars (source, dest) { //8/31/14 by DW
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
function linkToDomainFromUrl (url, flshort, maxlength) { //10/10/14 by DW
	var splitUrl = urlSplitter (url), host = splitUrl.host.toLowerCase ();
	if (flshort === undefined) {
		flshort = false;
		}
	if (flshort) {
		var splithost = host.split (".");
		if (splithost.length == 3) {
			host = splithost [1];
			}
		else {
			host = splithost [0];
			}
		}
	else {
		if (beginsWith (host, "www.")) {
			host = stringDelete (host, 1, 4);
			}
		}
	
	if (maxlength != undefined) { //10/10/14; 10:46:56 PM by DW
		if (host.length > maxlength) {
			host = stringMid (host, 1, maxlength) + "...";
			}
		}
	
	return ("<a class=\"aLinkToDomainFromUrl\" href=\"" + url + "\" target=\"blank\">" + host + "</a>");
	}
function getRandomPassword (ctchars) { //10/14/14 by DW
	var s= "", ch;
	while (s.length < ctchars)  {
		ch = String.fromCharCode (random (33, 122));
		if (isAlpha (ch) || isNumeric (ch)) {
			s += ch;
			}
		}
	return (s.toLowerCase ());
	}
function monthToString (theMonthNum) { //11/4/14 by DW
	
	
	var theDate;
	if (theMonthNum === undefined) {
		theDate = new Date ();
		}
	else {
		theDate = new Date ((theMonthNum + 1) + "/1/2014");
		}
	return (formatDate (theDate, "%B"));
	}
function getCanonicalName (text) { //11/4/14 by DW
	var s = "", ch, flNextUpper = false;
	text = stripMarkup (text); //6/30/13 by DW
	for (var i = 0; i < text.length; i++) {
		ch = text [i];
		if (isAlpha (ch) || isNumeric (ch)) {
			if (flNextUpper) {
				ch = ch.toUpperCase ();
				flNextUpper = false;
				}
			else {
				ch = ch.toLowerCase ();
				}
			s += ch;
			}
		else { 
			if (ch == ' ') {
				flNextUpper = true;
				}
			}
		}
	return (s);
	}
function clockNow () { //11/7/14 by DW
	return (new Date ());
	}
function sleepTillTopOfMinute (callback) { //11/22/14 by DW
	var ctseconds = Math.round (60 - (new Date ().getSeconds () + 60) % 60);
	if (ctseconds == 0) {
		ctseconds = 60;
		}
	setTimeout (everyMinute, ctseconds * 1000); 
	}
function scheduleNextRun (callback, ctMillisecsBetwRuns) { //11/27/14 by DW
	var ctmilliseconds = ctMillisecsBetwRuns - (Number (new Date ().getMilliseconds ()) + ctMillisecsBetwRuns) % ctMillisecsBetwRuns;
	setTimeout (callback, ctmilliseconds); 
	}
function urlEncode (s) { //12/4/14 by DW
	return (encodeURIComponent (s));
	}
function popTweetNameAtStart (s) { //12/8/14 by DW
	var ch;
	s = trimWhitespace (s);
	if (s.length > 0) {
		if (s.charAt (0) == "@") {
			while (s.charAt (0) != " ") {
				s = s.substr (1)
				}
			while (s.length > 0) {
				ch = s.charAt (0);
				if ((ch != " ") && (ch != "-")) {
					break;
					}
				s = s.substr (1)
				}
			}
		}
	return (s);
	}
function httpHeadRequest (url, callback) { //12/17/14 by DW
	var jxhr = $.ajax ({
		url: url,
		type: "HEAD",
		dataType: "text",
		timeout: 30000
		})
	.success (function (data, status, xhr) {
		callback (xhr); //you can do xhr.getResponseHeader to get one of the header elements
		})
	}
function httpExt2MIME (ext) { //12/24/14 by DW
	var lowerext = stringLower (ext);
	var map = {
		"au": "audio/basic",
		"avi": "application/x-msvideo",
		"bin": "application/x-macbinary",
		"css": "text/css",
		"dcr": "application/x-director",
		"dir": "application/x-director",
		"dll": "application/octet-stream",
		"doc": "application/msword",
		"dtd": "text/dtd",
		"dxr": "application/x-director",
		"exe": "application/octet-stream",
		"fatp": "text/html",
		"ftsc": "text/html",
		"fttb": "text/html",
		"gif": "image/gif",
		"gz": "application/x-gzip",
		"hqx": "application/mac-binhex40",
		"htm": "text/html",
		"html": "text/html",
		"jpeg": "image/jpeg",
		"jpg": "image/jpeg",
		"js": "application/javascript",
		"mid": "audio/x-midi",
		"midi": "audio/x-midi",
		"mov": "video/quicktime",
		"mp3": "audio/mpeg",
		"pdf": "application/pdf",
		"png": "image/png",
		"ppt": "application/mspowerpoint",
		"ps": "application/postscript",
		"ra": "audio/x-pn-realaudio",
		"ram": "audio/x-pn-realaudio",
		"sit": "application/x-stuffit",
		"sys": "application/octet-stream",
		"tar": "application/x-tar",
		"text": "text/plain",
		"txt": "text/plain",
		"wav": "audio/x-wav",
		"wrl": "x-world/x-vrml",
		"xml": "text/xml",
		"zip": "application/zip"
		};
	for (x in map) {
		if (stringLower (x) == lowerext) {
			return (map [x]);
			}
		}
	return ("text/plain");
	}



//whitelist -- 11/18/14 by DW
	var urlWhitelist = process.env.urlUserWhitelist, userWhitelist = [];
	
	function readUserWhitelist () {
		if (urlWhitelist != undefined) {
			httpReadUrl (urlWhitelist, function (s) {
				try {
					userWhitelist = JSON.parse (s);
					console.log ("readWhitelist: " + userWhitelist.length + " names on the list.");
					}
				catch (err) {
					console.log ("readWhitelist: error parsing whitelist JSON -- \"" + err + "\"");
					}
				});
			}
		}
	function isWhitelistedUser (username) {
		if (urlWhitelist == undefined) { //no whitelist, everyone is whitelisted
			return (true);
			}
		else {
			username = stringLower (username);
			for (var i = 0; i < userWhitelist.length; i++) {
				if (stringLower (userWhitelist [i]) == username) {
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
	
	
function tweetContainsBlockedTag (twitterStatus) { //blocking is not present in this version -- 12/16/14 by DW
	return (false); 
	}


function saveTweet (jsontext) { //7/2/14 by DW
	try {
		var theTweet = JSON.parse (jsontext), idTweet = theTweet.id_str;
		if (idTweet != undefined) { //it would be undefined if there was an error, like "Status is over 140 characters."
			s3NewObject (s3Path + "tweets/" + getDatePath (new Date (), true) + idTweet + ".json", JSON.stringify (theTweet, undefined, 3));
			}
		}
	catch (tryError) {
		console.log ("saveTweet error: " + tryError.message);    
		}
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
				console.log ("getScreenName: error getting name. " + JSON.stringify (error)); 
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
	

function httpReadUrl (url, callback) {
	request (url, function (error, response, body) {
		if (!error && (response.statusCode == 200)) {
			callback (body) 
			}
		});
	}
function shortenUrl (url, callback) {
	httpReadUrl ("http://tinyurl.com/api-create.php?url=" + encodeURIComponent (url), callback);
	}
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
function newTwitter (myCallback) {
	var twitter = new twitterAPI ({
		consumerKey: process.env.twitterConsumerKey,
		consumerSecret: process.env.twitterConsumerSecret,
		callback: myCallback
		});
	return (twitter);
	}
function saveStats () {
	flStatsDirty = false;
	serverStats.ctHoursServerUp = secondsSince (whenServerStart) / 3600; //4/28/14 by DW
	serverStats.ctCurrentLongPolls = waitingLongpolls.length; //12/16/14 by DW
	s3NewObject (s3Path + pathHttpLogFile, JSON.stringify (serverStats, undefined, 3));
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
	
	obj.secs = secondsSince (startTime); 
	serverStats.recentTweets.unshift (obj);  //add at beginning of array
	while (serverStats.recentTweets.length > maxrecentTweets) { //keep array within max size
		serverStats.recentTweets.pop ();
		}
	saveStats ();
	}
function loadServerStats () {
	s3GetObject (s3Path + pathHttpLogFile, function (error, data) { //5/18/14 by DW -- this changed, got a new <i>error</i> parameter. 
		if (data != null) {
			var oldServerStats = JSON.parse (data.Body);
			for (var x in oldServerStats) { 
				if (x != "httpLog") {
					serverStats [x] = oldServerStats [x];
					}
				}
			}
		serverStats.ctHitsThisRun = 0;
		serverStats.ctTweetsThisRun = 0;
		serverStats.whenServerStart = new Date ();
		serverStats.ctServerStarts++;
		});
	}
function getNextUrlString () { //5/10/14 by DW
	var s = serverStats.nextUrlString;
	serverStats.nextUrlString = bumpUrlString (s);
	saveStats ();
	return (s);
	}
function everyMinute () { //6/8/14 by DW
	var now = new Date ();
	if (!sameDay (now, dayForTodaysFeed)) {
		dayForTodaysFeed = now; //a place to add code on rollover
		}
	readUserWhitelist (); //11/18/14 by DW
	}
function getS3UsersPath (flPrivate) { //8/3/14 by DW
	if (getBoolean (flPrivate)) {
		return (s3PrivatePath + "users/");
		}
	else {
		return (s3Path + "users/");
		}
	}
function getS3Acl (flPrivate) { //8/3/14 by DW
	if (getBoolean (flPrivate)) {
		return ("private");
		}
	else {
		return ("public-read");
		}
	}
function getUserFileList (s3path, callback) { //12/21/14 by DW
	var now = new Date (), theList = new Array ();
	s3ListObjects (s3path, function (obj) {
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
		saveStats ();
		}
	}
function everyMinute () {
	}

loadServerStats ();
readUserWhitelist (); //11/18/14 by DW

console.log ();
console.log (myProductName + " v" + myVersion + " running on port " + myPort + ".");
console.log ();

if (flEnabled === undefined) { //11/16/14 by DW
	flEnabled = true;
	}
else {
	flEnabled = getBoolean (flEnabled);
	}

http.createServer (function (httpRequest, httpResponse) {
	try {
		var parsedUrl = urlpack.parse (httpRequest.url, true), now = new Date ();
		var startTime = now, flStatsSaved = false, host, lowerhost, port;
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
					httpResponse.end (JSON.stringify (error));    
					}
				else {
					httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
					addOurDataToReturnObject (data);
					httpResponse.end (JSON.stringify (data, undefined, 4));    
					}
				});
			}
		function errorResponse (error) {
			httpResponse.writeHead (500, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
			httpResponse.end (JSON.stringify (error));    
			}
		function dataResponse (data) { //6/21/14 by DW
			httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
			addOurDataToReturnObject (data);
			httpResponse.end (JSON.stringify (data, undefined, 4));    
			}
		function encode (s) {
			return (encodeURIComponent (s));
			}
		
		//stats
			serverStats.ctHits++;
			serverStats.ctHitsThisRun++;
			serverStats.ctHitsToday++;
			serverStats.version = myVersion;  //2/24/14 by DW
			if (!sameDay (serverStats.today, now)) { //date rollover
				serverStats.today = now;
				serverStats.ctHitsToday = 0;
				serverStats.ctTweetsToday = 0;
				serverStats.ctLongPollsToday = 0;
				}
		//set host, port
			host = httpRequest.headers.host;
			if (stringContains (host, ":")) {
				port = stringNthField (host, ":", 2);
				host = stringNthField (host, ":", 1);
				}
			else {
				port = 80;
				}
			lowerhost = host.toLowerCase ();
		console.log (now.toLocaleTimeString () + " " + httpRequest.method + " " + host + ":" + port + " " + lowerpath);
		
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
										console.log (JSON.stringify (body, undefined, 4));    
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
								var flprivate = getBoolean (parsedUrl.query.flprivate);
								getScreenName (accessToken, accessTokenSecret, function (screenName) {
									if (screenName === undefined) {
										errorResponse ({message: "Can't save the file because the accessToken is not valid."});    
										}
									else {
										var s3path = getS3UsersPath (flprivate) + screenName + "/" + relpath;
										var metadata = {whenLastUpdate: new Date ().toString ()};
										
										
										s3NewObject (s3path, body, type, getS3Acl (flprivate), function (error, data) {
											if (error) {
												errorResponse (error);    
												}
											else {
												metadata.url = "http:/" + s3path;
												dataResponse (metadata);
												serverStats.ctFileSaves++;
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
								whenServerStart: whenServerStart.toUTCString (), 
								hits: serverStats.ctHits, 
								hitsToday: serverStats.ctHitsToday,
								tweets: serverStats.ctTweets,
								tweetsToday: serverStats.ctTweetsToday,
								ctFileSaves: serverStats.ctFileSaves
								};
							httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
							httpResponse.end (JSON.stringify (myStatus, undefined, 4));    
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
								console.log ("The tweet contains a blocked tag: " + twitterStatus);
								httpResponse.writeHead (500, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
								httpResponse.end ("Tweet contains a blocked tag.");    
								}
							else {
								twitter.statuses ("update", params, accessToken, accessTokenSecret, function (error, data, response) {
									if (error) {
										console.log ("There was an error on the tweet: " + JSON.stringify (error));
										httpResponse.writeHead (500, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
										httpResponse.end (JSON.stringify (error));    
										serverStats.ctTweetErrors++;
										}
									else {
										httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
										addOurDataToReturnObject (data);
										httpResponse.end (JSON.stringify (data, undefined, 4));    
										addTweetToLog (data, startTime);
										flStatsSaved = true;
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
									httpResponse.end (JSON.stringify (error));    
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
							var flprivate = getBoolean (parsedUrl.query.flprivate);
							var flIncludeBody = getBoolean (parsedUrl.query.flIncludeBody);
							getScreenName (accessToken, accessTokenSecret, function (screenName) {
								if (screenName === undefined) {
									errorResponse ({message: "Can't get the file because the accessToken is not valid."});    
									}
								else {
									var s3path = getS3UsersPath (flprivate) + screenName + "/" + relpath;
									s3GetObject (s3path, function (error, data) {
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
							var apiKey = "R_4ffde2526ceffd7037116a0871f45eac";
							var username = "dave";
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
									s3GetObject (s3path + "postsData.json", function (error, data) {
										if (error) {
											errorResponse (error);    
											}
										else {
											var postsData = JSON.parse (data.Body.toString ());
											var lastpostnum = postsData.nextfilenum - 1;
											var postsArray = [], ct = 0;
											function getOnePost (postnum) {
												var filepath = s3path + "posts/" + padWithZeros (postnum, 7) + ".json";
												
												
												s3GetObject (filepath, function (error, data) {
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
							httpResponse.end (JSON.stringify (isWhitelistedUser (screenName), undefined, 4));    
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
									httpResponse.end (JSON.stringify (data, undefined, 4));    
									}
								});
							break;
						case "/returnwhenready": //12/15/14 by DW -- long polling
							pushLongpoll (parsedUrl.query.url, httpResponse)
							break;
						case "/stats": //12/16/14 by DW
							httpResponse.writeHead (200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
							httpResponse.end (jsonStringify (serverStats));    
							break;
						case "/getfilelist": //12/21/14 by DW
							var accessToken = parsedUrl.query.oauth_token;
							var accessTokenSecret = parsedUrl.query.oauth_token_secret;
							var flprivate = getBoolean (parsedUrl.query.flprivate);
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
			if (!flStatsSaved) {
				saveStats ();
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
	}).listen (myPort);

setInterval (function () {everySecond ()}, 1000); 
setInterval (function () {everyMinute ()}, 60000); 
