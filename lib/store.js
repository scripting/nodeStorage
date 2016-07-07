var fs = require ("fs");
var filesystem = require ("../lib/filesystem.js");
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

function init (flLocalFileSystem, publicPath, privatePath, basePublicUrl) {
	stGlobals = new Object ();
	stGlobals.flLocalFileSystem = flLocalFileSystem;
	stGlobals.publicPath = publicPath;
	stGlobals.privatePath = privatePath;
	stGlobals.basePublicUrl = basePublicUrl;
	}
function stNewObject (path, data, type, acl, callback, metadata) {
	if (stGlobals.flLocalFileSystem) {
		if (utils.stringContains (path, "./")) { //7/7/16 by DW
			var err = {
				message: "Can't save the file because the name contains illegal characters."
				};
			callback (err);
			}
		else {
			filesystem.newObject (path, data, type, acl, callback, metadata);
			}
		}
	else {
		s3.newObject (path, data, type, acl, callback, metadata);
		}
	}
function stGetObject (path, callback) {
	if (stGlobals.flLocalFileSystem) {
		filesystem.getObject (path, function (error, data) {
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
function stListObjects (path, callback) { //store.listObjects 
	function fileLister (folderpath, callback) { //3/23/16 by DW
		filesystem.recursivelyVisitFiles (folderpath, function (f) {
			if (f === undefined) { //last file
				callback ({
					flLastObject: true
					});
				}
			else {
				callback ({
					Key: f,
					s3path: f,
					Size: 1
					});
				}
			});
		}
	if (stGlobals.flLocalFileSystem) {
		filesystem.sureFilePath (path, function () { //7/19/15 by DW -- create the folder if it doesn't exist
			fileLister (path, callback);
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
		var internalErrorCode = undefined;
		if (error) {
			if (error.code == "EISDIR") { //path points to a directory, not  a file
				internalErrorCode = 1;
				}
			callback (500, {"Content-Type": "text/plain"}, utils.jsonStringify (error), internalErrorCode);
			}
		else {
			callback (200, {"Content-Type": extensionToType (physicalpath)}, data.Body.toString ());
			}
		});
	}
function stGetUrl (physicalpath) {
	if (stGlobals.basePublicUrl !== undefined) {
		var virtualpath = utils.stringDelete (physicalpath, 1, stGlobals.publicPath.length);
		
		var baseurl = stGlobals.basePublicUrl; //3/22/16 by DW
		if (utils.endsWith (baseurl, "/")) {
			baseurl = utils.stringDelete (baseurl, baseurl.length, 1);
			}
		
		if (!utils.beginsWith (virtualpath, "/")) {
			virtualpath = "/" + virtualpath;
			}
		return (baseurl + virtualpath);
		
		}
	else {
		return ("http:/" + physicalpath);
		}
	}


