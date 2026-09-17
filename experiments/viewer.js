let state; let stopped = false; let revision = 0; let busy = false;
const status = document.querySelector('#status');
const screen = document.querySelector('#screen');
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Connection or control unavailable');
  return response.json();
}
function render() {
  status.textContent = state.mode === 'human' ? 'You have control' : state.mode === 'agent' ? 'Agent has control' : 'Paused';
  document.querySelector('#takeover').disabled = !['agent', 'paused'].includes(state.mode);
  document.querySelector('#resume').disabled = state.mode !== 'human';
}
function showFrame(frame) {
  screen.src = `data:image/png;base64,${frame.png}`;
  screen.dataset.counter = frame.counter;
}
async function refresh() {
  if (stopped) return;
  const current = revision;
  try {
    if (!busy) {
      const nextState = await api('/state');
      const frame = await api('/frame');
      if (!stopped && !busy && current === revision) { state = nextState; render(); showFrame(frame); }
    }
  } catch (error) { if (!stopped && current === revision) status.textContent = error.message; }
  if (!stopped) setTimeout(refresh, 750);
}
async function command(path, body = {}) {
  if (busy || stopped) return false;
  busy = true; ++revision;
  try {
    state = await api(path, body); render();
    if (state.observation) showFrame(state.observation);
    return true;
  } catch (error) { status.textContent = error.message; return false; }
  finally { busy = false; }
}
document.querySelector('#takeover').onclick = () => command('/takeover');
document.querySelector('#resume').onclick = () => command('/resume', { generation: state.generation });
document.querySelector('#disconnect').onclick = async () => {
  const acknowledged = await command('/disconnect');
  stopped = true; ++revision; screen.removeAttribute('src');
  status.textContent = acknowledged ? 'Disconnected · agent remains paused' : 'Connection lost · control status unconfirmed';
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
};
screen.onclick = event => {
  if (state?.mode !== 'human') return;
  const rect = screen.getBoundingClientRect();
  command('/input', { generation: state.generation, x: (event.clientX - rect.left) * 640 / rect.width, y: (event.clientY - rect.top) * 360 / rect.height });
};
screen.onkeydown = event => {
  if (event.key === 'Enter' && state?.mode === 'human') command('/input', { generation: state.generation, x: 320, y: 180 });
};
refresh();
