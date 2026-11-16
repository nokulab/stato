import test from 'node:test';
import assert from 'node:assert/strict';
import {stateOf, overall, parseResults, STALE_MS} from '../site/status-model.js';
const now = Date.parse('2026-11-15T01:00:00Z');
const row = (status = 'up', age = 0) => ({id: 'one', name: 'Example', status, response_ms: 42, checked_at: new Date(now-age).toISOString()});
const data = servers => ({schema_version: 1, generated_at: new Date(now).toISOString(), configuration_error: false, servers});
test('fresh Up and Down; strict 15 minute stale boundary', () => {
  assert.equal(stateOf(row(), now), 'up');
  assert.equal(stateOf(row('down'), now), 'down');
  assert.equal(stateOf(row('up', STALE_MS), now), 'up');
  assert.equal(stateOf(row('up', STALE_MS + 1), now), 'stale');
  assert.equal(stateOf(row('down', STALE_MS + 1), now), 'stale');
});
test('missing, malformed, future and unknown states never become Up', () => {
  for (const checked_at of [null, 'bad', 0, '2026-11-15T03:00:00Z']) {
    assert.equal(stateOf({...row(), checked_at}, now), 'unknown');
  }
  assert.equal(stateOf(row('invented'), now), 'unknown');
});
test('overall is cautious about empty, stale, partial and invalid results', () => {
  assert.equal(overall(data([]), now).state, 'unknown');
  assert.equal(overall(null, now).state, 'unknown');
  assert.equal(overall(data([row()]), now).state, 'up');
  assert.equal(overall(data([row('up', STALE_MS+1)]), now).state, 'stale');
  assert.equal(overall(data([row(), {...row('unknown'), id:'two'}]), now).state, 'unknown');
  assert.equal(overall({...data([row()]), configuration_error:true}, now).state, 'unknown');
  assert.equal(overall(data([row('down')]), now).state, 'down');
});
test('malformed documents are rejected; empty documents are handled', () => {
  for (const value of [null, {}, [], {servers:[]}, {...data([]), servers:[null]}, data([row(),row()])]) {
    assert.throws(() => parseResults(value));
  }
  assert.deepEqual(parseResults(data([])), data([]));
});
