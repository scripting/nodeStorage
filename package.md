# Making nodeStorage a real package

In 2020, it's time to make the lowest level module in my system a package. 

### Background

nodeStorage was one of the first modules I wrote in Node, before I started using packages to modularize my work. 

As a result, I created instances of the nodeStorage by downloading the repo, and renaming storage.js. Not a very easy to maintain approach because updating means repeating the initial process, every time. And I often don't do it, and old versions get left laying around. 

Now in 2020 I know all about packages, and it's time to make this a package too. And I can do it without breaking anything. 

### What changed

There's a new file called main.js. It defines the package.  

In package.json the "main" property points to this file, so when you're using the package, that's what you get.

storage.js uses the package, and has the exact functionality of storage.js in previous versions. 

### How to migrate

When it's time to migrate an instance, just repeat the process you used the previous times. 

1. Download the package.

2. The code you need is in the example folder. Copy the two files into your app's folder.

3. Edit app.js to the name of your app, and update package.json accordingly.

4. You can delete the other files.

5. At the command line, enter npm install.

6. You still have to have a config.json file as before. 

Next time you want to update to the latest version, you just have to do an npm update. No changes to files, no renaming things. 

### Test case

I'm doing the test case with the back-end for friends.farm, which is just a nodeStorage instance. 

