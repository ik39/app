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
  }, 1000*60*30); 

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
    console.log("COOL", generatorWindows[generatorName].generatorName);
    
    let result;
    try {
      result = root[listName]+"";
    } catch(e) {
      return "Error: "+e.message;
    }
    
    return result;
  }
  
  (async function() {
    const { Client, Intents } = require('discord.js');
    const client = new Client({intents:[Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES]});

    client.on('ready', function(e){
      console.log(`Logged into Discord as ${client.user.tag}!`);
    });

    client.on('message', async msg => {
      if(msg.content.startsWith("!perch ")) {
        let [generatorName, listName] = msg.content.split(" ").slice(1);
        
        if(generatorName === "<restart>") return process.exit(0);
        
        let result = await getGeneratorResult(generatorName, listName).catch(e => e.message);
        
        result = result.replace(/<b>([^<]+?)<\/b>/g, "**$1**");
        result = result.replace(/<i>([^<]+?)<\/i>/g, "*$1*");
        result = result.replace(/<u>([^<]+?)<\/u>/g, "__$1__");
        result = result.replace(/<br\/?>/g, "\n");
        result = result.replace(/<hr>/g, "~~-                                     -~~");
        result = result.replace(/<hr [^<>]*>/g, "~~-                                     -~~");
        result = result.replace(/<img [^>]*src="([^"]+)"[^>]*>/g, "$1");
        
        // Commenting this out for now because it wouldn't handle nested stuff.
        // result = result.replace(/<p[^>]*>(.*?)<\/p>/g, "$1\n\n");
        // result = result.replace(/<div[^>]*>(.*?)<\/div>/g, "$1\n");
        // result = result.replace(/<span[^>]*>(.*?)<\/span>/g, "$1");
        
        msg.reply(result.trim());
      }
    });

    client.login(process.env.DISCORD_TOKEN);
    process.env.DISCORD_TOKEN = ""; // for safety, because I haven't properly sandboxed JSDOM
  })();
  
})();