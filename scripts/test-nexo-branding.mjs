import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Nexo user-facing views, reports and guides use the current brand', () => {
  const files = [
    'src/renderer/components/pulse/SettingsPage.tsx',
    'src/renderer/components/pulse/DiagnosticsScreen.tsx',
    'src/renderer/components/setup/InstallAppStep.tsx',
    'src/renderer/components/setup/SetupWizard.tsx',
    'src/renderer/components/setup/types.ts',
    'src/main/tray.ts',
    'src/main/services/support-report.ts',
    'README.md',
    'NEXO-README.md',
  ];
  for (const file of files) {
    const text = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\bPulse\b|\bCodeIsland\b|Nexo\.5/, file);
  }
  const settings = fs.readFileSync(new URL('../src/renderer/components/pulse/SettingsPage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /rewardQr|showReward|赞赏作者/);
});

test('Nexo upgrades use the verified in-app installer flow and include license notices', () => {
  const main = fs.readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /fetchUpdateInfo|downloadInstaller|github\.com\/kyrieove/);
  assert.match(main, /new DesktopUpdateService/);
  assert.match(main, /launchUpdate\(desktopUpdate\.verifiedInstaller\(\),/);
  const license = fs.readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
  const notices = fs.readFileSync(new URL('../assets/THIRD-PARTY-LICENSES.txt', import.meta.url), 'utf8');
  assert.ok(notices.startsWith(license));
  assert.match(notices, /Copyright \(c\) 2026 Leset0ng/);
});
