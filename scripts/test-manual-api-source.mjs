import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

const source = buildSync({
  entryPoints: ['src/main/services/manual-api-source.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
}).outputFiles[0].text;
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from('test-encrypted:' + value),
  decryptString: (value) => {
    const text = value.toString();
    if (!text.startsWith('test-encrypted:'))
      throw new Error('Invalid ciphertext');
    return text.slice('test-encrypted:'.length);
  },
};
const module = { exports: {} };
vm.runInNewContext(source, {
  module,
  exports: module.exports,
  require: () => ({ safeStorage }),
  Buffer,
  URL,
  fetch,
  AbortSignal,
  setInterval,
  clearInterval,
});
const {
  validateManualSource,
  extractManualUsage,
  fetchManualUsage,
  ManualApiSourceService,
} = module.exports;
const draft = (patch = {}) => ({
  id: 'custom-test',
  endpoint: 'https://quota.example/balance',
  apiKey: 'fake-test-key',
  template: 'json',
  confirmedOrigin: 'https://quota.example',
  remainingPath: 'balance',
  unit: 'USD',
  ...patch,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('manual credentials require the exact user-confirmed origin', () => {
  assert.equal(validateManualSource(draft()).origin, 'https://quota.example');
  assert.throws(
    () =>
      validateManualSource(draft({ confirmedOrigin: 'https://other.example' })),
    /目标域名/,
  );
  assert.throws(
    () => validateManualSource(draft({ endpoint: 'file:///tmp/source' })),
    /服务地址/,
  );
  assert.throws(
    () =>
      validateManualSource(
        draft({ endpoint: 'https://user:password@quota.example' }),
      ),
    /服务地址/,
  );
  assert.throws(() => validateManualSource(draft({ apiKey: '' })), /有效密钥/);
  assert.throws(
    () => validateManualSource(draft({ template: 'new-api' })),
    /用户 ID/,
  );
});

test('templates parse actual response shapes and preserve zero or unlimited quotas', () => {
  assert.equal(
    extractManualUsage(
      { data: { remaining: '0' } },
      { template: 'json', remainingPath: 'data.remaining', unit: 'CNY' },
    )[0].remaining,
    0,
  );
  assert.equal(
    extractManualUsage(
      { balance: '-0.5' },
      { template: 'json', remainingPath: 'balance' },
    )[0].remaining,
    -0.5,
  );
  const newApi = extractManualUsage(
    { success: true, data: { quota: 1000000, used_quota: 500000 } },
    { template: 'new-api' },
  )[0];
  assert.equal(newApi.remaining, 2);
  assert.equal(newApi.used, 1);
  assert.equal(newApi.total, 3);
  assert.equal(
    extractManualUsage(
      { remaining: -1, planName: 'Unlimited' },
      { template: 'sub2api' },
    )[0].extra,
    '无限额',
  );
  assert.equal(
    extractManualUsage(
      { balance_infos: [{ currency: 'CNY', total_balance: '12.34' }] },
      { template: 'deepseek' },
    )[0].remaining,
    12.34,
  );
  assert.equal(
    extractManualUsage(
      { data: { total_credits: 100, total_usage: 40 } },
      { template: 'openrouter' },
    )[0].remaining,
    60,
  );
  assert.throws(
    () =>
      extractManualUsage(
        { success: false, balance: 20 },
        { template: 'json', remainingPath: 'balance' },
      ),
    /无效额度/,
  );
  assert.throws(
    () =>
      extractManualUsage(
        {},
        { template: 'json', remainingPath: '__proto__.balance' },
      ),
    /有效额度字段/,
  );
});

test('request templates keep credentials on the confirmed origin and disable redirects', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url: url.toString(), options });
    return new Response(
      JSON.stringify({ data: { total_credits: 100, total_usage: 20 } }),
    );
  };
  const record = validateManualSource(
    draft({ endpoint: 'https://quota.example/api/v1', template: 'openrouter' }),
  );
  const plans = await fetchManualUsage(record, fetcher);
  assert.equal(requests[0].url, 'https://quota.example/api/v1/credits');
  assert.equal(
    requests[0].options.headers.Authorization,
    'Bearer fake-test-key',
  );
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(plans[0].remaining, 80);
  await assert.rejects(
    fetchManualUsage(
      { ...record, confirmedOrigin: 'https://other.example' },
      fetcher,
    ),
    /确认/,
  );
  assert.equal(requests.length, 1);
});

test('oversized and unsuccessful API responses fail without generating zero quota', async () => {
  const record = validateManualSource(draft());
  await assert.rejects(
    fetchManualUsage(
      record,
      async () => new Response('denied', { status: 401 }),
    ),
    /401/,
  );
  await assert.rejects(
    fetchManualUsage(
      record,
      async () => new Response('x'.repeat(1024 * 1024 + 1)),
    ),
    /过大/,
  );
  await assert.rejects(
    fetchManualUsage(record, async () => new Response('{}')),
    /有效额度字段/,
  );
});

test('encrypted persistence, restart, blank-key edits and failed saves preserve the active source', async () => {
  let blob;
  let fail = false;
  let bindings;
  const headers = [];
  const store = {
    load: () => blob,
    save: (value, next) => {
      if (fail) throw new Error('disk full');
      blob = value;
      bindings = next;
    },
    changed: () => {},
  };
  const fetcher = async (_url, options) => {
    headers.push(options.headers.Authorization);
    return new Response('{"balance":12.5}');
  };
  const service = new ManualApiSourceService(store, fetcher);
  service.configure(draft());
  await tick();
  assert.ok(!blob.includes('fake-test-key'));
  assert.ok(!JSON.stringify(bindings).includes('fake-test-key'));
  assert.equal(service.state()['custom-test'].plans[0].remaining, 12.5);
  fail = true;
  assert.throws(
    () => service.configure(draft({ apiKey: 'replacement-key' })),
    /disk full/,
  );
  fail = false;
  service.configure(draft({ apiKey: '', endpoint: '' }));
  await tick();
  assert.equal(headers.at(-1), 'Bearer fake-test-key');
  service.dispose();
  const restored = new ManualApiSourceService(store, fetcher);
  restored.start();
  await tick();
  assert.equal(restored.state()['custom-test'].plans[0].remaining, 12.5);
  assert.equal(headers.at(-1), 'Bearer fake-test-key');
  restored.dispose();
});

test('deleting an in-flight source discards stale responses and failures never expose a key', async () => {
  let release;
  const store = { load: () => undefined, save: () => {}, changed: () => {} };
  const service = new ManualApiSourceService(
    store,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  service.configure(draft());
  assert.ok(service.retain([]));
  service.prune([]);
  release(new Response('{"balance":42}'));
  await tick();
  assert.equal(service.state()['custom-test'], undefined);
  service.dispose();
  const broken = new ManualApiSourceService(store, async () => {
    throw new Error('fake-test-key');
  });
  broken.configure(draft());
  await tick();
  assert.ok(broken.state()['custom-test'].error);
  assert.equal(broken.state()['custom-test'].plans.length, 0);
  assert.ok(!JSON.stringify(broken.state()).includes('fake-test-key'));
  broken.dispose();
});
