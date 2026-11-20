import {parseResults, assessment, overall, timestamp, gridColumns} from './status-model.js';
const $ = id => document.getElementById(id);
const labels = {up: '✓ Up', unreachable: '× Unreachable', warning: '⚠ Warning'};
const formatter = new Intl.DateTimeFormat('en-AU', {timeZone: 'Australia/Sydney', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'});
let data = null;
let loading = false;
let renderedStates = '';
let refreshError = false;
const formatTime = value => Number.isFinite(timestamp(value)) ? formatter.format(new Date(value)) : 'Not available';
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function stateSignature() {
  return JSON.stringify([overall(data), ...(data?.servers || []).map(s => assessment(s))]);
}
function render() {
  const summary = overall(data);
  renderedStates = stateSignature();
  $('summary').className = `summary ${summary.state}`;
  $('summary').textContent = `${labels[summary.state]} · ${summary.title}`;
  const {up, unreachable, warning} = summary.counts;
  $('counts').textContent = `${up} up · ${unreachable} unreachable · ${warning} warning`;
  $('published').textContent = data ? `Results updated: ${formatTime(data.generated_at)}` : 'No valid published results';
  $('servers').style.setProperty('--columns', gridColumns(data?.servers.length || 0));
  $('servers').style.setProperty('--rows', Math.max(1, Math.ceil((data?.servers.length || 0) / gridColumns(data?.servers.length || 0))));
  $('servers').replaceChildren();
  if (!data || !data.servers.length) {
    const box = element('section', '', 'empty');
    box.append(element('h2', !data ? 'Waiting for valid results' : data.configuration_error ? 'Check the server configuration' : 'No servers enabled'));
    box.append(element('p', !data ? 'Published results are missing or invalid. Try again after the next successful deployment.' : data.configuration_error ? 'Fix servers.json and run the monitoring workflow again.' : 'Replace an example endpoint in servers.json and enable it to begin monitoring.'));
    $('servers').append(box);
  }
  for (const server of data?.servers || []) {
    const {state, reason} = assessment(server);
    const tile = element('article', '', `tile ${state}`);
    tile.append(element('h2', server.name));
    if (server.details) tile.append(element('p', server.details, 'details'));
    tile.append(element('p', labels[state], 'status'));
    if (Number.isFinite(server.response_ms) && server.response_ms >= 0) {
      tile.append(element('p', `Last response: ${Math.round(server.response_ms)} ms`, 'metric'));
    }
    tile.append(element('p', `Last check: ${formatTime(server.checked_at)}`, 'metric'));
    if (reason) tile.append(element('p', reason, 'reason'));
    $('servers').append(tile);
  }
}
async function refresh() {
  if (loading) return;
  loading = true;
  $('refresh').disabled = true;
  if (!refreshError) $('notice').textContent = 'Loading published results…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const url = new URL('./status.json', window.location.href);
    url.searchParams.set('t', Date.now());
    const response = await fetch(url, {cache: 'no-store', signal: controller.signal});
    if (!response.ok) throw new Error('Unavailable');
    data = parseResults(await response.json());
    refreshError = false;
    $('notice').textContent = 'Published results loaded · Refreshing every 60 seconds';
  } catch {
    refreshError = true;
    $('notice').textContent = data ? 'Refresh failed. Showing last known results; old checks turn yellow after 15 minutes.' : 'Published results are missing or invalid. Please try again later.';
  } finally {
    clearTimeout(timeout);
    loading = false;
    $('refresh').disabled = false;
    $('notice').classList.toggle('error', refreshError);
    render();
  }
}
const fullscreen = $('fullscreen');
if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
  fullscreen.hidden = false;
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      $('notice').textContent = (refreshError ? 'Refresh failed. Showing last known results; old checks turn yellow after 15 minutes. ' : '') + 'Fullscreen is unavailable in this browser window.';
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreen.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreen.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
  });
}
$('refresh').addEventListener('click', refresh);
setInterval(refresh, 60000);
// Age retained results even when a refresh fails, without replacing the DOM every second.
setInterval(() => {if (stateSignature() !== renderedStates) render();}, 1000);
document.addEventListener('visibilitychange', () => {if (!document.hidden) {render(); refresh();}});
refresh();
