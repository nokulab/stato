export const STALE_MS = 15 * 60 * 1000;
const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
export function timestamp(value) {
  return typeof value === 'string' && iso.test(value) ? Date.parse(value) : NaN;
}
const reasons = {
  timeout: 'The endpoint timed out from the monitoring runner after retrying.',
  network: 'The endpoint could not be reached from the monitoring runner after retrying.',
  http_status: 'The endpoint responded with an unexpected HTTP status.',
  tls: 'TLS certificate verification failed.',
  private: 'Private endpoint: a runner with network access is required.',
  config: 'Invalid server configuration. Check servers.json.',
  internal: 'The monitor could not complete this check.'
};
export function assessment(server, now = Date.now()) {
  const checked = timestamp(server?.checked_at);
  if (!Number.isFinite(checked)) return {state: 'warning', reason: server?.reason_code === 'config' ? reasons.config : 'No reliable check result is available.'};
  if (checked > now + 60000) return {state: 'warning', reason: 'Check time is in the future. Current availability is unknown.'};
  if (now - checked > STALE_MS) return {state: 'warning', reason: 'Stale result: over 15 minutes old. Current availability is unknown.'};
  if (server.status === 'up' && !server.reason_code) return {state: 'up', reason: ''};
  if (server.status === 'down' && ['network', 'timeout'].includes(server.reason_code)) {
    return {state: 'unreachable', reason: reasons[server.reason_code]};
  }
  return {state: 'warning', reason: reasons[server.reason_code] || 'No reliable health result is available.'};
}
export function stateOf(server, now = Date.now()) {
  return assessment(server, now).state;
}
export function parseResults(data) {
  if (!data || data.schema_version !== 1 || !Array.isArray(data.servers)
      || typeof data.configuration_error !== 'boolean' || !Number.isFinite(timestamp(data.generated_at))) {
    throw new Error('Invalid results');
  }
  const ids = new Set();
  for (const server of data.servers) {
    if (!server || typeof server.id !== 'string' || ids.has(server.id)
        || typeof server.name !== 'string' || !server.name.trim() || server.name.length > 100
        || (server.details !== undefined && (typeof server.details !== 'string' || server.details.length > 240))) {
      throw new Error('Invalid server');
    }
    ids.add(server.id);
  }
  return data;
}
export function overall(data, now = Date.now()) {
  const counts = {up: 0, unreachable: 0, warning: 0};
  for (const server of data?.servers || []) counts[stateOf(server, now)]++;
  let state = 'warning', title = 'Status unavailable';
  if (data) {
    const published = timestamp(data.generated_at);
    if (now - published > STALE_MS) title = 'Results are stale';
    else if (!Number.isFinite(published) || published > now + 60000) title = 'Results time is invalid';
    else if (counts.unreachable) { state = 'unreachable'; title = 'Some endpoints are unreachable'; }
    else if (data.configuration_error || counts.warning) title = 'Some checks need attention';
    else if (!data.servers.length) title = 'No servers enabled';
    else { state = 'up'; title = 'All endpoints are up'; }
  }
  return {state, title, counts};
}
// Match the supplied desktop references; cap columns so large lists scroll legibly.
export function gridColumns(count) {
  return count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
}

// Only numeric HTTP metadata is displayed; never expose request URLs or raw responses.
export function httpDetails(server) {
  const valid = code => Number.isInteger(code) && code >= 100 && code <= 599;
  const lines = [];
  if (valid(server.http_status)) lines.push(`Last HTTP status: ${server.http_status}`);
  else if (server.http_status === null) lines.push('Last HTTP status: no response received');
  if (Array.isArray(server.expected_status_codes) && server.expected_status_codes.length
      && server.expected_status_codes.every(valid)) {
    lines.push(`Expected HTTP: ${server.expected_status_codes.join(', ')}`);
  }
  return lines;
}
