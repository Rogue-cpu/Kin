import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppOrigin } from '../server.mjs';

test('app origins normalize whitespace and trailing slashes', () => {
  assert.equal(resolveAppOrigin(' https://kin.example/ '), 'https://kin.example');
  assert.equal(resolveAppOrigin('https://kin.example///'), 'https://kin.example');
  assert.equal(resolveAppOrigin('http://localhost:3000/'), 'http://localhost:3000');
});
test('Railway public domain supplies an origin only when APP_ORIGIN is absent', () => {
  assert.equal(resolveAppOrigin(undefined, 'kin-production.up.railway.app'), 'https://kin-production.up.railway.app');
  assert.equal(resolveAppOrigin(' ', 'kin-production.up.railway.app'), 'https://kin-production.up.railway.app');
  assert.equal(resolveAppOrigin('https://custom.example/', 'kin-production.up.railway.app'), 'https://custom.example');
});
test('origin configuration rejects paths, credentials, and non-web schemes', () => {
  for (const origin of ['', 'kin.example', 'https://railway.com/project/example', 'https://kin.example/?x=1', 'https://kin.example/#fragment', 'https://name:password@kin.example', 'file:///tmp/kin']) {
    assert.throws(() => resolveAppOrigin(origin), /Set APP_ORIGIN/);
  }
});
