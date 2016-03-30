exports.init = init;
exports.doUpdate = doUpdate; 

var fs = require ("fs");
var utils = require ("../lib/utils.js");
var filesystem = require ("../lib/filesystem.js");

var fileList = [
	"storage.js",
	"package.json", 
	"lib/callbacks.js", 
	"lib/filesystem.js",
	"lib/names.js",
	"lib/opml.js", 
	"lib/rss.js", 
	"lib/s3.js", 
	"lib/store.js", 
	"lib/update.js", 
	"lib/utils.js" 
	];

var flEnabled = true;
var urlMyRepo = "https://github.com/scripting/nodeStorage.git";
var pathToRepoFolder = "nodeStorage/";
var fnameStorageJs = "storage.js";
var ctMinutesBetwChecks = 15; //changed from 3 to 15 -- 3/30/16 by DW
var whenLastCheck = undefined;


function init (config) {
	if (config.enabled !== undefined) {
		flEnabled = config.enabled;
		}
	if (config.fnameStorageJs !== undefined) {
		fnameStorageJs = config.fnameStorageJs;
		}
	if (config.ctMinutesBetwChecks !== undefined) {
		ctMinutesBetwChecks = config.ctMinutesBetwChecks;
		}
	}
function doUpdate () {
	if (flEnabled) {
		var flCheck = false;
		
		if (whenLastCheck === undefined) {
			flCheck = true;
			}
		else {
			if (utils.secondsSince (whenLastCheck) >= (ctMinutesBetwChecks * 60)) {
				flCheck = true;
				}
			}
		
		if (flCheck) {
			var simpleGit = require ("simple-git") (), whenStart = new Date ();
			whenLastCheck = whenStart;
			function compareFiles (callback) {
				function doOneFile (ix) {
					if (ix < fileList.length) {
						var forig = fileList [ix], fnew = pathToRepoFolder + forig;
						if (forig === "storage.js") {
							forig = fnameStorageJs;
							}
						fs.readFile (forig, function (err, data) {
							var filetextorig = "";
							if (!err) {
								filetextorig = data.toString ();
								}
							fs.readFile (fnew, function (err, data) {
								if (err) {
									doOneFile (ix + 1);
									}
								else {
									var filetextnew = data.toString ();
									if (filetextnew !== filetextorig) {
										filesystem.sureFilePath (forig, function () {
											fs.writeFile (forig, filetextnew, function (err) {
												console.log ("updates.doUpdate: " + forig);
												doOneFile (ix + 1);
												});
											});
										}
									else {
										doOneFile (ix + 1);
										}
									}
								});
							});
						}
					else {
						if (callback !== undefined) {
							callback ();
							}
						}
					}
				doOneFile (0);
				
				}
			function rmRepoFolder (callback) {
				fs.exists (pathToRepoFolder, function (flExists) {
					if (flExists) {
						filesystem.deleteDirectory (pathToRepoFolder, function () {
							callback ();
							});
						}
					else {
						callback ();
						}
					});
				}
			rmRepoFolder (function () {
				simpleGit.clone (urlMyRepo, pathToRepoFolder, function (err) {
					if (err) {
						console.log ("update.doUpdate: err.message == " + err.message);
						}
					else {
						compareFiles (function () {
							});
						}
					});
				});
			}
		}
	}

