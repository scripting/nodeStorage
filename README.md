### NodeStorage



A simple Amazon S3-based storage system using Twitter identity, implemented in Node.js.



#### How to set up

Andrew Shell wrote a <a href="https://github.com/scripting/storage/wiki/Installing-Storage-on-a-VPS">fantastic guide</a> to setting up a new Storage server on the wiki. 



#### The idea

I wrote a <a href="http://nodestorage.smallpict.com/2015/01/19/whatIsNodestorage.html">backgrounder</a> that explains the philosophy of nodeStorage, what it can be used for and where it's likely to go as it evolves.



#### Demo app

There's a <a href="http://macwrite.org/">demo app</a> which you can try now. 

The <a href="https://github.com/scripting/macwrite">full source</a> for the demo app is available on GitHub.



#### API

The api.js file provides glue for browser-based JavaScript apps. 

You can also access it in api.nodestorage.io and include it from apps if you want. 



#### Breakage alerts

Once an API is done, I believe in no-breakage. I think all changes made from the point where it's complete can be done continuously, meaning old versions of the API can continue to be supported. I do not believe in deprecation. 

However, the API here is not yet frozen, so be on the alert for breakage. But I want to freeze it fairly quickly. Look for this note to disappear. ;-)



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

