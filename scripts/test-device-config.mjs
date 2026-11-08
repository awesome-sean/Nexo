/**
 * DeviceConfigService 自动化单元测试
 * 运行方式：node scripts/test-device-config.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DeviceConfigService,
  formatMacAddress,
  maskMacAddress,
  parseScanOutput,
} from '../src/main/services/device-config-service.ts';

// 1. MAC 格式化与脱敏测试
assert.equal(formatMacAddress('001122334455'), '00:11:22:33:44:55');
assert.equal(formatMacAddress('00:11:22:33:44:55'), '00:11:22:33:44:55');
assert.equal(maskMacAddress('001122334455'), '00:11:**:**:44:55');
assert.equal(maskMacAddress('00:11:22:33:44:55'), '00:11:**:**:44:55');
assert.equal(maskMacAddress('invalid'), '***');

// 2. 临时测试环境创建
const tempDir = path.join(os.tmpdir(), `pulse-test-config-${Date.now()}`);
fs.mkdirSync(tempDir, { recursive: true });
const testConfigPath = path.join(tempDir, 'device.json');
const service = new DeviceConfigService(testConfigPath);

try {
  // 3. 不存在文件
  const s1 = service.getDeviceConfigStatus();
  assert.equal(s1.exists, false);
  assert.equal(s1.valid, false);

  // 4. 非法 JSON
  fs.writeFileSync(testConfigPath, '{ bad json');
  const s2 = service.getDeviceConfigStatus();
  assert.equal(s2.exists, true);
  assert.equal(s2.valid, false);

  // 5. 缺少 authkey
  fs.writeFileSync(testConfigPath, JSON.stringify({ addr: '00:11:22:33:44:55' }));
  const s3 = service.getDeviceConfigStatus();
  assert.equal(s3.valid, false);

  // 6. authkey 长度不对
  fs.writeFileSync(testConfigPath, JSON.stringify({ addr: '00:11:22:33:44:55', authkey: 'short' }));
  const s4 = service.getDeviceConfigStatus();
  assert.equal(s4.valid, false);

  // 7. addr 长度不对
  fs.writeFileSync(
    testConfigPath,
    JSON.stringify({ addr: 'invalid', authkey: '0123456789abcdef0123456789abcdef' })
  );
  const s5 = service.getDeviceConfigStatus();
  assert.equal(s5.valid, false);

  // 8. 正确配置
  const validConfig = {
    name: 'Xiaomi Smart Band 10',
    addr: '00:11:22:33:44:55',
    connectType: 'spp',
    authkey: '0123456789abcdef0123456789abcdef',
    codename: 'o66',
  };
  fs.writeFileSync(testConfigPath, JSON.stringify(validConfig));
  const s6 = service.getDeviceConfigStatus();
  assert.equal(s6.exists, true);
  assert.equal(s6.valid, true);
  assert.equal(s6.deviceName, 'Xiaomi Smart Band 10');
  assert.equal(s6.maskedAddr, '00:11:**:**:44:55');
  assert.equal(s6.codename, 'o66');
  assert.equal('authkey' in s6, false, '脱敏状态对象绝不能包含 authkey');

  // 9. saveDeviceConfig: 直接使用有效配置
  const r1 = await service.saveDeviceConfig({ useExisting: true });
  assert.equal(r1.ok, true);
  assert.equal(r1.deviceName, 'Xiaomi Smart Band 10');
  assert.equal(r1.maskedAddr, '00:11:**:**:44:55');

  // 10. saveDeviceConfig: 日志文件缺失报错
  const r2 = await service.saveDeviceConfig({ logPath: 'nonexistent.log' });
  assert.equal(r2.ok, false);

  // ===== 以下覆盖真正的写入分支 =====
  // 注意：上面的 useExisting 分支只做校验、**不写文件**，所以原有测试从未进入写入路径。
  // 这里构造最小日志 fixture，并注入"已配对手环"（避免依赖本机真实蓝牙设备树）。

  // 11. 原子写入：成功写入，且 authkey / addr 满足 core 的解析契约
  const logPath = path.join(tempDir, 'XiaomiFit.main.log');
  fs.writeFileSync(
    logPath,
    'INFO device bind ok deviceKey=0123456789abcdef0123456789abcdeff2b9d40856 model=o66'
  );
  service.getPairedBandDevices = async () => [
    {
      id: 'bth\\dev_001122334455',
      name: 'Xiaomi Smart Band 10',
      maskedMac: '00:11:**:**:44:55',
      isXiaomiBand: true,
      rawMac: '001122334455',
    },
  ];

  const w1 = await service.saveDeviceConfig({ logPath });
  assert.equal(w1.ok, true, `写入应成功: ${w1.error || ''}`);

  const written = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
  assert.match(written.authkey, /^[0-9a-f]{32}$/, 'authkey 必须是 32 位 hex');
  assert.equal(written.addr, '00:11:22:33:44:55', 'addr 必须是 core 可解析的 MAC');
  assert.equal(fs.existsSync(`${testConfigPath}.tmp`), false, '成功写入后不应残留 .tmp');

  // 12. 原子性核心断言：rename 失败时旧配置必须逐字节不变（不能出现截断/半写配置）
  const beforeBytes = fs.readFileSync(testConfigPath, 'utf8');
  const originalRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error('模拟 rename 失败');
  };
  let w2;
  try {
    w2 = await service.saveDeviceConfig({ logPath });
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(w2.ok, false, 'rename 失败时必须返回 ok:false');
  assert.equal(
    fs.readFileSync(testConfigPath, 'utf8'),
    beforeBytes,
    '写入失败后旧配置必须保持不变（原子替换语义）'
  );
  assert.equal(fs.existsSync(`${testConfigPath}.tmp`), false, '写入失败后不应残留 .tmp');

  // 13. 失败后仍能正常再次写入（临时文件已清理，不阻塞后续保存）
  const w3 = await service.saveDeviceConfig({ logPath });
  assert.equal(w3.ok, true, '失败后应能重新写入');

  // ===== 未在 Windows 配对过的新用户（没有已配对列表） =====
  service.getPairedBandDevices = async () => [];
  const readAddr = () => JSON.parse(fs.readFileSync(testConfigPath, 'utf8')).addr;

  // 14. 扫描输出：只留小米手环，地址归一化
  const scanned = parseScanOutput(
    JSON.stringify([
      { name: 'Xbox Wireless Controller', addr: 'A0:5A:00:00:35:3F' },
      { name: 'Xiaomi Smart Band 10 BEEF', addr: '11:22:33:44:BE:EF' },
    ])
  );
  assert.deepEqual(scanned.map((d) => d.id), ['scan_11223344beef']);
  assert.equal(scanned[0].maskedMac, '11:22:**:**:BE:EF');
  assert.deepEqual(parseScanOutput(''), []);

  // 15. 日志里没有 MAC、也没选设备：报错要指向扫描 / 手动输入，而不是 Windows 设置
  const n1 = await service.saveDeviceConfig({ logPath });
  assert.equal(n1.ok, false);
  assert.match(n1.error, /扫描附近手环/);
  assert.doesNotMatch(n1.error, /Windows/);

  // 16. 手动输入 MAC（任意分隔符）
  const n2 = await service.saveDeviceConfig({ logPath, manualMac: '00-11-22-33-44-55' });
  assert.equal(n2.ok, true, n2.error);
  assert.equal(readAddr(), '00:11:22:33:44:55');
  assert.equal(JSON.parse(fs.readFileSync(testConfigPath, 'utf8')).name, 'Xiaomi Smart Band 9 4455');

  // 17. 手动输入格式不对
  const n3 = await service.saveDeviceConfig({ logPath, manualMac: '04:34:C3' });
  assert.equal(n3.ok, false);
  assert.match(n3.error, /12 位十六进制/);

  // 18. 日志里带绑定二维码 URL 的完整 MAC：不选设备也能保存
  const logWithMac = path.join(tempDir, 'with-mac.log');
  fs.writeFileSync(
    logWithMac,
    'encryptKey=0123456789abcdef0123456789abcdef\nscanResult:https://hlth.io.mi.com/download?name=Xiaomi&mac=AABBCCDDEEFF'
  );
  const n4 = await service.saveDeviceConfig({ logPath: logWithMac });
  assert.equal(n4.ok, true, n4.error);
  assert.equal(readAddr(), 'AA:BB:CC:DD:EE:FF');

  // 19. 用户选中的扫描结果优先于日志 MAC
  service.scannedDevices = scanned;
  const n5 = await service.saveDeviceConfig({ logPath: logWithMac, selectedDeviceId: 'scan_11223344beef' });
  assert.equal(n5.ok, true, n5.error);
  assert.equal(readAddr(), '11:22:33:44:BE:EF');
  assert.equal(n5.deviceName, 'Xiaomi Smart Band 10 BEEF');

  // 20. 选中的设备已不在列表里（扫描结果过期）：报错，不回退到日志 MAC，也不改写 device.json
  service.scannedDevices = [];
  const n6 = await service.saveDeviceConfig({ logPath: logWithMac, selectedDeviceId: 'scan_0000deadbeef' });
  assert.equal(n6.ok, false);
  assert.match(n6.error, /重新扫描/);
  assert.equal(readAddr(), '11:22:33:44:BE:EF');

  // Explicit manual model choice reaches the saved config and cannot override a conflicting generation.
  const manualNfc = await service.saveDeviceConfig({logPath, manualMac:'11:22:33:44:BE:EF', model:'band10-nfc'});
  assert.equal(manualNfc.ok, true, manualNfc.error);
  const nfcConfig = JSON.parse(fs.readFileSync(testConfigPath,'utf8'));
  assert.equal(nfcConfig.model, 'band10-nfc');
  assert.equal(nfcConfig.name, '小米手环 10 NFC 版');
  assert.equal(nfcConfig.codename, '');
  assert.equal(service.getDeviceConfigStatus().model, 'band10-nfc');
  assert.equal(service.getDeviceConfigStatus().screenHeight, 520);
  const beforeMismatch = fs.readFileSync(testConfigPath, 'utf8');
  service.scannedDevices = scanned;
  const conflict = await service.saveDeviceConfig({logPath, selectedDeviceId:'scan_11223344beef', model:'band11'});
  assert.equal(conflict.ok, false);
  assert.equal(fs.readFileSync(testConfigPath,'utf8'), beforeMismatch);
  assert.equal(service.saveImportedDevice({name:'Xiaomi Smart Band 10 Pro',addr:'11:22:33:44:BE:EF',authkey:'1'.repeat(32),model:'band10'}).ok, false);
  console.log('✅ DeviceConfigService 单元测试全部通过（含多型号与 NFC 保存回归）');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
