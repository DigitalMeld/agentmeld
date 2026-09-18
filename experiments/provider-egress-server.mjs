// Explicit M0 experiment only. Run on a private isolated bridge; publish no ports.
import { createProviderEgress } from './provider-egress.mjs';
const proxy = createProviderEgress({ hosts: ['auth.openai.com', 'chatgpt.com'] });
proxy.server.listen(8443, '0.0.0.0', () => console.log('provider-egress-ready'));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await proxy.close(); process.exit(0); });
