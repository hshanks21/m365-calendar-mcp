// Liveness only: unauthenticated denials, no OAuth or provider reads.
import http from 'node:http';
import https from 'node:https';
import {readFileSync} from 'node:fs';
function denied(url, options={}, status=401) {
  return new Promise((resolve,reject)=>{
    const request=(url.startsWith('https:')?https:http).get(url,options,response=>{
      response.resume();
      response.on('end',()=>response.statusCode===status?resolve():reject(Error()));
    });
    request.setTimeout(3000,()=>request.destroy(Error()));
    request.on('error',reject);
  });
}
try {
  const tls=!!process.env.CALENDAR_DASHBOARD_TLS_CERT_FILE;
  // Native-only Origin rejection occurs before authentication telemetry.
  await denied('http://127.0.0.1:3217/mcp',{headers:{Origin:'http://healthcheck.invalid'}},403);
  await denied(tls?'https://192.168.2.40:3218/api/diagnostics':'http://127.0.0.1:3218/api/diagnostics',tls?{ca:readFileSync('/run/tls/dashboard-ca.pem'),rejectUnauthorized:true}:{});
} catch {process.exitCode=1;}
