### nodeStorage



A simple server-side JavaScript storage system using Twitter identity, running in Node.js. 



#### Overview

1. Public and private data. 

3. Store data in local filesystem or on Amazon S3.

2. User identity through Twitter. 

4. The back-end of an open source blogging system, with <a href="http://myword.io/editor/">MyWord Editor</a> as the front-end. 

5. Written by <a href="http://davewiner.com/">Dave Winer</a>, first deployed in June 2014, supports a <a href="http://scripting.com/2014/07/16/myLatestSoftwareSnacks.html">small set</a> of browser-based JavaScript software. Hope to expand to become a community of apps. 

#### How to set up

Here's <a href="http://nodestorage.smallpict.com/2015/08/05/installingNodestorageOnUbuntu.html">quick guide</a> to setting up a nodeStorage server on Ubuntu, but probably works on many other Unix systems. It doesn't assume you have Node.js installed or a Git client. It shows you how to set up a connection with Twitter. It stores user data, both public and private, in the filesystem of the Ubuntu machine. 

It's a good guide for installing on any Unix system, but has been tested on Ubuntu.

#### Links

1. I wrote a <a href="http://nodestorage.smallpict.com/2015/01/19/whatIsNodestorage.html">backgrounder</a> that explains the philosophy of nodeStorage, what it can be used for and where it's likely to go as it evolves.

2. 1999.io, my new blogging system, is a nodeStorage app and it has streamlined <a href="https://github.com/scripting/1999-project/blob/master/docs/setup.md">setup instructions</a>. 

2. A <a href="http://scripting.com/2015/01/23/nodestorageNow.html">blog post</a> provides another perspective.

3. Andrew Shell wrote a <a href="https://github.com/scripting/storage/wiki/Installing-Storage-on-a-VPS">guide</a> to setting up a new nodeStorage server. 

4. Marco Fabbri wrote a <a href="https://github.com/scripting/nodeStorage/wiki/Installing-nodeStorage-on-Heroku">howto</a> for Heroku server setup. 

5. <a href="http://nodestorage.smallpict.com/2015/08/07/whyUseTwitterForIdentity.html">Why use Twitter for identity?</a>

#### Demo app #1

1. A minimal <a href="http://macwrite.org/">demo app</a>. 

2. The <a href="https://github.com/scripting/macwrite">full source</a> for the demo app is available on GitHub. MIT License.

#### Demo app #2

1. <a href="http://myword.io/editor/">MyWord Editor</a> is a simple and <a href="http://myword.io/users/davewiner/essays/045.html">beautiful</a> blogging system. 

2. It's fully <a href="https://github.com/scripting/myWordEditor">open source</a>, MIT License. 

3. The back-end is nodeStorage. 

#### API

<a href="https://github.com/scripting/nodeStorage/blob/master/api.js">api.js</a> file provides glue for browser-based JavaScript apps. 

You can also access it in <a href="http://api.nodestorage.io/api.js">api.nodestorage.io</a> and include it from apps if you want. 

#### Updates

##### v0.95b - 7/20/16 by DW

Replaced calls to "encode" in encodeURIComponent with handleHttpRequest. This helped resolve an <a href="https://github.com/scripting/nodeStorage/issues/4">issue</a> Don Park was having on his system. 

##### v0.95a - 7/17/16 by DW

A problem showed up in Safari only, on a customized menu, on a site with a custom URL. 

When we get the HTML of the menu from the server, it redirects from the long URL to the short one, as if we were a user coming in through a web browser.

This works fine in Chrome, the $.ajax call in the browser just redirects, but not in Safari. A search turns up several Stack Exchange articles that say that Apple believes the HTML 5 spec tells them to work this way. Whatever. 

So I added support for a new param on a request, noredirect, if it's true, we don't do the redirect, we just return the content of the object requested (the HTML of the menu in this case) without redirecting. 

Amazingly it worked. ;-)

Here's the <a href="http://lo.1999.io/2016/07/17/0008.html">page</a> that illustrated the problem, but I've seen it on other sites before, didn't have the time to chase it down.

##### v0.94w - 6/25/16 by DW

New config.json value -- url404page. It points to an HTML page that's returned when a 404 error is generated. 

Previously we'd return a 500 error where we should have returned 404, and the page we displayed showed the contents of a <a href="http://scripting.com/2016/06/25/randomJson.png">JSON struct</a>. Now It gives you a plain 404 "not found" message, and gives you the opportunity to override the default choice. 

Here's an <a href="https://gist.github.com/scripting/11e3df5a975585b166d1b4cb8a5918a9">example</a> of a config.json that specified a 404 page. 

##### v0.93 - 4/3/16 by DW

Added a call to ping the "community server" when the RSS feed updates in addition to the rssCloud server. See lib/rss.js for details.

##### v0.92 - 3/26/16 by DW

Sorry for the lack of update notes. What's been going on has been the development of nodeStorage as a server for 1999.io. 

At this point the server should be as easy to install as it was previously, after some docs are written, and from here-out I plan to keeop the update notes current with the development work.

##### v0.79 - 9/9/15 by DW

In the new chat functionality, when we return from a longpoll, we used to send back the entire chatlog. This is not very efficient, esp over a mobile connection. Now we only send back the new item that caused us to return. See postChatMessage for the change. 

##### v0.78 - 9/3/15 by DW

New routines support a basic chat capability.

Slack-compatible incoming and outgoing webhooks.

Can be configured to watch for a change to the mod date of storage.js, which causes it to quit (presumably to be relaunched by the OS or forever). Makes installing updates automatic.

By default, longpolls timeout after 60 seconds, previously it was 20 seconds.

The everyMinute script now runs at the top of the minute. Previously it was a function of when the app was launched. It also announces itself with the current time and the version of nodeStorage.

##### v0.77 - 7/29/15 by DW

We can now store user data in the local file system. Previous versions could only store data in Amazon S3. The changes are documented in <a href="http://nodestorage.smallpict.com/2015/07/29/nodestorageInTheFilesystem.html">this post</a>. 

##### v0.75 - 7/15/15 by DW

New functionality to support named outlines. 

##### v0.74 - 5/20/15 by DW

Fixed an error in the way whitelists are specified. 

##### v0.73 - 5/10/15 by DW

<a href="http://storage.smallpict.com/2015/05/10/newWayToConfigureNodestorage.html">A new way</a> to configure nodeStorage, with a config.json file.

##### v0.72 - 3/5/15 by DW

The /getfilelist endpoint now returns an array of objects, one for each file, as before. The objects contain three values, <i>path, whenLastChange</i> and <i>ctChars.</i> 

Previously we were  returning the array that S3 returns to us. The file paths it returns are not easily used by a client. 

There is a possibility of breakage if you had built on this endpoint, but given its previous state, it's hard to imagine anyone doing that. ;-)

##### v0.66 -1/29/15 by DW

New stats for longpolling, in serverStats.json. <a href="http://liveblog.co/data/serverStats.json">Example</a>. Gives us a way to see how many people are watching resources managed by a nodeStorage server.

##### v0.65 -1/24/15 by DW

Added a readout of free memory as the second item in the server log. 

In this <a href="http://scripting.com/2015/01/24/freemem.png">screen shot</a> the arrow points to the free memory readout. 

#### Questions, problems

Please post a note on the <a href="https://groups.google.com/forum/?fromgroups#!forum/server-snacks">server-snacks</a> mail list. 

