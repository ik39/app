(async function() {
  
  const fetch = require("node-fetch");
  
  let lastSeenTime = Date.now();
  while(1) {
    await new Promise(r => setTimeout(r, 1000));
    
    if(Date.now() - lastSeenTime > 1000*30) process.exit();
    
    try {
      let text = await fetch(`https://${process.env.PROJECT_DOMAIN}.glitch.me/status`, {timeout:5000}).then(r => r.text());
      if(text === "Online.") {
        lastSeenTime = Date.now();
        console.log("Seen!");
      }
    } catch(e) {
      console.log(e);
    }
  }
  
})();