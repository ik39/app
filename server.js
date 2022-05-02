(async function() { 
  
  // Hacky way to prevent users' generator errors from crashing this whole node process
  process.on('unhandledRejection', (reason, promise) => {
    // console.log("message", reason.message);
    // console.log("stack", reason.stack);
    if(reason.stack.toString().includes("/jsdom/") || reason.stack.toString().includes("__createPerchanceTree")) {
      console.log(`Unhandled promise rejection:`)
      console.log(reason);
    } else {
      console.error(reason);
      process.exit(1);
    }
  });

  const fetch = require("node-fetch");
  const jsdom = require("jsdom");
  const { JSDOM } = jsdom;
  const express = require("express"); 
  const app = express();

  app.get("/", (request, response) => {
    response.send(`Online.`);
  });
  
  let generatorWindows = {};
  let lastGeneratorUseTimes = {};
  let generatorCacheTimes = {};
  let maxNumberOfGeneratorsCached = 50;
  
  async function makeGeneratorWindow(generatorName) {
    let response = await fetch(`https://perchance.org/api/downloadGenerator?generatorName=${generatorName}&__cacheBust=${Math.random()}`);
    if(!response.ok) throw new Error(`Error: A generator called '${generatorName}' doesn't exist?`);
    let html = await response.text();
    
    const { window } = new JSDOM(html, {runScripts: "dangerously"});
    let i = 0;
    while(!window.root && i++ < 30) await new Promise(r => setTimeout(r, 1000)); // try pausing for up to 20 seconds
    if(!window.root) {
      window.close();
      throw new Error(`Error: Couldn't initialize '${generatorName}' - took too long.`);
    }
    
    return window;
  }
  
  // reboot the server every 30 minutes (in case a generator has an infinite loop or something):
  setTimeout(() => {
    process.exit(0);
  }, 1000*60*35); 

  app.get("/api", async (request, response) => {
    let generatorName = request.query.generator;
    let listName = request.query.list;
    
    let result = await getGeneratorResult(generatorName, listName).catch(e => e.message);
    
    response.send(result);
    console.log(`Served ${result} in response to ?generator=${generatorName}&list=${listName}`);
  }); 
 
  const listener = app.listen(process.env.PORT, () => {
    console.log("Your app is listening on port " + listener.address().port);
  });
  
  async function getGeneratorResult(generatorName, listName) {
    
    // console.log("getGeneratorResult:", generatorWindows[generatorName].generatorName);
    
    if(generatorWindows[generatorName]) {
      // clear cache for this generator if it's stale:
      let result = await fetch("https://perchance.org/api/getGeneratorStats?name="+generatorName).then(r => r.json());
      if(generatorCacheTimes[generatorName] < result.data.lastEditTime) {
        delete generatorWindows[generatorName];
      }
    }
    
    // load and cache generator if we don't have it cached, and trim least-recently-used generator if the cache is too big
    if(!generatorWindows[generatorName]) {
      generatorWindows[generatorName] = await makeGeneratorWindow(generatorName);
      generatorCacheTimes[generatorName] = Date.now();
      lastGeneratorUseTimes[generatorName] = Date.now(); // <-- need this here so this generator doesn't get trimmed by the code below
      if(Object.keys(generatorWindows).length > maxNumberOfGeneratorsCached) {
        let mostStaleGeneratorName = Object.entries(lastGeneratorUseTimes).sort((a,b) => a[1]-b[1])[0];
        delete generatorWindows[generatorName];
        delete lastGeneratorUseTimes[generatorName];
      }
    }
    lastGeneratorUseTimes[generatorName] = Date.now();
    
    let root = generatorWindows[generatorName].root;
    
    if(!listName) {
      if(root.botOutput) listName = "botOutput";
      else if(root.$output) listName = "$output";
      else if(root.output) listName = "output";
      else return `Error: No 'botOutput' or or '$output' or 'output' list in the '${generatorName}' generator?`;
    }
    
    let result;
    try {
      result = root[listName]+"";
    } catch(e) {
      return "Error: "+e.message;
    }
    
    return result;
  }
  
  (async function() {
    const { Client, Intents, MessageAttachment } = require('discord.js');
    const client = new Client({intents:[Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES]});

    client.on('ready', function(e){
      console.log(`Logged into Discord as ${client.user.tag}!`);
    });
    
    let doNotReplyDueToRateLimit = false;
    let needToSendRateLimitWarningWithNextMessage = false;
    client.on('message', async msg => {
      if (msg.author.bot) return;
      
      if(msg.content.startsWith("!perch ")) {
        let [generatorName, listName] = msg.content.split(" ").slice(1);
        
        if(doNotReplyDueToRateLimit) {
          console.error(`Couldn't reply to ${msg.content} due to rate limit.`);
          return;
        }
        
        if(generatorName === "TEST123") {
          const image = 'data:image/gif;base64,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';
          const imageStream = new Buffer(image, 'base64');
          const attachment = new MessageAttachment(imageStream);
          msg.reply({
              content: `test123`,
              files: [attachment],
          });
        }
        
        if(generatorName === "<restart>") return process.exit(0);
        
        let result = await getGeneratorResult(generatorName, listName).catch(e => e.message);
        
        result = result.replace(/<b>([^<]+?)<\/b>/g, "**$1**");
        result = result.replace(/<i>([^<]+?)<\/i>/g, "*$1*");
        result = result.replace(/<u>([^<]+?)<\/u>/g, "__$1__");
        result = result.replace(/<br\/?>/g, "\n");
        result = result.replace(/<hr>/g, "~~-                                     -~~");
        result = result.replace(/<hr [^<>]*>/g, "~~-                                     -~~");
        result = result.replace(/<img [^>]*src="([^"]+)"[^>]*>/g, "$1");
        result = result.replace(/&#160;/g, " ");
        result = result.replace(/&nbsp;/g, " ");
        
        // Commenting this out for now because it wouldn't handle nested stuff.
        // result = result.replace(/<p[^>]*>(.*?)<\/p>/g, "$1\n\n");
        // result = result.replace(/<div[^>]*>(.*?)<\/div>/g, "$1\n");
        // result = result.replace(/<span[^>]*>(.*?)<\/span>/g, "$1");
        
        if(needToSendRateLimitWarningWithNextMessage) {
          result = "(**Note**: Bot is being rate limited by Discord API) " + result;
        }
        
        if(result.length > 2000) {
          // msg.reply(`Error: Result from '${generatorName}' was ${result.length} characters long but must be under 2000 characters due to Discord API limits.`);
          result = result.trim().slice(0, 1900)+" ... (full result was too long)";
        }
        result = result.trim();
        
        let data = await msg.reply(result);
        if(data.retry_after) {
          doNotReplyDueToRateLimit = true;
          needToSendRateLimitWarningWithNextMessage = true;
          setTimeout(() => {doNotReplyDueToRateLimit=false; needToSendRateLimitWarningWithNextMessage=false}, data.retry_after*1000);
        } else {
          needToSendRateLimitWarningWithNextMessage = false;
        }
      }
    });

    client.login(process.env.DISCORD_TOKEN);
    process.env.DISCORD_TOKEN = ""; // for safety, because I haven't properly sandboxed JSDOM
  })();
  
})();