import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// Prepare an already-built release. Publishing is a separate explicit action.
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const root = path.resolve(import.meta.dirname, '..');
const releaseDirectory = path.resolve(process.argv[2] || path.join(root, 'release'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `Nexo-Setup-${pkg.version}.exe`;
const installer = path.join(releaseDirectory, name);
const archive = path.join(releaseDirectory, 'win-unpacked/resources/app.asar');
const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
if (packaged.version !== pkg.version) throw new Error('桌面安装包版本与源码版本不一致，请重新构建');
const bundledRpk = asar.extractFile(archive, 'assets/band-app.rpk');
if (!bundledRpk.equals(fs.readFileSync(path.join(root, 'assets/band-app.rpk')))) {
  throw new Error('安装包内的快应用与待发布资源不一致，请重新构建');
}
const checksum = createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
fs.writeFileSync(`${installer}.sha256`, `${checksum}  ${name}\n`);
const bandVersion = JSON.parse(fs.readFileSync(path.join(root, 'band-app/src/manifest.json'), 'utf8')).versionName;
const bandAsset = path.join(releaseDirectory, `Nexo-Band-${bandVersion}.rpk`);
fs.writeFileSync(bandAsset, bundledRpk);
fs.writeFileSync(`${bandAsset}.sha256`, `${createHash('sha256').update(bundledRpk).digest('hex')}  ${path.basename(bandAsset)}\n`);
console.log(`Release v${pkg.version} assets ready in ${releaseDirectory}`);
console.log([name, `${name}.sha256`, path.basename(bandAsset), `${path.basename(bandAsset)}.sha256`].join('\n'));
