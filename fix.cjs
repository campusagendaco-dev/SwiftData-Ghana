const fs = require('fs');
['src/pages/PayPassCheckout.tsx', 'src/pages/PaystackOtpVerify.tsx'].forEach(f => {
  const raw = fs.readFileSync(f, 'utf8');
  if (raw.startsWith('"') && raw.endsWith('"\n')) {
    fs.writeFileSync(f, JSON.parse(raw.trim()));
    console.log('Fixed ' + f);
  } else if (raw.startsWith('"') && raw.endsWith('"')) {
    fs.writeFileSync(f, JSON.parse(raw));
    console.log('Fixed ' + f);
  }
});
