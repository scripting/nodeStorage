var s3 = require ("../lib/s3.js");
var utils = require ("../lib/utils.js");
var opml = require ("../lib/opml.js");

exports.init = init;
exports.isNameAvailable = isNameAvailable; 
exports.reserveName = reserveName; 
exports.lookupName = lookupName;
exports.serveThroughName = serveThroughName;

var s3NamesPath;

function init (s3Path) {
	console.log ("names.init: s3Path == " + s3Path);
	s3NamesPath = s3Path + "names/";
	}
function cleanName (name) {
	if (name === undefined) {
		return ("");
		}
	else {
		var s = "";
		for (var i = 0; i < name.length; i++) {
			var ch = name [i];
			if (utils.isAlpha (ch) || utils.isNumeric (ch)) {
				s += ch;
				}
			}
		return (s.toLowerCase (s));
		}
	}
function isNameAvailable (name, callback) {
	name = cleanName (name);
	if (name.length == 0) {
		callback (name, false, "The name is empty.");
		}
	else {
		if (name.length < 4) {
			callback (name, false, "The name must be at least 4 characters.");
			}
		else {
			var namepath = s3NamesPath + name + ".json";
			s3.getObjectMetadata (namepath, function (metadata) {
				console.log ("isNameAvailable: namepath == " + namepath + ", metadata == " + JSON.stringify (metadata));
				if (metadata === null) {
					callback (name, true, "The name is available.");
					}
				else {
					callback (name, false, "The name is not available.");
					}
				});
			}
		}
	}
function reserveName (name, url, owner, callback) {
	name = cleanName (name);
	if (name.length < 4) {
		callback (name, false, "The name must be at least 4 characters.");
		}
	else {
		isNameAvailable (name, function (name, flAvailable, msg) {
			if (flAvailable) {
				var path = s3NamesPath + name + ".json"
				var metadata = {
					"name": name,
					"opmlUrl": url,
					"owner": owner,
					"whenCreated": new Date ().toString ()
					};
				s3.newObject (path, utils.jsonStringify (metadata), "application/json", "private", function (err, data) {
					console.log ("reserveName: path == " + path);
					if (err) {
						callback (name, false, err.message);
						}
					else {
						callback (name, true, "");
						}
					});
				}
			else {
				callback (name, false, "The name \"" + name + "\" is already in use.");
				}
			});
		}
	}
function lookupName (name, callback) {
	name = cleanName (name);
	var path = s3NamesPath + name + ".json"
	s3.getObject (path, function (error, data) {
		if (data != null) {
			callback (JSON.parse (data.Body));
			}
		else {
			callback ({
				name: name,
				opmlUrl: undefined,
				owner: undefined,
				whenCreated: undefined
				});
			}
		});
	}
function serveThroughName (host, port, httpRequest, userDomain, callback) {
	var whenstart = new Date ();
	function getNameFromSubdomain (subdomain) {
		var sections = subdomain.split (".");
		return (sections [0]);
		}
	if (userDomain === undefined) {
		callback (false);
		}
	else {
		var forwardedhost = httpRequest.headers ["x-forwarded-host"];
		if (forwardedhost !== undefined) {
			if (utils.endsWith (forwardedhost, userDomain)) {
				var name = getNameFromSubdomain (forwardedhost);
				lookupName (name, function (data) {
					if (data.opmlUrl === undefined) {
						callback (true, 404, "text/plain", "Couldn't read the outline because the name \"" + name + "\" is not defined.");
						}
					else {
						opml.readOpmlUrl (data.opmlUrl, function (theOutline) {
							if (theOutline === undefined) {
								callback (true, 404, "text/plain", "Couldn't read the outline at url == \"" + data.opmlUrl + ".\"");
								}
							else {
								console.log ("names.serveThroughName: name == " + name + ", url = " + data.opmlUrl + ", " + utils.secondsSince (whenstart) + " secs.");
								callback (true, 200, "application/json", utils.jsonStringify (theOutline));
								}
							});
						}
					});
				return;
				}
			}
		callback (false);
		}
	}

