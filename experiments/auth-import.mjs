// Explicit owner-authorized, single-file subscription import. Never imports settings or API keys.
export function subscriptionAuthBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024) throw Error('invalid auth input');
  let data; try { data = JSON.parse(bytes.toString('utf8')); } catch { throw Error('invalid auth input'); }
  if (data?.auth_mode !== 'chatgpt' || data.OPENAI_API_KEY || !data.tokens || typeof data.tokens !== 'object') throw Error('ChatGPT subscription authentication required');
  const tokens = {};
  for (const key of ['access_token', 'refresh_token', 'id_token', 'account_id']) {
    const value = data.tokens[key];
    if (typeof value !== 'string' || !value.length || value.length > 262144) throw Error('incomplete subscription authentication');
    tokens[key] = value;
  }
  if (typeof data.last_refresh !== 'string' || !Number.isFinite(Date.parse(data.last_refresh))) throw Error('invalid refresh metadata');
  return Buffer.from(JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens, last_refresh: data.last_refresh }) + '\n');
}
export function importProgram(instance, config) {
  return `const fs=require('node:fs');const assert=require('node:assert/strict');
assert.ok(JSON.parse(fs.readFileSync('/agentmeld-home/store.json','utf8')).instance===${JSON.stringify(instance)});
assert.ok(fs.readFileSync('/agentmeld-home/.codex/config.toml','utf8')===${JSON.stringify(config)});
const bytes=fs.readFileSync(0);assert.ok(bytes.length>0&&bytes.length<=1048576);
const destination='/agentmeld-home/.codex/auth.json';const fd=fs.openSync(destination,'wx',0o600);
try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
const stat=fs.statSync(destination);assert.ok(stat.uid===1000&&stat.gid===1000&&(stat.mode&0o777)===0o600);
assert.ok(fs.readFileSync(destination).equals(bytes));console.log(JSON.stringify({imported:true,privateModesVerified:true,readbackVerified:true}));`;
}
