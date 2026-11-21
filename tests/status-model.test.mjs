import test from 'node:test';
import assert from 'node:assert/strict';
import {stateOf, assessment, overall, parseResults, STALE_MS, gridColumns} from '../site/status-model.js';
const now = Date.parse('2026-11-15T01:00:00Z');
const row = (status = 'up', reason_code = null, age = 0) => ({id: 'one', name: 'Example', status, reason_code, response_ms: 42, checked_at: new Date(now-age).toISOString()});
const data = servers => ({schema_version: 1, generated_at: new Date(now).toISOString(), configuration_error: false, servers});
test('green, red and yellow use structured codes, never error text', () => {
  assert.equal(stateOf(row(), now), 'up');
  for (const code of ['network', 'timeout']) assert.equal(stateOf(row('down', code), now), 'unreachable');
  for (const code of ['http_status', 'tls', 'config', 'internal', 'private', null, 'new-code']) {
    assert.equal(stateOf({...row('down', code), reason:'Connection failed'}, now), 'warning');
  }
  assert.equal(stateOf({...row('down', 'network'), reason:'Unexpected HTTP status 503.'}, now), 'unreachable');
});
test('old green and red results turn yellow at the strict stale boundary', () => {
  assert.equal(stateOf(row('up', null, STALE_MS), now), 'up');
  for (const entry of [row('up', null, STALE_MS+1), row('down', 'network', STALE_MS+1)]) {
    assert.equal(stateOf(entry, now), 'warning');
    assert.match(assessment(entry, now).reason, /Stale/);
  }
});
test('missing, malformed, future and unknown results are yellow', () => {
  for (const checked_at of [null, 'bad', 0, '2026-11-15T03:00:00Z']) {
    assert.equal(stateOf({...row(), checked_at}, now), 'warning');
  }
  assert.equal(stateOf(null, now), 'warning');
  assert.equal(stateOf(row('invented'), now), 'warning');
});
test('overall summary counts mixed statuses and handles empty or stale data', () => {
  assert.equal(overall(data([]), now).title, 'No servers enabled');
  assert.equal(overall(null, now).state, 'warning');
  assert.equal(overall(data([row()]), now).state, 'up');
  assert.equal(overall({...data([row()]), configuration_error:true}, now).state, 'warning');
  const mixed = [row(), {...row('down','network'),id:'two'}, {...row('down','http_status'),id:'three'}];
  assert.deepEqual(overall(data(mixed),now).counts, {up:1,unreachable:1,warning:1});
  assert.equal(overall(data(mixed),now).state, 'unreachable');
  assert.equal(overall(data(mixed), now+STALE_MS+1).state,'warning');
});
test('old configurations without details and codes remain readable', () => {
  const legacy = row('down'); delete legacy.reason_code;
  assert.equal(parseResults(data([legacy])).servers[0].details, undefined);
  assert.equal(stateOf(legacy,now), 'warning');
  assert.equal(parseResults(data([{...row(),details:'<b>Public description</b>'}])).servers[0].details,'<b>Public description</b>');
});
test('malformed documents are rejected; empty documents are handled', () => {
  for (const value of [null, {}, [], {servers:[]}, {...data([]), servers:[null]}, data([row(),row()]), data([{...row(),details:42}])]) {
    assert.throws(() => parseResults(value));
  }
  assert.deepEqual(parseResults(data([])), data([]));
});
test('reference grids, intermediate counts and large lists', () => {
  for (const [count, columns] of [[0,1],[1,1],[2,2],[4,2],[5,3],[6,3],[9,3],[10,4],[16,4],[17,4],[25,4],[100,4]]) {
    assert.equal(gridColumns(count), columns);
  }
});
