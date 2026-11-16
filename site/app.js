import {parseResults, stateOf, overall, timestamp} from './status-model.js';
const $ = id => document.getElementById(id);
const symbols = {up: '✓', down: '×', unknown: '?', stale: '◷'};
const labels = {up: 'Up', down: 'Down', unknown: 'Unknown', stale: 'Stale'};
const formatter = new Intl.DateTimeFormat('en-AU', {timeZone: 'Australia/Sydney', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'});
let data = null;
let loading = false;
let renderedStates = '';
const formatTime = value => Number.isFinite(timestamp(value)) ? formatter.format(new Date(value)) : 'Not available';
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function metric(label, value) {
  const dl = element('dl', '', 'metric');
  dl.append(element('dt', label), element('dd', value));
  return dl;
}
function render() {
  const summary = overall(data);
  renderedStates = JSON.stringify([summary.state, ...(data?.servers || []).map(s => stateOf(s))]);
  $('summary').className = `summary ${summary.state}`;
  $('summary-icon').textContent = symbols[summary.state];
  $('summary-label').textContent = labels[summary.state].toUpperCase();
  $('summary-title').textContent = summary.title;
  $('summary-detail').textContent = data?.configuration_error ? 'Configuration needs attention. Some checks could not run.'
    : summary.state === 'stale' ? 'Old results do not establish current availability.'
    : summary.state === 'up' ? 'Based on the latest checks from the monitoring runner.'
    : summary.state === 'down' ? 'A failed check does not establish that the entire server is offline.'
    : 'Enable your public endpoints in servers.json to begin monitoring.';
  if (!data) $('summary-detail').textContent = 'Published results are missing or could not be read.';
  $('published').textContent = data ? `Results published: ${formatTime(data.generated_at)}` : 'No valid published results available.';
  $('server-count').textContent = data ? `(${data.servers.length})` : '';
  $('servers').replaceChildren();
  if (!data || !data.servers.length) {
    const box = element('div', '', 'empty');
    box.append(element('strong', !data ? 'Waiting for valid results' : data.configuration_error ? 'Check the server configuration' : 'Your servers will appear here'));
    box.append(element('span', !data ? 'Try refreshing results after the next successful workflow deployment.' : data.configuration_error ? 'Fix servers.json and run the workflow again.' : 'The included example entries are disabled. Replace an example endpoint and enable it to get started.'));
    $('servers').append(box);
  }
  for (const server of data?.servers || []) {
    const state = stateOf(server);
    const card = element('article', '', 'server');
    const heading = element('div', '');
    heading.append(element('h3', server.name), element('span', `${symbols[state]} ${labels[state]}`, `badge ${state}`));
    const response = Number.isFinite(server.response_ms) && server.response_ms >= 0 ? `${Math.round(server.response_ms)} ms` : 'Not available';
    card.append(heading, metric('LAST RESPONSE TIME', response), metric('LAST CHECK · SYDNEY', formatTime(server.checked_at)));
    const reason = state === 'stale' ? 'This result is over 15 minutes old. Current availability is unknown.'
      : state === 'unknown' ? safeReason(server.reason, true)
      : state === 'down' ? safeReason(server.reason) : '';
    if (reason) card.append(element('p', reason, 'reason'));
    $('servers').append(card);
  }
}
function safeReason(reason, unknown = false) {
  const allowed = ['Request timed out from the monitoring runner.', 'Connection or DNS failed from the monitoring runner.', 'TLS certificate verification failed.', 'Private network endpoint; requires a runner with network access.', 'Invalid server configuration; check servers.json.', 'The monitor could not complete this check.'];
  return allowed.includes(reason) || /^Unexpected HTTP status \d{3}\.$/.test(reason) ? reason : unknown ? 'No reliable check result. Review the monitoring workflow and configuration.' : 'The endpoint check failed from the monitoring runner.';
}
async function refresh() {
  if (loading) return;
  loading = true;
  $('refresh').disabled = true;
  $('notice').textContent = 'Loading published results…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const url = new URL('./status.json', window.location.href);
    url.searchParams.set('t', Date.now());
    const response = await fetch(url, {cache: 'no-store', signal: controller.signal});
    if (!response.ok) throw new Error('Unavailable');
    data = parseResults(await response.json());
    $('notice').textContent = 'Published results loaded. Automatic refresh every 60 seconds.';
  } catch {
    $('notice').textContent = data ? 'Could not refresh results. Showing the last loaded results; check their timestamps.' : 'Published results are missing or invalid. Please try again later.';
  } finally {
    clearTimeout(timeout);
    loading = false;
    $('refresh').disabled = false;
    render();
  }
}
$('refresh').addEventListener('click', refresh);
setInterval(refresh, 60000);
// Re-evaluate age even when fetches fail or a tab has been left open.
setInterval(() => {
  const states = JSON.stringify([overall(data).state, ...(data?.servers || []).map(s => stateOf(s))]);
  if (states !== renderedStates) render();
}, 1000);
document.addEventListener('visibilitychange', () => {if (!document.hidden) {render(); refresh();}});
refresh();
