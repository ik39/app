(async function() { 

  const fetch = require("node-fetch");
  const jsdom = require("jsdom");
  const { JSDOM } = jsdom;
  const express = require("express"); 
  const app = express();

  app.get("/", (request, response) => {
    response.send(`
      <div style="font-family: monospace; line-height: 1.4rem;">
        <div>Use <span style="background: #e5e5e5;padding: 0.25rem;"><a style="text-decoration:none; color:inherit;" href="https://${process.env.PROJECT_DOMAIN}.glitch.me/api?generator=animal-sentence&list=output">https://${process.env.PROJECT_DOMAIN}.glitch.me/api?generator=<span style="background:#ffd04a;">animal-sentence</span>&amp;list=<span style="background:#ffd04a;">output</span></a></span> to generate some text. Loading a new generator for the first time will take several seconds, but after that it will be cached and you should be able to generate results quickly.</div>
      </div>
    `);
  });
  
  let generatorWindows = {};
  let lastGeneratorUseTimes = {};
  let maxNumberOfGeneratorsCached = 50;
  
  async function makeGeneratorWindow(generatorName) {
    let html = await fetch(`https://perchance.org/api/downloadGenerator?generatorName=${generatorName}&__cacheBust=${Math.random()}`).then(r => r.text());
    const { window } = new JSDOM(html, {runScripts: "dangerously"});
    if(!window.root) throw new Error(`Error: A generator called '${generatorName}' doesn't exist?`);
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