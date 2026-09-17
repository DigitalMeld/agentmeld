// Explicit M0 tools. No shell, path selection, recursive traversal or file contents.
export const toolSchemas = Object.freeze({
  fixture_sum: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'], additionalProperties: false },
  workspace_list: { type: 'object', properties: {}, additionalProperties: false },
});
export function normalizeArguments(tool, args) {
  if (!Object.hasOwn(toolSchemas, tool) || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('unsupported tool or arguments');
  if (tool === 'workspace_list') {
    if (Object.keys(args).length) throw new Error('workspace_list accepts no path or arguments');
    return {};
  }
  if (Object.keys(args).sort().join(',') !== 'a,b' || !Number.isSafeInteger(args.a) || !Number.isSafeInteger(args.b) || !Number.isSafeInteger(args.a + args.b)) throw new Error('invalid fixture arguments');
  return { a: args.a, b: args.b };
}
export function validateResult(tool, args, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid tool result');
  if (tool === 'fixture_sum') {
    if (Object.keys(value).join(',') !== 'sum' || value.sum !== args.a + args.b) throw new Error('invalid tool result');
  } else if (tool === 'workspace_list') {
    if (Object.keys(value).join(',') !== 'entries' || !Array.isArray(value.entries) || value.entries.length > 128 || new Set(value.entries).size !== value.entries.length || value.entries.some(name => typeof name !== 'string' || !name || Buffer.byteLength(name) > 255 || /[\\/\x00-\x1f\x7f]/.test(name) || ['.', '..'].includes(name))) throw new Error('invalid workspace listing');
  } else throw new Error('unsupported tool');
  return value;
}
