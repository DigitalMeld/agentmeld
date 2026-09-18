// Qualification-only reader for a probe-owned native rollout, never a product event fallback.
export function commandResultEvidence(text, expectedCommand, expectedExit) {
  if (Buffer.byteLength(text) > 1024 * 1024) throw Error('native evidence exceeds limit');
  const calls = new Set(); let matched = false;
  for (const line of text.split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    if (row.type !== 'response_item') continue;
    const item = row.payload;
    if (item?.type === 'function_call' && item.name === 'exec_command') {
      const args = JSON.parse(item.arguments);
      if (args.cmd === expectedCommand && typeof item.call_id === 'string') calls.add(item.call_id);
    }
    if (item?.type === 'function_call_output' && calls.has(item.call_id) && typeof item.output === 'string') {
      // Only the native result header before Output is evidence; fixture stdout cannot forge it.
      const boundary = item.output.search(/\n(?:Final output|Output):/);
      if (boundary < 0) continue;
      const header = item.output.slice(0, boundary);
      const code = header.match(/^Process exited with code (-?\d+)$/m);
      matched ||= code !== null && Number(code[1]) === expectedExit;
    }
  }
  return matched;
}
