const M = globalThis.GuideModeMessages;
const els = Object.fromEntries(['status','conversation','goal','start','stop','continue','visual-enabled','original','connection','retry',
  'debug-session','debug-step','debug-url','debug-role','debug-action','debug-target','debug-success','debug-progress','debug-replans','debug-latency']
  .map(id => [id, document.getElementById(id)]));
let state = null;

const labels = { ready: 'Ready', running: 'Working…', paused: 'Waiting for you', stopped: 'Stopped', completed: 'Complete', impossible: 'Complete', error: 'Connection error' };
function render(next) {
  state = next;
  const status = next?.status || 'ready'; els.status.dataset.status = status; els.status.lastChild.textContent = labels[status] || status;
  const history = next?.history || [];
  els.conversation.innerHTML = history.length ? history.map(item => `<article class="message ${item.kind === 'user' ? 'user' : 'assistant'}">${escapeHtml(item.text)}</article>`).join('') :
    '<article class="message assistant">Tell me what you want to do on this page. I’ll guide the page and pause before sensitive or consequential steps.</article>';
  els.conversation.scrollTop = els.conversation.scrollHeight;
  const running = status === 'running', paused = status === 'paused' || status === 'error';
  els.start.hidden = running || paused; els.stop.hidden = !running; els.continue.hidden = !paused;
  els.goal.disabled = running || paused; if (next?.goal) els.goal.value = next.goal;
  els.connection.hidden = !next?.connectionError;
  els.original.disabled = !next; els.original.textContent = next?.visualMode === false ? 'Return to GuideMode' : 'Show original page';
  els['visual-enabled'].checked = next?.visualMode !== false;
  const debug = next?.debug || {};
  els['debug-session'].textContent = next?.sessionId || '—'; els['debug-step'].textContent = next?.step ?? 0;
  els['debug-url'].textContent = debug.currentUrl || '—'; els['debug-role'].textContent = debug.role || '—';
  els['debug-action'].textContent = debug.lastAction || '—'; els['debug-target'].textContent = debug.targetName || '—';
  els['debug-success'].textContent = debug.actionSuccess == null ? '—' : String(debug.actionSuccess);
  els['debug-progress'].textContent = debug.semanticProgress == null ? '—' : String(debug.semanticProgress);
  els['debug-replans'].textContent = debug.replans ?? 0; els['debug-latency'].textContent = debug.latencyMs == null ? '—' : `${debug.latencyMs} ms`;
}
function escapeHtml(text) { const span = document.createElement('span'); span.textContent = String(text); return span.innerHTML; }
async function command(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error || 'GuideMode command failed');
  if (response.state !== undefined) render(response.state);
  return response;
}
els.start.addEventListener('click', async () => { try { await command(M.START, { goal: els.goal.value, visualMode: els['visual-enabled'].checked }); } catch (e) { showError(e); } });
els.stop.addEventListener('click', () => command(M.STOP).catch(showError));
els.continue.addEventListener('click', () => command(M.CONTINUE).catch(showError));
els.retry.addEventListener('click', () => command(M.RETRY_CONNECTION).then(() => { els.connection.hidden = true; }).catch(showError));
async function toggleVisual(enabled) { try { await command(M.SET_VISUAL_MODE, { enabled }); } catch (e) { showError(e); } }
els['visual-enabled'].addEventListener('change', () => toggleVisual(els['visual-enabled'].checked));
els.original.addEventListener('click', () => toggleVisual(state?.visualMode === false));
function showError(error) { render({ ...(state || {}), status: 'error', connectionError: error.message, history: [...(state?.history || []), { kind: 'assistant', text: error.message }] }); }
chrome.runtime.onMessage.addListener(message => { if (message.type === M.STATE_CHANGED) render(message.state); });
command(M.GET_STATE).catch(showError);
