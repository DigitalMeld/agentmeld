// Browser-only synthetic login fixture. No real credential input or public endpoint.
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, readlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const secret = randomUUID(); let context; let page; let entered = false;
const profile = '/tmp/private-browser-profile';
async function handle(op) {
  if (op === 'init' && !context) {
    await mkdir(profile, { recursive: true, mode: 0o700 });
    context = await chromium.launchPersistentContext(profile, { headless: true, chromiumSandbox: true, viewport: { width: 640, height: 360 } });
    page = context.pages()[0];
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<title>Synthetic login</title><input type="password"><output>0</output>' }));
    await page.goto('http://fixture.invalid/login');
    return { ready: true, pidNamespace: await readlink('/proc/self/ns/pid'), networkNamespace: await readlink('/proc/self/ns/net') };
  }
  if (!context) throw Error('not initialized');
  if (op === 'fixture_private_entry' && !entered) {
    await page.locator('input').fill(secret);
    await context.addCookies([{ name: 'synthetic_session', value: secret, url: 'http://fixture.invalid', httpOnly: true }]);
    await writeFile(profile + '/synthetic-canary', secret, { mode: 0o600, flag: 'wx' });
    entered = true; return { entered: true };
  }
  if (op === 'fixture_verify') {
    assert.ok(entered); assert.equal(await readFile(profile + '/synthetic-canary', 'utf8'), secret);
    assert.equal((await context.cookies()).find(c => c.name === 'synthetic_session')?.value, secret);
    return { profileIntact: true, sessionIntact: true };
  }
  if (op === 'fixture_finish_login') {
    assert.ok(entered);
    await page.setContent('<title>Signed in fixture</title><h1>Signed in</h1><output>1</output>');
    assert.equal(await page.locator('input').count(), 0);
    assert.ok(!(await page.content()).includes(secret));
    return { credentialFormRemoved: true };
  }
  if (op === 'observe') return { counter: await page.locator('output').textContent(), png: (await page.screenshot()).toString('base64') };
  throw Error('unsupported fixture operation');
}
let buffer = '';
try {
  for await (const chunk of process.stdin) {
    buffer += chunk; if (Buffer.byteLength(buffer) > 65536) throw Error('input limit');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      const command = JSON.parse(line);
      if (!Number.isSafeInteger(command.id)) throw Error('invalid request');
      try { console.log(JSON.stringify({ id: command.id, result: await handle(command.op) })); }
      catch { console.log(JSON.stringify({ id: command.id, error: 'fixture rejected' })); }
    }
  }
} finally { if (context) await context.close(); }
