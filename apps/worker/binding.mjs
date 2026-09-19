// Worker-side execution binding and shared helpers, extracted verbatim from
// apps/poc/runtime.mjs during the Phase 1 PoC split. Both the worker (to
// assert its environment) and the service supervisor (to build the turn's
// expected_binding) read the binding through readBinding().
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { validateStore } from '../../experiments/codex-auth-store.mjs';

export const exec = promisify(execFile);
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const context = 'colima-agentmeld-m0';
export const docker = async args => (await exec('docker', ['--context', context, ...args], {timeout: 45000, maxBuffer: 24 * 1024 * 1024})).stdout;
export const safeName = name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,119}$/.test(name) && name !== '..';

// Verifies the local execution environment (image, auth store, engine,
// seccomp policy) exactly as the PoC's executeTask did, and returns the
// binding in worker-seam/1 shape plus the worker-internal handles the seam
// does not carry (the policy file path and store volume name, needed to
// launch the container). Any mismatch throws: the worker fails the turn
// closed, and the service refuses to start a turn on a broken environment.
export async function readBinding() {
  const image = (await docker(['image','inspect','agentmeld-m0:local','--format','{{.Id}}'])).trim();
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const entries = (await readFile(repoRoot + '.local/m0/subscription/store.jsonl', 'utf8')).trim().split('\n').map(JSON.parse);
  const store = entries[0];
  assert.equal(store.context, context);
  assert.equal((await docker(['info','--format','{{.ID}}'])).trim(), store.engine);
  assert.ok(entries.some(e => e.status === 'subscription-auth-imported' && e.instance === store.instance));
  validateStore(JSON.parse(await docker(['volume','inspect',store.name]))[0], store.name, store.instance);
  const {stdout} = await exec('python3', ['-c', `import importlib.util,json,pathlib\nroot=pathlib.Path(${JSON.stringify(repoRoot)})\nspec=importlib.util.spec_from_file_location("policy",root/"scripts/prepare-codex-policy.py")\nmodule=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(module)\nprint(json.dumps([str(p) for p in module.verify_prepared(root)]))`]);
  const [policy] = JSON.parse(stdout);
  const policyDigest = createHash('sha256').update(await readFile(policy)).digest('hex');
  return {
    // Seam-shaped binding. The seam's image_digest is the bare 64-hex digest;
    // docker reports it with the 'sha256:' prefix, which is stripped here.
    binding: {image_digest: image.replace(/^sha256:/, ''), store_instance: store.instance, model: 'gpt-5.5', policy_digest: policyDigest},
    // Worker-internal launch handles (not part of the seam).
    image, storeName: store.name, storeInstance: store.instance, policyPath: policy,
  };
}
