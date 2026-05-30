const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'supabase', 'functions');
const functions = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isDirectory());

let updatedCount = 0;

for (const func of functions) {
  const indexFile = path.join(dir, func, 'index.ts');
  if (fs.existsSync(indexFile)) {
    let content = fs.readFileSync(indexFile, 'utf8');
    
    // Check if the file queries system_settings for API keys
    // Wait, some functions like system-payout-v1 update it, which MUST NOT use the view
    // So we only replace .from("system_settings").select(
    // or .from('system_settings').select(
    
    if (func === 'system-payout-v1') {
       console.log("Skipping system-payout-v1 for regex replacement, we will do it manually.");
       continue;
    }
    
    let originalContent = content;
    content = content.replace(/\.from\(\s*["']system_settings["']\s*\)\s*\.select\(/g, '.from("v_system_settings_with_secrets").select(');
    
    if (content !== originalContent) {
      fs.writeFileSync(indexFile, content, 'utf8');
      updatedCount++;
      console.log(`Updated ${func}/index.ts`);
    }
  }
}

console.log(`Updated ${updatedCount} edge functions.`);
