const apiKey = '43e680d7d469f84a5fd5425cf5c8b86154a8438a21d39c6f76f6c3b1287f88d0';
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
