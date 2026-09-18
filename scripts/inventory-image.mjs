// Read-only inventory of the selected disposable image. Run through inventory-runtime.py.
import { readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function evidence(file) {
  try { const bytes = await readFile(file); return { path: file, bytes: bytes.length, sha256: digest(bytes) }; }
  catch (e) { if (e.code === 'ENOENT') return { path: file, missing: true }; throw e; }
}
const packages = []; const visited = new Set();
async function inspectPackage(directory) {
  const resolved = await realpath(directory); if (visited.has(resolved)) return; visited.add(resolved);
  const file = path.join(directory, 'package.json');
  let data; try { data = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  const notices = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /^(licen[cs]e|copying|notice|copyright)(\.|$)/i.test(entry.name)) notices.push(await evidence(path.join(directory, entry.name)));
  }
  packages.push({ name: data.name, version: data.version, declaredLicense: data.license ?? null, directory, manifest: await evidence(file), notices });
  await scanModules(path.join(directory, 'node_modules'));
}
async function scanModules(directory) {
  let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const target = path.join(directory, entry.name);
    if (entry.name.startsWith('@')) { for (const child of await readdir(target)) await inspectPackage(path.join(target, child)); }
    else await inspectPackage(target);
  }
}
await scanModules('/opt/agentmeld/node_modules');
packages.sort((a,b) => a.directory.localeCompare(b.directory));
const debian = [];
const listing = execFileSync('dpkg-query', ['-W', '-f=${binary:Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
for (const line of listing.trim().split('\n')) {
  const [name, version, architecture, status] = line.split('\t'); if (status !== 'installed') continue;
  debian.push({ name, version, architecture, copyright: await evidence('/usr/share/doc/' + name.split(':')[0] + '/copyright') });
}
const browserNotices = [];
async function scanNotices(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await scanNotices(file);
    else if (entry.isFile() && /licen[cs]e|copying|notice|copyright|credits/i.test(entry.name)) browserNotices.push(await evidence(file));
  }
}
await scanNotices('/opt/playwright');
const executable = '/usr/local/bin/agentmeld-m0';
console.log(JSON.stringify({ schema: 1, platform: process.platform, architecture: process.arch, node: process.version,
  packageLock: await evidence('/opt/agentmeld/package-lock.json'),
  nodeLicense: await evidence('/usr/local/LICENSE'), npm: packages, debian, browserNotices,
  browserManifest: JSON.parse(await readFile('/opt/agentmeld/node_modules/playwright-core/browsers.json', 'utf8')),
  applicationBinary: await evidence(executable),
  limitation: 'Package declarations and installed notice-file hashes are evidence, not a redistribution clearance or complete embedded-component SBOM.' }, null, 2));
