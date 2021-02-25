(async function() { 

  const fetch = require("node-fetch");
  const jsdom = require("jsdom");
  const { JSDOM } = jsdom;
  const express = require("express"); 
  const app = express();

  let testingOnlyWarning = `<br><div><span style="color:red; font-weight:bold;">IMPORTANT:</span> This API server is <u>only for testing</u>. It is purposely handicapped to only output up to 10 results per generator, per day (except for the animal-sentence generator). Please follow the instructions <a href="https://perchance.org/diy-perchance-api" target="_blank">here</a> to set up your own server (it's free!), and you'll be able to generate as many results from as many generators as you like :)</div>`;
  app.get("/", (request, response) => {
    response.send(`
      <div style="font-family: monospace; line-height: 1.4rem;">
        <div>Use <span style="background: #e5e5e5;padding: 0.25rem;"><a href="https://${process.env.PROJECT_DOMAIN}.glitch.me/api?generator=animal-sentence&list=output">https://${process.env.PROJECT_DOMAIN}.glitch.me/api?generator=<span style="background:#ffd04a;">animal-sentence</span>&amp;list=<span style="background:#ffd04a;">output</span></a></span> to generate some text. Loading a new generator for the first time will take several seconds, but after that it will be cached and you should be able to generate results quickly.</div>
        ${process.env.PROJECT_DOMAIN === "diy-perchance-api" ? testingOnlyWarning : ""}
      </div>
    `);
  });
  
  
  let generatorWindows = {};
  let lastGeneratorUseTimes = {};
  let maxNumberOfGeneratorsCached = 50;
  
  async function makeGeneratorWindow(generatorName) {
    let html = await fetch(`https://perchance.org/api/downloadGenerator?generatorName=${generatorName}&__cacheBust=${Math.random()}`).then(r => r.text());
    const { window } = new JSDOM(html, {runScripts: "dangerously"});
    return window;
  }
  
  // Testing limits are only enabled if the project name is "diy-perchance-api"
  let testingLimitCount = 10;
  let perGeneratorTestingLimits = {};
  setInterval(() => {
    perGeneratorTestingLimits = {};
  }, 1000*60*60*24);
  
  // reboot the testing server every 30 minutes (in case a generator has an infinite loop or something):
  if(process.env.PROJECT_DOMAIN === "diy-perchance-api") {
    setTimeout(() => {
      process.exit(0);
    }, 1000*60*30); 
  }

  app.get("/api", async (request, response) => {
    let generatorName = request.query.generator;
    let listName = request.query.list;
    
    if(generatorName !== "animal-sentence" && process.env.PROJECT_DOMAIN === "diy-perchance-api") {
      perGeneratorTestingLimits[generatorName] = (perGeneratorTestingLimits[generatorName] || 0) + 1;
      if(perGeneratorTestingLimits[generatorName] > testingLimitCount) {
        console.log(`Served apology in response to ?generator=${generatorName}&list=${listName} because the daily testing limit for ${generatorName} has been reached.`);
        return response.send(`Sorry! The daily testing limit has been reached for the <i>${generatorName}</i> generator. As explained at <a href="https://diy-perchance-api.glitch.me">diy-perchance-api.glitch.me</a>, this server is set up for testing only. You can create your own server for free using Glitch as explained <a href="https://perchance.org/diy-perchance-api" target="_blank">here</a>, and that will allow you to make unlimited requests.`);
      }
    }
    
    // load and cache generator if we don't have it cached, and trim least-recently-used generator if the cache is too big
    if(!generatorWindows[generatorName]) {
      generatorWindows[generatorName] = await makeGeneratorWindow(generatorName);
      if(Object.keys(generatorWindows).length > maxNumberOfGeneratorsCached) {
        let mostStaleGeneratorName = Object.entries(lastGeneratorUseTimes).sort((a,b) => a[1]-b[1])[0];
        delete generatorWindows[generatorName];
        delete lastGeneratorUseTimes[generatorName];
      }
    }
    lastGeneratorUseTimes[generatorName] = Date.now();
    
    let result = generatorWindows[generatorName].root[request.query.list].toString();
    response.send(result);
    console.log(`Served ${result} in response to ?generator=${generatorName}&list=${listName}`);
  }); 
 
  const listener = app.listen(process.env.PORT, () => {
    console.log("Your app is listening on port " + listener.address().port);
  });
  
})();