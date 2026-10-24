import assert from 'node:assert/strict';

const api = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3000';
const web = process.env.SMOKE_WEB_URL ?? 'http://127.0.0.1:5173';
const get = (url) => fetch(url, { signal: AbortSignal.timeout(8000) });

const live = await get(`${api}/api/health/live`);
assert.equal(live.status, 200);
assert.equal(live.headers.get('x-content-type-options'), 'nosniff');
assert.deepEqual(await live.json(), { status: 'ok', service: 'p2p-api' });

const ready = await get(`${api}/api/health/ready`);
assert.equal(ready.status, 200);
assert.deepEqual(await ready.json(), {
  status: 'ready',
  checks: { mongodb: 'up', replicaSet: 'ready' },
});

const page = await get(web);
assert.equal(page.status, 200);
assert.match(await page.text(), /<title>Secure P2P<\/title>/);
const proxied = await get(`${web}/api/health/ready`);
assert.equal(proxied.status, 200);
assert.equal((await proxied.json()).status, 'ready');
console.log('PASS: API liveness/readiness, security header, web page, and web-to-API proxy.');
