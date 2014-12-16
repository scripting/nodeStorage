storage
=======

A simple Amazon S3-based storage system based on Twitter identity implemented in Node.js.

<h4>Parameters</h4>
<ul>
<li>twitterConsumerKey
<li>twitterConsumerSecret
<li>AWS_ACCESS_KEY_ID
<li>AWS_SECRET_ACCESS_KEY
<li>s3Path
<li>s3PrivatePath
<li>myDomain
<li>TZ
</ul>

<h4>Setup</h4>
1. You have to set up an app on dev.twitter.com. The goal is to get the xxx and xxx values. That's the connection between Twitter and the Storage app.
2. You need to have the key and secret for AWS. 
3. There are two S3 paths, one for public content and the other for private stuff, specifically user prefs. It's your responsiblity to set up the private storage so that it cannot be accessed over the web. This is easy because it's the default bucket. And the public content has to be publically accessible. The paths should begin and end with slashes.
4. mydomain is a domain that's mapped to the server. Its used in creating the OAuth dance with Twitter. It needs to know how to call us back. 
5. TZ is the timezone the server is running in. I have it set for my server to *America/New_York.*

