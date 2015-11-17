
exports.callPublishCallbacks = callPublishCallbacks; 

var fs = require ("fs");
var utils = require ("../lib/utils.js");
var s3 = require ("../lib/s3.js"); //so callbacks can do stuff with S3

var publishCallbacksFolder = "callbacks/publish/"; 

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
	function fsSureFilePath (path, callback) { 
		var splits = path.split ("/");
		path = ""; //1/8/15 by DW
		if (splits.length > 0) {
			function doLevel (levelnum) {
				if (levelnum < (splits.length - 1)) {
					path += splits [levelnum] + "/";
					fs.exists (path, function (flExists) {
						if (flExists) {
							doLevel (levelnum + 1);
							}
						else {
							fs.mkdir (path, undefined, function () {
								doLevel (levelnum + 1);
								});
							}
						});
					}
				else {
					if (callback != undefined) {
						callback ();
						}
					}
				}
			doLevel (0);
			}
		else {
			if (callback != undefined) {
				callback ();
				}
			}
		}
	fsSureFilePath (path, function () {
		fs.readdir (path, function (err, list) {
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
			if (callback != undefined) {
				callback ();
				}
			});
		});
	}
function callPublishCallbacks (relpath, body, type) {
	
	var dataforscripts = {
		relpath: relpath,
		body: body,
		type: type
		};
	
	runScriptsInFolder (publishCallbacksFolder, dataforscripts, function () {
		});
	}
