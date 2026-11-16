export const STALE_MS = 15 * 60 * 1000;
const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
export function timestamp(value) {
  return typeof value === 'string' && iso.test(value) ? Date.parse(value) : NaN;
}
export function stateOf(server, now = Date.now()) {
  const checked = timestamp(server.checked_at);
  if (!Number.isFinite(checked) || checked > now + 60000) return 'unknown';
  if (now - checked > STALE_MS) return 'stale';
  return ['up', 'down', 'unknown'].includes(server.status) ? server.status : 'unknown';
}
export function parseResults(data) {
  if (!data || data.schema_version !== 1 || !Array.isArray(data.servers)
      || typeof data.configuration_error !== 'boolean' || !Number.isFinite(timestamp(data.generated_at))) {
    throw new Error('Invalid results');
  }
  const ids = new Set();
  for (const server of data.servers) {
    if (!server || typeof server.id !== 'string' || ids.has(server.id)
        || typeof server.name !== 'string' || !server.name.trim() || server.name.length > 100) {
      throw new Error('Invalid server');
    }
    ids.add(server.id);
  }
  return data;
}
export function overall(data, now = Date.now()) {
  if (!data) return {state: 'unknown', title: 'Status unavailable'};
  const states = data.servers.map(s => stateOf(s, now));
  if (states.includes('down')) return {state: 'down', title: 'Some endpoints are unavailable'};
  if (states.includes('stale') || now - timestamp(data.generated_at) > STALE_MS) {
    return {state: 'stale', title: 'Results are out of date'};
  }
  if (data.configuration_error || states.includes('unknown') || timestamp(data.generated_at) > now + 60000) {
    return {state: 'unknown', title: 'Some statuses are unknown'};
  }
  if (!states.length) return {state: 'unknown', title: 'No servers enabled'};
  return {state: 'up', title: 'All endpoints responded successfully'};
}
