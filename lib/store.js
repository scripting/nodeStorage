var fs = require ("fs");
var mime = require ("mime"); 
var s3 = require ("../lib/s3.js");
var utils = require ("../lib/utils.js");

exports.init = init;
exports.newObject = stNewObject;
exports.getObject = stGetObject;
exports.listObjects = stListObjects;
exports.serveObject = stServeObject;
exports.getUrl = stGetUrl;

var stGlobals = {
	flLocalFileSystem: false,
	publicPath: "",
	privatePath: "",
	basePublicUrl: undefined
	};

var fsStats = {
	ctWrites: 0,
	ctBytesWritten: 0,
	ctWriteErrors: 0,
	ctReads: 0,
	ctBytesRead: 0,
	ctReadErrors: 0
	};



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
function fsNewObject (path, data, type, acl, callback, metadata) {
	fsSureFilePath (path, function () {
		fs.writeFile (path, data, function (err) {
			var dataAboutWrite = {
				};
			if (err) {
				console.log ("fsNewObject: error == " + JSON.stringify (err, undefined, 4));
				fsStats.ctWriteErrors++;
				if (callback != undefined) {
					callback (err, dataAboutWrite);
					}
				}
			else {
				fsStats.ctWrites++;
				fsStats.ctBytesWritten += data.length;
				if (callback != undefined) {
					callback (err, dataAboutWrite);
					}
				}
			}); 
		});
	}
function fsGetObject (path, callback) {
	fs.readFile (path, "utf8", function (err, data) {
		var dataAboutRead = {
			Body: data
			};
		if (err) {
			fsStats.ctReadErrors++;
			}
		else {
			fsStats.ctReads++;
			fsStats.ctBytesRead += dataAboutRead.Body.length;
			}
		callback (err, dataAboutRead);
		});
	}
function fsListObjects (path, callback) {
	function endsWithChar (s, chPossibleEndchar) {
		if ((s === undefined) || (s.length == 0)) { 
			return (false);
			}
		else {
			return (s [s.length - 1] == chPossibleEndchar);
			}
		}
	fs.readdir (path, function (err, list) {
		if (!endsWithChar (path, "/")) {
			path += "/";
			}
		if (list !== undefined) { //6/4/15 by DW
			for (var i = 0; i < list.length; i++) {
				var obj = {
					s3path: path + list [i],
					path: path + list [i], //11/21/14 by DW
					Size: 1
					};
				callback (obj);
				}
			}
		callback ({flLastObject: true});
		});
	}
 

function init (flLocalFileSystem, publicPath, privatePath, basePublicUrl) {
	stGlobals = new Object ();
	stGlobals.flLocalFileSystem = flLocalFileSystem;
	stGlobals.publicPath = publicPath;
	stGlobals.privatePath = privatePath;
	stGlobals.basePublicUrl = basePublicUrl;
	}
function stNewObject (path, data, type, acl, callback, metadata) {
	if (stGlobals.flLocalFileSystem) {
		fsNewObject (path, data, type, acl, callback, metadata);
		}
	else {
		s3.newObject (path, data, type, acl, callback, metadata);
		}
	}
function stGetObject (path, callback) {
	if (stGlobals.flLocalFileSystem) {
		fsGetObject (path, function (error, data) {
			if (error) { //see comment in changes above
				if (error.code == "ENOENT") {
					error.code = "NoSuchKey";
					}
				}
			callback (error, data); //pass the result back up to the caller
			});
		}
	else {
		s3.getObject (path, callback);
		}
	}
function stListObjects (path, callback) {
	if (stGlobals.flLocalFileSystem) {
		fsSureFilePath (path, function () { //7/19/15 by DW -- create the folder if it doesn't exist
			fsListObjects (path, callback);
			});
		}
	else {
		s3.listObjects (path, callback);
		}
	}
function stServeObject (virtualpath, callback) { //7/28/15 by DW
	var physicalpath;
	function extensionToType (path) { 
		var ext = utils.stringLastField (physicalpath, ".");
		mime.default_type = "text/plain";
		return (mime.lookup (ext.toLowerCase ()));
		}
	if (utils.beginsWith (virtualpath, "/")) {
		virtualpath = utils.stringDelete (virtualpath, 1, 1);
		}
	physicalpath = stGlobals.publicPath + virtualpath;
	stGetObject (physicalpath, function (error, data) {
		if (error) {
			callback (500, {"Content-Type": "text/plain"}, utils.jsonStringify (error));
			}
		else {
			callback (200, {"Content-Type": extensionToType (physicalpath)}, data.Body.toString ());
			}
		});
	}
function stGetUrl (physicalpath) {
	if (stGlobals.basePublicUrl !== undefined) {
		var virtualpath = utils.stringDelete (physicalpath, 1, stGlobals.publicPath.length);
		if (!utils.beginsWith (virtualpath, "/")) {
			virtualpath = "/" + virtualpath;
			}
		return (stGlobals.basePublicUrl + virtualpath);
		
		}
	else {
		return ("http:/" + physicalpath);
		}
	}


