(async function() { 

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
  let maxNumberOfGeneratorsCached = 50;
  
  async function makeGeneratorWindow(generatorName) {
    let response = await fetch(`https://perchance.org/api/downloadGenerator?generatorName=${generatorName}&__cacheBust=${Math.random()}`);
    if(!response.ok) throw new Error(`Error: A generator called '${generatorName}' doesn't exist?`);
    let html = await response.text();
    const { window } = new JSDOM(html, {runScripts: "dangerously"});
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
    // load and cache generator if we don't have it cached, and trim least-recently-used generator if the cache is too big
    if(!generatorWindows[generatorName]) {
      generatorWindows[generatorName] = await makeGeneratorWindow(generatorName);
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
      else return `Error: No 'botOutput' or 'output' list in the '${generatorName}' generator?`;
    }
    let result = root[listName].toString();
    return result;
  }
  

  const { Client, Intents } = require('discord.js');
  const client = new Client({intents:[Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES]});
  
  client.on('ready', function(e){
    console.log(`Logged into Discord as ${client.user.tag}!`);
  });
  
  client.on('message', async msg => {
    if(msg.content.startsWith("!perch ")) {
      let [generatorName, listName] = msg.content.split(" ").slice(1);
      let result = await getGeneratorResult(generatorName, listName).catch(e => e.message)
      msg.reply(result);
    }
  });
  
  client.login(process.env.DISCORD_TOKEN)
  
})();