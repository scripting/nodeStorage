
exports.callPublishCallbacks = callPublishCallbacks; 
exports.callLikeCallbacks = callLikeCallbacks; //4/24/16 by DW

var fs = require ("fs");
var utils = require ("../lib/utils.js");
var s3 = require ("../lib/s3.js"); //so callbacks can do stuff with S3
var filesystem = require ("../lib/filesystem.js");

var publishCallbacksFolder = "callbacks/publish/"; 
var likeCallbacksFolder = "callbacks/like/"; 

function runUserScript (s, dataforscripts, scriptName) {
	try {
		if (dataforscripts !== undefined) {
			with (dataforscripts) {
				eval (s);
				}
			}
		else {
			eval (s);
			}
		}
	catch (err) {
		console.log ("runUserScript: error running \"" + scriptName + "\" == " + err.message);
		}
	}
function runScriptsInFolder (path, dataforscripts, callback) {
	filesystem.sureFilePath (path, function () {
		fs.readdir (path, function (err, list) {
			if (list !== undefined) { //4/24/16 by DW
				for (var i = 0; i < list.length; i++) {
					var fname = list [i];
					if (utils.endsWith (fname.toLowerCase (), ".js")) {
						var f = path + fname;
						fs.readFile (f, function (err, data) {
							if (err) {
								console.log ("runScriptsInFolder: error == " + err.message);
								}
							else {
								runUserScript (data.toString (), dataforscripts, f);
								}
							});
						}
					}
				}
			if (callback != undefined) {
				callback ();
				}
			});
		});
	}
function callPublishCallbacks (relpath, body, type, screenName) {
	
	
	var dataforscripts = {
		relpath: relpath,
		body: body,
		type: type, 
		screenName: screenName //3/23/16 by DW
		};
	
	runScriptsInFolder (publishCallbacksFolder, dataforscripts, function () {
		});
	}
function callLikeCallbacks (screenName, nameChatLog, item) { //4/24/16 by DW
	var dataforscripts = {
		screenName: screenName,
		nameChatLog: nameChatLog,
		item: item
		};
	runScriptsInFolder (likeCallbacksFolder, dataforscripts, function () {
		});
	}
