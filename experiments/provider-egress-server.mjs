// Explicit M0 experiment only. Run on a private isolated bridge; publish no ports.
import { createProviderEgress } from './provider-egress.mjs';
const proxy = createProviderEgress({ hosts: ['auth.openai.com', 'chatgpt.com'] });
// Only fixed routing classifications; never log TLS bytes or arbitrary request targets.
proxy.server.prependListener('connect', (req, _socket, head) => console.log(JSON.stringify({ event: 'provider-connect', target: req.url === 'auth.openai.com:443' ? 'auth' : req.url === 'chatgpt.com:443' ? 'chatgpt' : 'denied', hostMatches: req.headers.host === req.url, bufferedBytes: head.length })));
proxy.server.listen(8443, '0.0.0.0', () => console.log('provider-egress-ready'));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await proxy.close(); process.exit(0); });
