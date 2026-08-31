const https = require('https');
const fs = require('fs');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    }).on('error', reject);
  });
}

async function run() {
  console.log('Fetching main bundle...');
  const res = await fetchUrl('https://quyhoach.vnpt.vn/main.d1ebe4d9948d3c12.js');
  console.log('Size:', res.data.length);
  
  // Search for URLs
  const urls = res.data.match(/https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?\/[a-zA-Z0-9_.\/-]*/g) || [];
  const uniqueUrls = Array.from(new Set(urls));
  console.log('\n--- Found URLs ---');
  console.log(uniqueUrls);

  // Search for routes or keywords like nha_may, che_bien, nha may, che bien, auth, login
  const keywords = ['login', 'auth', 'nha-may', 'che-bien', 'nha_may', 'che_bien', 'factory', 'processing', 'kho', 'quy-hoach', 'dashboard'];
  console.log('\n--- Keyword search ---');
  for (const kw of keywords) {
    const matches = res.data.match(new RegExp(`.{0,50}${kw}.{0,50}`, 'gi')) || [];
    console.log(`Keyword "${kw}" count: ${matches.length}`);
    if (matches.length > 0) {
      console.log(`Sample matches for "${kw}":`, matches.slice(0, 3));
    }
  }
}

run().catch(console.error);
