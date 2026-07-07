import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Read proxy URL from Vercel Environment Variables
const KORBA_PROXY_URL = process.env.KORBA_PROXY_URL || "https://WCaCqU:PL9knqRP@149-28-121-181.ip.private.ipb.cloud:9443";

// Simple authorization token to secure the bridge endpoint
const BRIDGE_SECRET = process.env.KORBA_BRIDGE_SECRET || 'swiftdata-korba-bridge-token-2026';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow only POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Validate the bridge secret for security
  const authHeaderToken = req.headers['x-bridge-secret'];
  if (authHeaderToken !== BRIDGE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: Invalid bridge token' });
  }

  const { url, method, headers, body } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing destination url' });
  }

  try {
    const urlObj = new URL(url);
    const proxyAgent = new HttpsProxyAgent(KORBA_PROXY_URL);

    // Clean up headers to avoid conflicts
    const forwardHeaders: Record<string, string> = {};
    if (headers) {
      for (const [key, val] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();
        // Do not forward host or content-length (let Node.js handle them)
        if (lowerKey !== 'host' && lowerKey !== 'content-length') {
          forwardHeaders[key] = String(val);
        }
      }
    }

    if (body) {
      forwardHeaders['Content-Length'] = String(Buffer.byteLength(body));
    }

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: method || 'POST',
      headers: forwardHeaders,
      agent: proxyAgent,
      timeout: 25000
    };

    const responseData = await new Promise<{ status: number; body: string; headers: any }>((resolve, reject) => {
      const proxyReq = https.request(options, (proxyRes) => {
        let responseBody = '';
        proxyRes.setEncoding('utf8');
        proxyRes.on('data', (chunk) => responseBody += chunk);
        proxyRes.on('end', () => {
          resolve({
            status: proxyRes.statusCode || 200,
            body: responseBody,
            headers: proxyRes.headers
          });
        });
      });

      proxyReq.on('error', (e) => reject(e));
      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        reject(new Error('Proxy connection timed out'));
      });

      if (body) {
        proxyReq.write(body);
      }
      proxyReq.end();
    });

    // Forward the response status and headers (selectively) back to the caller
    res.status(responseData.status);
    if (responseData.headers['content-type']) {
      res.setHeader('Content-Type', responseData.headers['content-type']);
    }
    
    try {
      const parsedJson = JSON.parse(responseData.body);
      return res.json(parsedJson);
    } catch {
      return res.send(responseData.body);
    }
  } catch (err: any) {
    console.error('Bridge execution error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
