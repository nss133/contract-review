import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiClient, ApiError} from '../src/api-client.mjs';

test('cookie credentials and CSRF travel only through the API adapter', async () => {
  const calls = [];
  const api = new ApiClient('/api/v1', async (url, options) => {
    calls.push({url, options});
    return {ok: true, json: async () => ({api_version: '1', user: {id: 'u'}, csrf_token: 'test-csrf'})};
  });
  await api.login('user', 'password');
  await api.request('/reviews', {method: 'POST', body: {text: '본문'}});
  assert.equal(calls[1].options.credentials, 'include');
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'test-csrf');
  assert.equal(calls[1].options.cache, 'no-store');
});

test('conflicts preserve retry semantics; authentication expiry removes CSRF', async () => {
  const api = new ApiClient('/api/v1', async () => ({ok: false, status: 409,
    json: async () => ({api_version: '1', error: {code: 'revision_conflict', message: '충돌', retryable: true}})}));
  await assert.rejects(api.request('/reviews'), error => error instanceof ApiError && error.status === 409 && error.retryable);
  api.csrfToken = 'stale';
  api.transport = async () => ({ok: false, status: 401, json: async () => ({error: {code: 'authentication_required'}})});
  await assert.rejects(api.me()); assert.equal(api.csrfToken, '');
});

test('network failure and malformed/version-incompatible responses never become success', async () => {
  const api = new ApiClient('/api/v1', async () => { throw Error('network'); });
  await assert.rejects(api.me(), error => error.status === 0);
  api.transport = async () => ({ok: true, status: 200, json: async () => ({api_version: '2'})});
  await assert.rejects(api.me(), error => error.code === 'api_version_mismatch');
});
