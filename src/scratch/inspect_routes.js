const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function run() {
  const data = await fetchUrl('https://quyhoach.vnpt.vn/main.d1ebe4d9948d3c12.js');

  // Search for environment configurations / apiUrl / baseUrl
  console.log('--- Search for apiUrl / baseUrl / environment ---');
  const envRegex = /\{[^{}]*(?:apiUrl|baseUrl|api_url|base_url|production)[^{}]*\}/gi;
  let envMatch;
  while ((envMatch = envRegex.exec(data)) !== null) {
    console.log('Env match:', envMatch[0]);
  }

  // Search for routes definitions (path: "...")
  console.log('\n--- Search for Routes ---');
  const routeRegex = /path:\s*["']([^"']+)["']/g;
  const routes = new Set();
  let rMatch;
  while ((rMatch = routeRegex.exec(data)) !== null) {
    routes.add(rMatch[1]);
  }
  console.log('Routes found:', Array.from(routes));

  // Search for menu items (title, label, name with vn unicode)
  console.log('\n--- Search for Menu/Nav items ---');
  const menuRegex = /\{[^{}]*(?:title|name|label|icon|path|routerLink)[^{}]*\}/g;
  let mMatch;
  let count = 0;
  while ((mMatch = menuRegex.exec(data)) !== null && count < 20) {
    if (mMatch[0].includes('path') || mMatch[0].includes('routerLink') || mMatch[0].includes('title')) {
      console.log('Menu snippet:', mMatch[0].slice(0, 200));
      count++;
    }
  }
}

run().catch(console.error);
