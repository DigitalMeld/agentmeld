// Read-only local eligibility checks. Metadata is evidence, not a network sandbox.
export function localEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('literal loopback Ollama endpoint required');
  return url;
}
export async function preflightOllama({ endpoint, model, fetchImpl = fetch, signal }) {
  const url = localEndpoint(endpoint);
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model) || model.includes('cloud')) throw new Error('explicit local model required');
  const read = async (path, body) => {
    const timeout = AbortSignal.timeout(5000);
    const response = await fetchImpl(new URL(path, url), { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error(`Ollama preflight HTTP ${response.status}`);
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error('metadata limit'); chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks));
  };
  const version = await read('/api/version');
  if (typeof version.version !== 'string') throw new Error('missing runtime version');
  const inventory = await read('/api/tags');
  const selected = inventory.models?.filter(item => item.name === model);
  if (!Array.isArray(selected) || selected.length !== 1) throw new Error('selected model not installed exactly once');
  const entry = selected[0];
  if (entry.remote_model || entry.remote_host || entry.details?.format !== 'gguf' || !Number.isSafeInteger(entry.size) || entry.size <= 0 || !/^[a-f0-9]{64}$/.test(entry.digest)) throw new Error('cloud or unverifiable local model');
  const shown = await read('/api/show', { model });
  if (shown.remote_model || shown.remote_host || shown.details?.format !== 'gguf' || !Array.isArray(shown.capabilities) || !shown.capabilities.includes('tools')) throw new Error('local tool capability unavailable');
  return { runtimeVersion: version.version, model, digest: entry.digest, sizeBytes: entry.size, format: 'gguf', tools: true, endpoint: url.origin };
}
