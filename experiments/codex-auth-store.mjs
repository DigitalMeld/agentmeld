// Dedicated VM-local Codex home. No host credential import or implicit creation.
export const authHome = '/agentmeld-home';
export const authConfig = `forced_login_method = "chatgpt"
cli_auth_credentials_store = "file"
default_permissions = "agentmeld"
[permissions.agentmeld.filesystem]
":root" = "read"
"/agentmeld-home" = "deny"
"/workspace" = "write"
[permissions.agentmeld.network]
enabled = false
`;
export const storeLabels = { 'io.digitalmeld.agentmeld.purpose': 'm0-codex-auth', 'io.digitalmeld.agentmeld.format': '1' };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validateStoreName(name) {
  if (name !== 'agentmeld-m0-codex-auth' && !(typeof name === 'string' && name.startsWith('agentmeld-m0-auth-fixture-') && uuid.test(name.slice(26)))) throw Error('invalid auth store name');
  return name;
}
export function validateStore(volume, name, instance) {
  validateStoreName(name);
  if (typeof instance !== 'string' || !uuid.test(instance)) throw Error('invalid store instance');
  if (!volume || volume.Name !== name || volume.Driver !== 'local' || volume.Scope !== 'local'
    || Object.keys(volume.Options ?? {}).length || volume.Labels?.['io.digitalmeld.agentmeld.instance'] !== instance
    || Object.entries(storeLabels).some(([key, value]) => volume.Labels?.[key] !== value)) throw Error('auth store identity mismatch');
  return { name, instance };
}
export function initializeStoreProgram(instance) {
  if (typeof instance !== 'string' || !uuid.test(instance)) throw Error('invalid store instance');
  // Trusted initializer only, before login, with just CHOWN capability. Refuses nonempty stores.
  return `const fs=require('node:fs'); const root=${JSON.stringify(authHome)};
if(fs.readdirSync(root).length)throw Error('auth store must be empty');
fs.mkdirSync(root+'/.codex',{mode:0o700});
fs.writeFileSync(root+'/.codex/config.toml',${JSON.stringify(authConfig)},{flag:'wx',mode:0o600});
fs.writeFileSync(root+'/store.json',${JSON.stringify(JSON.stringify({ version: 1, instance }))},{flag:'wx',mode:0o600});
for(const path of [root+'/.codex/config.toml',root+'/store.json',root+'/.codex',root]){fs.chmodSync(path,fs.statSync(path).isDirectory()?0o700:0o600);fs.chownSync(path,1000,1000)};`;
}
export function storeMount(name) {
  return `type=volume,source=${validateStoreName(name)},target=${authHome},volume-nocopy`;
}
