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
    response.send(`Hi.`);
  });
  app.get("/status", (request, response) => {
    console.log("Responded to status request.");
    response.send(`online`);
  });
  
  let generatorWindows = {};
  let lastGeneratorUseTimes = {};
  let generatorCacheTimes = {};
  let maxNumberOfGeneratorsCached = 100;
  
  async function makeGeneratorWindow(generatorName) {
    let response = await fetch(`https://perchance.org/api/downloadGenerator?generatorName=${generatorName}&__cacheBust=${Math.random()}`);
    if(!response.ok) throw new Error(`Error: A generator called '${generatorName}' doesn't exist?`);
    let html = await response.text();
    
    const { window } = new JSDOM(html, {runScripts: "dangerously"});
    let i = 0;
    while(!window.root && i++ < 30) await new Promise(r => setTimeout(r, 1000)); // try pausing for up to 30 seconds
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
  
  let lastEditTimeCache = {};
  async function getGeneratorResult(generatorName, listNameOrCode, variableAssignments=[]) {
    
    // NOTE: if listNameOrCode starts with "~>", then it's interpretted as code
    
    // console.log("getGeneratorResult:", generatorWindows[generatorName].generatorName);
    
    if(generatorWindows[generatorName] && (!lastEditTimeCache[generatorName] || Date.now()-lastEditTimeCache[generatorName] > 3000)) {
      // clear cache for this generator if it's stale:
      let result = await fetch("https://perchance.org/api/getGeneratorStats?name="+generatorName).then(r => r.json());
      lastEditTimeCache[generatorName] = result.data.lastEditTime;
      if(generatorCacheTimes[generatorName] < result.data.lastEditTime) {
        generatorWindows[generatorName].close();
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
        generatorWindows[generatorName].close();
        delete generatorWindows[generatorName];
        delete lastGeneratorUseTimes[generatorName];
      }
    }
    lastGeneratorUseTimes[generatorName] = Date.now();
    
    let window = generatorWindows[generatorName];
    let root = window.root;
    
    for(let [name, value] of variableAssignments) {
      console.log("variableAssignment:", name, value);
      // `name` can be something like "city.stats.population" or "inputEl.value"
      let w = window;
      let r = root;
      let parts = name.split(".");
      let lastPart = parts.pop();
      for(let n of parts) {
        if(w) w = w[n];
        if(r) r = r[n];
      }
      if(w) w[lastPart] = value;
      if(r) r[lastPart] = value;
    }
    
    if(listNameOrCode.startsWith("~>")) {
      return window.String(listNameOrCode.slice(2)).evaluateItem;
    } else {
      if(!listNameOrCode) {
        if(root.botOutput) listNameOrCode = "botOutput";
        else if(root.$output) listNameOrCode = "$output";
        else if(root.output) listNameOrCode = "output";
        else return `Error: No 'botOutput' or or '$output' or 'output' list in the '${generatorName}' generator?`;
      }
      let result;
      try {
        let r = root;
        let parts = listNameOrCode.split(".");
        let lastPart = parts.pop();
        for(let n of parts) {
          if(r) r = r[n];
        }
        result = r[lastPart]+"";
      } catch(e) {
        return "Error: "+e.message;
      }
      return result;
    }
    
  }
  
  (async function() {
    // const Canvas = require('canvas'); // for image stuff like image-layer-combiner-plugin
    const skiaCanvas = require('skia-canvas');
    
    const { Client, Intents, MessageAttachment } = require('discord.js');
    const client = new Client({intents:[Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES]});

    client.on('ready', function(e){
      console.log(`Logged into Discord as ${client.user.tag}!`);
    });
    
    let doNotReplyDueToRateLimit = false;
    let needToSendRateLimitWarningWithNextMessage = false;
    client.on('message', async msg => {
      if (msg.author.bot) return;
      
      let messageContent = msg.content;
      
      let questionMatch = messageContent.trim().match(/[Pp]erch,.+ ?\((.+)\)$/);
      if(!questionMatch) {
        // use the default `yesno` generator
        questionMatch = (messageContent.trim()+" (yesno)").match(/[Pp]erch,.+ ?\((.+)\)$/);
      }
      
      let googleSearchFoundGenerator;
      
      
      if(messageContent.startsWith("!perch ") || questionMatch) {
        console.log("messageContent:", messageContent);
        
        let command;
        
        if(questionMatch) command = questionMatch[1];
        else command = messageContent.split(" ").slice(1).join(" ");
        
        // `command` is now the code without the "!perch" part
        
        // This allows people to run google/bing/etc. search to get the generator name
        //   !perch >cool dnd item or something
        if(command.startsWith(">")) {
          let errorCodes = [];
          let result;
          result = await fetch(`https://google.com/search?q=${command.slice(1).replaceAll(" ", "+")}+site%3Aperchance.org`, {headers:browserEmulationFetchHeaders}).then(r => r.ok ? r.text() : r.status);
          if(typeof result === "number") {
            console.error("Failed to get Google search result.", result);
            errorCodes.push(result);
            result = await fetch(`https://www.bing.com/search?q=${command.slice(1).replaceAll(" ", "+")}+site%3Aperchance.org`, {headers:browserEmulationFetchHeaders}).then(r => r.ok ? r.text() : r.status);
          }
          if(typeof result === "number") {
            console.error("Failed to get Bing search result.", result);
            errorCodes.push(result);
            result = await fetch(`https://duckduckgo.com/?q=${command.slice(1).replaceAll(" ", "+")}+site%3Aperchance.org`, {headers:browserEmulationFetchHeaders}).then(r => r.ok ? r.text() : r.status);
          }
            
          if(typeof result == "number") {
            await msg.reply(`Failed to get search result. Error codes: ${errorCodes.join(", ")}`);
            return;
          }
          
          let match = result.match(/https:\/\/perchance.org\/([a-z0-9\-]+)/);
          if(match) {
            command = match[1].split("?")[0]; // split at `?` just in case it has url parameters for some reason
            googleSearchFoundGenerator = command;
          } else {
            await msg.reply(`Failed to get search result.`);
            return;
          }
        }
        
        // This allows people to replace the list name with some custom code:
        //   !perch generator:<The [animal] sat on the [object]> ...
        let customCodeToBeExecuted;
        let customCodeMagicListName = "___customCode8375026739258723__";
        if(command.split(" ")[0].includes(":<")) {
          try {
            customCodeToBeExecuted = command.split(":<")[1].split(">")[0];
            command = command.replace(":<"+customCodeToBeExecuted+">", ":"+customCodeMagicListName); // replace with a fake list name that no one will use, and we'll detect this list name at the and and run the custom code instead
          } catch(e) {
            console.error(e);
          }
        }
        
        let [generatorNameColonListName, ...variableAssignments] = command.split(" ");
        
        if(variableAssignments.length === 1 && variableAssignments[0] === "%reset") {
          generatorWindows[generatorNameColonListName].close();
          delete generatorWindows[generatorNameColonListName];
          await msg.reply(`Deleted '${generatorNameColonListName}' from the cache.`);
          return;
        }
        
        let [generatorName, listNameOrCode] = generatorNameColonListName.split(":");
        
        let itIsACustomCodeExecutionCommand = false;
        if(listNameOrCode === customCodeMagicListName) {
          itIsACustomCodeExecutionCommand = true;
          listNameOrCode = "~>"+customCodeToBeExecuted; // "~>" is the market that tells getGeneratorResult that it's code
          variableAssignments = []; // <-- these are no actually variable assignments
        }
        
        console.log(generatorName, listNameOrCode, variableAssignments);
        
        // if(generatorName.startsWith("https://perchance.org/")) generatorName.replace("https://perchance.org/", "");
        
        for(let vaString of variableAssignments) {
          if(!vaString.includes("=")) {
            await msg.reply(`Your command should be formatted like these examples:\n\`\`\`!perch generator-name\`\`\`or:\n\`\`\`!perch generator-name:listName\`\`\`or:\n\`\`\`!perch generator-name:listName variable1=value variable2.thing=value\`\`\`\nor:\`\`\`!perch generator-name:listName %n=3\`\`\``);
            return;
          }
        }
        
        variableAssignments = variableAssignments.map(va => va.split("="));
        for(let va of variableAssignments) {
          if(String(Number(va[1])) === va[1]) va[1] = Number(va[1]);
          else if(va[1] === "true") va[1] = true;
          else if(va[1] === "false") va[1] = false;
          
          
          if(typeof va[1] === "string") va[1] = va[1].replace(/\\n/g, "\n"); // so people can set e.g. textarea inputs that have multiple lines
        }
        
        let specialVariables = variableAssignments.filter(e => e[0].startsWith("%")).map(e => [e[0].slice(1), e[1]]);
        variableAssignments = variableAssignments.filter(e => !e[0].startsWith("%"));
        
        // console.log("specialVariables:", specialVariables);
        // console.log("variableAssignments:", variableAssignments);
        
        let specialVariableMap = specialVariables.reduce((a,v) => (a[v[0]]=v[1], a), {});
        
        // console.log("specialVariableMap:", specialVariableMap);
        
        if(doNotReplyDueToRateLimit) {
          console.error(`Couldn't reply to ${msg.content} due to rate limit.`);
          return;
        }
        
        if(generatorName === "%reset") {
          await msg.reply(`The bot has been reset.`);
          return process.exit(0);
        }
        
        let n = specialVariableMap.n || 1;
        if(typeof n !== "number") n = 1;
        if(n < 1) n = 1;
        if(n > 100) n = 100;
        
        let joiner = "\n";
        
        let result = "";
        for(let i = 0; i < n; i++) {
          let r = await getGeneratorResult(generatorName, listNameOrCode, variableAssignments).catch(e => e.message);
          result += r.trim() + joiner;
        }
        
        // convert image data URLs to attachements
        let files = [];
        let base64Arr = [...result.matchAll(/data:image\/.{1,7};base64,(.+?)(?:["'\s]|$)/g)].map(m => m[1]);
        for(let base64 of base64Arr.slice(0, 10)) {
          files.push( Buffer.from(base64, 'base64') );
        }
        
        
        for(let match of result.matchAll(/data-bot-indicator="---color-palette-plugin-output---" data-colors="([^"]+)"/g)) {
          let colors = decodeURIComponent(match[1]).split("<|||>");
          
          let width = 500;
          let height = 100;
          
          const canvas = new skiaCanvas.Canvas(width, height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, width, height);
          
          let segmentWidth = width / colors.length;
          
          let i = 0;
          for(let color of colors) {
            ctx.fillStyle = color;
            ctx.fillRect(segmentWidth*i, 0, segmentWidth, height);
            i++;
          }

          let dataUrl = await canvas.toDataURL('png');
          files.push( Buffer.from(dataUrl.split(",")[1], 'base64') );
          
          // note this regex is WITHOUT the g flag, so we only remove/replace one instance - i.e. the one we just processed.
          result = result.replace(/<div data-bot-indicator="---color-palette-plugin-output---".*?>.+?<\/div>/s, `Colors: ${colors.join(" ")}`);
        }
        
        // convert image-layer-combiner-plugin images to attachments:
        for(let match of result.matchAll(/data-bot-indicator="---image-layer-combiner-plugin-output---" data-image-urls="([^"]+)" data-image-filters="([^"]+)" data-width="([^"]*)" data-height="([^"]*)"/g)) {
          let urls = decodeURIComponent(match[1]).split("<|||>");
          let filters = decodeURIComponent(match[2]).split("<|||>");
          
          let width = Number(match[2] ? match[3].slice(0, -2) : 0) || 400; // slice to remove "px"
          let height = Number(match[3] ? match[4].slice(0, -2) : 0) || null;
          
          let canvasImages = await Promise.all(urls.map(url => skiaCanvas.loadImage(url)));
          
          if(!height) height = Math.round((width/canvasImages[0].width) * canvasImages[0].height);
          
          // since we want to draw the bottom layers first:
          canvasImages.reverse();
          filters.reverse();
          
          // console.log(filters);
          
          const canvas = new skiaCanvas.Canvas(width, height);
          const ctx = canvas.getContext('2d');
          
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, width, height);
          
          let i = 0;
          for(let img of canvasImages) {
            ctx.filter = filters[i++] || "none";
            ctx.drawImage(img, 0, 0, width, height);
          }

          let dataUrl = await canvas.toDataURL('jpeg');
          files.push( Buffer.from(dataUrl.split(",")[1], 'base64') );
        }
        result = result.replace(/<div data-bot-indicator="---image-layer-combiner-plugin-output---".+?>.+?<\/div>/gs, "");
        
        result = result.replace(/<b>([^<]+?)<\/b>/g, "**$1**");
        result = result.replace(/<i>([^<]+?)<\/i>/g, "*$1*");
        result = result.replace(/<u>([^<]+?)<\/u>/g, "__$1__");
        result = result.replace(/<br ?\/?>/g, "\n");
        result = result.replace(/<hr>/g, "~~-                                     -~~");
        result = result.replace(/<hr [^<>]*>/g, "~~-                                     -~~");
        result = result.replace(/<img [^>]*src=['"]data:image\/([^"']+)['"][^>]*>/g, ""); // we've already processed the data urls above, so we remove them
        result = result.replace(/<img [^>]*src=['"]([^"']+)['"][^>]*>/g, " $1 ");
        result = result.replace(/<a [^>]*href=['"]([^"']+)['"][^>]*>([^<]+)<\/a>/g, "$2: $1 ");
        result = result.replace(/&#160;/g, " ");
        result = result.replace(/&nbsp;/g, " ");
        
        if(result.includes("</")) {
          const { window } = new JSDOM(`<!DOCTYPE html><html><body>${result}</body><html>`);
          result = window.document.body.textContent;
          window.close();
        }
        
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
        
        if(googleSearchFoundGenerator) result = `**${googleSearchFoundGenerator}:** ` + result;
        
        let data = await msg.reply({
          content: result || " ",
          files,
        });
        
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

var browserEmulationFetchHeaders = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.41 Safari/537.36",
  "accept": "*/*",
  "accept-language": "en-AU,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,pt;q=0.6",
  "sec-ch-dpr": "2",
  "sec-ch-ua": "\" Not A;Brand\";v=\"99\", \"Chromium\";v=\"101\", \"Google Chrome\";v=\"101\"",
  "sec-ch-ua-arch": "\"x86\"",
  "sec-ch-ua-bitness": "\"64\"",
  "sec-ch-ua-full-version": "\"101.0.4951.41\"",
  "sec-ch-ua-full-version-list": "\" Not A;Brand\";v=\"99.0.0.0\", \"Chromium\";v=\"101.0.4951.41\", \"Google Chrome\";v=\"101.0.4951.41\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-model": "",
  "sec-ch-ua-platform": "\"Linux\"",
  "sec-ch-ua-platform-version": "\"5.16.19\"",
  "sec-ch-ua-wow64": "?0",
  "sec-ch-viewport-width": "714",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "Referer": "https://www.google.com/",
  "Referrer-Policy": "origin"
};