const https = require('https');

function postJson(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ...headers,
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ...headers,
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // Let's first test potential login endpoints on https://quyhoach.vnpt.vn
  const testEndpoints = [
    'https://quyhoach.vnpt.vn/api/auth/login',
    'https://quyhoach.vnpt.vn/gdci/api/auth/login',
    'https://quyhoach.vnpt.vn/api/v1/auth/login',
    'https://quyhoach.vnpt.vn/auth/login',
    'https://quyhoach.vnpt.vn/gdci/auth/login',
    'https://quyhoach.vnpt.vn/api/login',
    'https://quyhoach.vnpt.vn/gdci/api/login'
  ];

  const credentials = {
    username: 'luanto88',
    password: 'Chi6lonlu@'
  };

  for (const ep of testEndpoints) {
    try {
      const res = await postJson(ep, credentials);
      console.log(`Endpoint: ${ep} -> Status: ${res.statusCode}`);
      console.log('Response body:', res.body.slice(0, 300));
    } catch (e) {
      console.log(`Endpoint ${ep} error:`, e.message);
    }
  }
}

main().catch(console.error);
