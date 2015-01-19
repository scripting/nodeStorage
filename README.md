### NodeStorage

====



A simple Amazon S3-based storage system using Twitter identity, implemented in Node.js.



#### How to set up

Andrew Shell wrote a <a href="https://github.com/scripting/storage/wiki/Installing-Storage-on-a-VPS">fantastic guide</a> to setting up a new Storage server on the wiki. 



#### The idea

<p>Twitter has a great API, but it's designed for server apps. These days I write in-browser JavaScript apps. I wanted an API for Twitter that makes it  easy to quickly develop new apps that run in the browser.</p>

<p>For a while I was making apps that use localStorage, but that data is only available on the local machine. That meant notes on my laptop weren't accessible from my iPad. Not good. So I wanted the ability to store stuff from my JS apps on the net, where all instances of the app would be able to find and edit the data.</p>

<p>So I combined the ability to login via Twitter, that I already had working, with the ability to store stuff on S3. This gave me access to this stuff on the server, so it was simply a matter of crafting a JavaScript API. That's the big idea here. I iterated over the API, and developed a series of <a href="http://scripting.com/2014/07/16/myLatestSoftwareSnacks.html">software snacks</a> that store stuff using this server. So it's not brand-new. It's pretty well broken-in and debugged (knock wood, Praise Murphy).</p>

<p>Look in the <a href="https://github.com/scripting/storage/tree/master/client">client folder</a> to get an idea how a Storage app works. The <a href="https://github.com/scripting/storage/blob/master/client/client.html">demo app</a>, called MacWrite (after the famous and much-loved demo app that came with the original Mac in 1984), is a simple little text <a href="http://macwrite.org/client.html">editor</a> that saves text and prefs via Storage . The API is in <a href="https://github.com/scripting/storage/blob/master/client/twstorage.js">twstorage.js</a>. I plan to write docs for this. When I do they will be linked here. ;-)</p>



#### Parameters

1. twitterConsumerKey

2. twitterConsumerSecret

3. AWS_ACCESS_KEY_ID

4. AWS_SECRET_ACCESS_KEY

5. s3Path

6. s3PrivatePath

7. myDomain

8. longPollTimeoutSecs

9. TZ



#### Setup

1. You have to set up an app on apps.twitter.com. The goal is to get the twitterConsumerKey and twitterConsumerSecret values. That's the connection between Twitter and the Storage app.

2. You need to have the key and secret for AWS. 

3. There are two S3 paths, one for public content and the other for private stuff, specifically user prefs. It's your responsiblity to set up the private storage so that it cannot be accessed over the web. This is easy because it's the default bucket. And the public content has to be publically accessible. The paths should begin and end with slashes.

4. myDomain is a domain that's mapped to the server. Its used in creating the OAuth dance with Twitter. It needs to know how to call us back. 

5. TZ is the timezone the server is running in. I have it set for my server to *America/New_York.*

