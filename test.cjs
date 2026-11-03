const apiKey = process.env.DATAMART_API_KEY; // never commit provider keys
if (!apiKey) { console.error('Set DATAMART_API_KEY to run this script.'); process.exit(1); }
const baseUrl = 'https://api.datamartgh.shop/api/developer';

async function run() {
  const urls = [
    '/order-status/6a134eb07f280b6a3019b3cb',
    '/order-status/6a134eb07f280b6a3019b3cc',
  ];

  for (const ep of urls) {
    try {
      const url = `${baseUrl}${ep}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey,
          'Accept': 'application/json'
        }
      });
      console.log(`URL: ${url} -> Status: ${res.status}`);
      const text = await res.text();
      console.log(`Response: ${text.slice(0, 300)}`);
    } catch (e) {
      console.error(`Error for ${ep}:`, e.message);
    }
  }
}
run();
