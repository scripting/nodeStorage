var appConsts = {
	productname: "MacWrite",
	productnameForDisplay: "MacWrite",
	"description": "Test app for Storage project.",
	urlTwitterServer: "http://twitter.macwrite.org:1337/",
	domain: "macwrite.org", 
	version: "0.40"
	}
var appPrefs = {
	ctStartups: 0, minSecsBetwAutoSaves: 3,
	textFont: "Ubuntu", textFontSize: 16, textLineHeight: 24,
	lastTweetText: "", lastUserName: "davewiner"
	};
var flStartupFail = false;
var flPrefsChanged = false;
var whenLastUserAction = new Date ();
var myTextFilename = "myTextFile.txt";

function aboutTestingMenu () {
	alertDialog ("Commands that test an installation of the Storage server.");
	}
function sendATweet () {
	askDialog ("Text of your tweet:", appPrefs.lastTweetText, "Enter the text of your tweet here.", function (s) {
		appPrefs.lastTweetText = s;
		twTweet (s);
		prefsChanged ();
		});
	}
function getUserInfo () {
	askDialog ("Enter a user name:", appPrefs.lastUserName, "The Twitter user you want info about.", function (username) {
		twGetUserInfo (username, function (data) {
			appPrefs.lastUserName = username;
			prefsChanged ();
			console.log (jsonStringify (data)); //all the info is displayed in the console
			alertDialog (data.description);
			});
		});
	}
function getMyMostRecentTweet () {
	twGetUserTweets (localStorage.twUserId, undefined, function (theTweets) {
		console.log (jsonStringify (theTweets)); //all the info is displayed in the console
		if (theTweets.length > 0) {
			alertDialog (theTweets [0].text);
			}
		else {
			alertDialog ("Hey you haven't tweeted yet.");
			}
		});
	}
function applyPrefs () {
	$("#idTextArea").css ("font-family", appPrefs.textFont);
	$("#idTextArea").css ("font-size", appPrefs.textFontSize);
	$("#idTextArea").css ("line-height", appPrefs.textLineHeight + "px");
	prefsChanged ();
	}
function keyupTextArea () {
	}
function getText () {
	return ($("#idTextArea").val ());
	}
function setText (s) {
	$("#idTextArea").val (s);
	}
function saveButtonClick () {
	var now = new Date ();
	twUploadFile (myTextFilename, getText (), "text/plain", true, function (data) {
		console.log ("saveButtonClick: " + data.url + " (" + secondsSince (now) + " seconds)");
		});
	}
function getTextFile () {
	twGetFile (myTextFilename, true, true, function (error, data) {
		if (data != undefined) {
			setText (data.filedata);
			console.log ("getTextFile: data == " + jsonStringify (data));
			}
		else {
			alertDialog ("There was an error getting the text file.");
			}
		});
	}
function showHideEditor () {
	var homeDisplayVal = "none", aboutDisplayVal = "none", startupFailDisplayVal = "none";
	
	if (twIsTwitterConnected ()) {
		if (flStartupFail) {
			startupFailDisplayVal = "block";
			}
		else {
			homeDisplayVal = "block";
			}
		}
	else {
		aboutDisplayVal = "block";
		}
	
	$("#idEditor").css ("display", homeDisplayVal);
	$("#idLogonMessage").css ("display", aboutDisplayVal);
	$("#idStartupFailBody").css ("display", startupFailDisplayVal);
	}
function prefsChanged () {
	flPrefsChanged = true;
	}
function settingsCommand () {
	twStorageToPrefs (function () {
		prefsDialogShow ();
		});
	}
function everySecond () {
	var now = clockNow ();
	twUpdateTwitterMenuItem ("idTwitterConnectMenuItem");
	twUpdateTwitterUsername ("idTwitterUsername");
	pingGoogleAnalytics ();
	showHideEditor ();
	if (flPrefsChanged) {
		twPrefsToStorage ();
		flPrefsChanged = false;
		}
	}
function startup () {
	function initMenus () {
		var cmdKeyPrefix = getCmdKeyPrefix (); //10/6/14 by DW
		document.getElementById ("idMenuProductName").innerHTML = appConsts.productnameForDisplay; 
		document.getElementById ("idMenuAboutProductName").innerHTML = appConsts.productnameForDisplay; 
		$("#idMenubar .dropdown-menu li").each (function () {
			var li = $(this);
			var liContent = li.html ();
			liContent = liContent.replace ("Cmd-", cmdKeyPrefix);
			li.html (liContent);
			});
		twUpdateTwitterMenuItem ("idTwitterConnectMenuItem");
		twUpdateTwitterUsername ("idTwitterUsername");
		}
	console.log ("startup");
	pathAppPrefs = "appPrefs.json"; 
	twStorageData.urlTwitterServer = appConsts.urlTwitterServer;
	$("#idTwitterIcon").html (twStorageConsts.fontAwesomeIcon);
	$("#idVersionNumber").html ("v" + appConsts.version);
	initMenus ();
	hitCounter (); 
	initGoogleAnalytics (); 
	twGetOauthParams ();
	if (twIsTwitterConnected ()) {
		twStorageStartup (function (flGoodStart) {
			flStartupFail = !flGoodStart;
			showHideEditor ();
			if (flGoodStart) {
				appPrefs.ctStartups++;
				prefsChanged ();
				applyPrefs ();
				getTextFile ();
				self.setInterval (function () {everySecond ()}, 1000); 
				}
			});
		}
	else {
		showHideEditor ();
		}
	}
