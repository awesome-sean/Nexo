import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { AstroBoxImportService } from '../src/main/services/astrobox-import.ts';
import { DeviceConfigService } from '../src/main/services/device-config-service.ts';

const addr = '00:00:00:00:00:09';
const authkey = '1'.repeat(32);
const band = { name: 'Xiaomi Smart Band 9 Test', addr, authkey, connectType: 'SPP', connected: false };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const unauthorized = () => json({ error: { code: 'unauthorized' } }, 401);

async function environment(fetcher, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-astrobox-test-'));
  const configPath = path.join(directory, 'device.json');
  const identityPath = path.join(directory, 'identity.json');
  const config = new DeviceConfigService(configPath);
  const service = new AstroBoxImportService(identityPath, config, async (url, options) => {
    assert.ok(url.startsWith('http://127.0.0.1:10721/'));
    assert.equal(options.redirect, 'error');
    return fetcher(new URL(url).pathname, options);
  });
  try { await run({ service, configPath, identityPath, config }); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('legacy import filters other devices and keeps keys and full MAC out of renderer results', async () => {
  await environment((endpoint) => {
    if (endpoint === '/v2/devices') return new Response('Not Found', { status: 404 });
    assert.equal(endpoint, '/device/list');
    return json({ ok: true, devices: [band, { ...band, name: 'Xiaomi Smart Band 9 Pro' }, { ...band, name: 'Headphones' }] });
  }, async ({ service, configPath }) => {
    const list = await service.listDevices();
    assert.equal(list.ok, true);
    assert.equal(list.devices.length, 1);
    assert.ok(!JSON.stringify(list).includes(authkey));
    assert.ok(!JSON.stringify(list).includes(addr));
    assert.equal(fs.existsSync(configPath), false);
    const result = await service.importDevice(list.devices[0].id);
    assert.equal(result.ok, true);
    assert.ok(!JSON.stringify(result).includes(authkey));
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(config.authkey, authkey);
    assert.equal(config.addr, addr);
    assert.equal(config.codename, 'o66');
    assert.equal(config.connectType, 'spp');
  });
});

test('import re-reads the selected device and rejects missing keys without replacing config', async () => {
  let current = band;
  await environment((endpoint) => endpoint === '/v2/devices'
    ? json({}, 404) : json({ ok: true, devices: [current] }), async ({ service, configPath }) => {
    fs.writeFileSync(configPath, 'previous config');
    const list = await service.listDevices();
    current = { ...band, authkey: 'missing' };
    assert.equal((await service.importDevice(list.devices[0].id)).ok, false);
    assert.equal(fs.readFileSync(configPath, 'utf8'), 'previous config');
    current = { ...band, authkey: '2'.repeat(32) };
    assert.equal((await service.importDevice(list.devices[0].id)).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(configPath)).authkey, '2'.repeat(32));
    assert.equal((await service.importDevice('forged-device-id')).ok, false);
  });
});

test('v2 requires approval, signs the challenge, and imports through the detail endpoint', async () => {
  let approved = false;
  let publicKey;
  let pairings = 0;
  const payload = Buffer.from('Nexo test challenge').toString('base64url');
  const device = { deviceId: addr, name: band.name, connectionState: 'disconnected', connectType: 'SPP' };
  await environment((endpoint, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    if (endpoint === '/v2/devices') {
      return options.headers.Authorization === 'Bearer test-session' ? json({ devices: [device] }) : unauthorized();
    }
    if (endpoint === '/v2/auth/challenges') {
      return approved ? json({ challengeId: 'test-challenge', signingPayload: payload })
        : json({ error: { code: 'client_not_paired' } }, 403);
    }
    if (endpoint === '/v2/auth/pairing-requests') {
      pairings++;
      assert.equal(body.clientName, 'Nexo');
      assert.deepEqual(body.requestedScopes, ['device.read']);
      publicKey = body.publicKey;
      return json({ pairingId: 'test-pairing', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    }
    if (endpoint === '/v2/auth/pairing-requests/test-pairing') return json({ state: approved ? 'granted' : 'pending' });
    if (endpoint === '/v2/auth/sessions') {
      assert.equal(body.challengeId, 'test-challenge');
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' });
      assert.equal(verify(null, Buffer.from(payload, 'base64url'), key, Buffer.from(body.signature, 'base64url')), true);
      return json({ token: 'test-session', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    }
    assert.equal(decodeURIComponent(endpoint), '/v2/devices/' + addr);
    assert.equal(options.headers.Authorization, 'Bearer test-session');
    return json({ ...device, authkey });
  }, async ({ service, identityPath, configPath }) => {
    const pending = await service.listDevices();
    assert.equal(pending.pairingRequired, true);
    assert.equal(fs.existsSync(configPath), false);
    assert.equal((await service.listDevices()).pairingRequired, true);
    assert.equal(pairings, 1, 'retries while pending must reuse the same approval request');
    approved = true;
    const list = await service.listDevices();
    assert.equal(list.ok, true);
    assert.equal((await service.importDevice(list.devices[0].id)).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(configPath)).authkey, authkey);
    assert.ok(!fs.readFileSync(identityPath, 'utf8').includes('test-session'), 'session stays in memory');
  });
});

test('denied v2 approval can be retried without silently switching to legacy', async () => {
  let pairings = 0;
  await environment((endpoint) => {
    assert.notEqual(endpoint, '/device/list');
    if (endpoint === '/v2/devices') return unauthorized();
    if (endpoint === '/v2/auth/challenges') return json({ error: { code: 'client_not_paired' } }, 403);
    if (endpoint === '/v2/auth/pairing-requests') {
      pairings++;
      return json({ pairingId: 'denied', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    }
    return json({ state: 'denied' });
  }, async ({ service }) => {
    assert.equal((await service.listDevices()).pairingRequired, true);
    assert.match((await service.listDevices()).error, /拒绝/);
    assert.equal((await service.listDevices()).pairingRequired, true);
    assert.equal(pairings, 2);
  });
});

test('connection failures, invalid JSON and raw upstream errors produce safe recoverable results', async () => {
  let mode = 'offline';
  await environment((endpoint) => {
    if (mode === 'offline') throw new Error('private-secret');
    if (mode === 'invalid') return new Response('invalid-json');
    if (mode === 'error') return json({ error: { code: 'unexpected', message: authkey } }, 500);
    return endpoint === '/v2/devices' ? json({}, 404) : json({ ok: true, devices: [] });
  }, async ({ service }) => {
    assert.match((await service.listDevices()).error, /打开电脑端 AstroBox/);
    mode = 'invalid';
    assert.equal((await service.listDevices()).ok, false);
    mode = 'error';
    assert.ok(!JSON.stringify(await service.listDevices()).includes(authkey));
    mode = 'empty';
    assert.deepEqual(await service.listDevices(), { ok: true, devices: [] });
  });
});

test('a public v2 discovery response still enters the authenticated device-read flow', async () => {
  await environment((endpoint) => {
    if (endpoint === '/v2/devices') return json({ devices: [] });
    if (endpoint === '/v2/auth/challenges') return json({ error: { code: 'client_not_paired' } }, 403);
    assert.equal(endpoint, '/v2/auth/pairing-requests');
    return json({ pairingId: 'public-discovery', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  }, async ({ service }) => {
    assert.equal((await service.listDevices()).pairingRequired, true);
  });
});

test('shared atomic writer keeps the previous config if saving an imported device fails', async () => {
  await environment(() => json({}), async ({ config, configPath }) => {
    fs.writeFileSync(configPath, 'previous config');
    const originalRename = fs.renameSync;
    fs.renameSync = () => { throw new Error('test write failure'); };
    try {
      assert.equal(config.saveImportedDevice(band).ok, false);
      assert.equal(fs.readFileSync(configPath, 'utf8'), 'previous config');
    } finally { fs.renameSync = originalRename; }
    assert.equal(fs.existsSync(configPath + '.tmp'), false);
    assert.equal(config.saveImportedDevice({ ...band, connectType: 'BLE' }).ok, false);
    assert.equal(config.saveImportedDevice(band).ok, true);
  });
});

test('recognizes standard and NFC generations while preserving transport and model metadata', async () => {
  const devices = [8,9,10,11].flatMap(generation => [false,true].map(nfc => ({
    ...band, addr: '00:00:00:00:' + String(generation).padStart(2,'0') + ':' + (nfc ? '02' : '01'),
    name: 'Xiaomi Smart Band ' + generation + (nfc ? ' NFC' : ''),
    connectType: generation === 8 ? 'BLE' : 'SPP',
  })));
  await environment(endpoint => endpoint === '/v2/devices' ? json({},404) : json({devices}), async ({service,configPath}) => {
    const list = await service.listDevices();
    assert.equal(list.devices.length, 6);
    assert.ok(list.devices.every(device => !device.model.startsWith('band8')));
    for (const device of list.devices) {
      const result = await service.importDevice(device.id);

        assert.equal(result.ok, true, result.error);
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.equal(config.model, device.model);
        assert.equal(config.screenWidth, device.model.startsWith('band9') ? 192 : 212);
        if (!device.model.startsWith('band9')) assert.equal(config.codename, '');
    }
    const before = fs.readFileSync(configPath,'utf8');
    devices[7].connectType = 'BLE';
    const last = list.devices.at(-1);
    assert.equal((await service.importDevice(last.id)).ok, false);
    assert.equal(fs.readFileSync(configPath,'utf8'), before);
  });
});
