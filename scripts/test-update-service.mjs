/**
 * 检查更新 / 下载安装包自检。跑法：node --test scripts/test-update-service.mjs
 * 最要紧的是第 3 条：哈希对不上时安装包必须被删掉，不能留下一个可以被启动的 exe。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { parseRelease, downloadInstaller, fetchUpdateInfo, DesktopUpdateService, RELEASES_API } from '../src/main/services/update-service.ts';

const DL = 'https://github.com/sthess548/Nexo/releases/download/v2.0.2/';
const release = (assets) => ({ tag_name: 'v2.0.2', html_url: 'https://github.com/sthess548/Nexo/releases/tag/v2.0.2', assets });

test('parseRelease: 找到安装包和校验文件，判断有新版本', () => {
  const info = parseRelease(
    release([
      { name: 'Nexo-Setup-2.0.2.exe', size: 123, browser_download_url: `${DL}Nexo-Setup-2.0.2.exe` },
      { name: 'Nexo-Setup-2.0.2.exe.sha256', size: 89, browser_download_url: `${DL}Nexo-Setup-2.0.2.exe.sha256` },
    ]),
    '2.0.1'
  );
  assert.equal(info.latestVersion, '2.0.2');
  assert.equal(info.updateAvailable, true);
  assert.equal(info.installer.url, `${DL}Nexo-Setup-2.0.2.exe`);
  assert.equal(parseRelease(release([]), '2.0.2').updateAvailable, false);
});

test('parseRelease: 缺校验文件或地址不是本仓库 release 时不给下载', () => {
  assert.equal(parseRelease(release([{ name: 'Nexo-Setup-2.0.2.exe', browser_download_url: `${DL}Nexo-Setup-2.0.2.exe` }]), '2.0.1').installer, undefined);
  const evil = parseRelease(
    release([
      { name: 'Nexo-Setup-2.0.2.exe', browser_download_url: 'https://evil.example/Nexo-Setup-2.0.2.exe' },
      { name: 'Nexo-Setup-2.0.2.exe.sha256', browser_download_url: `${DL}Nexo-Setup-2.0.2.exe.sha256` },
    ]),
    '2.0.1'
  );
  assert.equal(evil.installer, undefined);
});

function serve(files) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const body = files[req.url];
      if (body === undefined) return res.writeHead(404).end();
      res.writeHead(200, { 'content-length': Buffer.byteLength(body) }).end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('downloadInstaller: 哈希一致时落盘并报告进度；不一致时删除并报错', async () => {
  const exe = Buffer.alloc(256 * 1024, 7);
  const good = createHash('sha256').update(exe).digest('hex');
  const server = await serve({ '/a.exe': exe, '/a.exe.sha256': `${good}  Nexo-Setup-2.0.2.exe\n`, '/bad.sha256': `${'0'.repeat(64)}  x\n` });
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-update-test-'));
  try {
    const progress = [];
    const file = await downloadInstaller(
      { name: 'Nexo-Setup-2.0.2.exe', url: `${base}/a.exe`, size: exe.length, checksumUrl: `${base}/a.exe.sha256` },
      dir,
      (p) => progress.push(p)
    );
    assert.deepEqual(fs.readFileSync(file), exe);
    assert.equal(progress.at(-1).received, exe.length);
    assert.equal(progress.at(-1).total, exe.length);

    await assert.rejects(
      downloadInstaller({ name: 'Nexo-Setup-9.9.9.exe', url: `${base}/a.exe`, size: exe.length, checksumUrl: `${base}/bad.sha256` }, dir, () => {}),
      /校验失败/
    );
    assert.equal(fs.existsSync(path.join(dir, 'Nexo-Setup-9.9.9.exe')), false, '校验失败不能留下 exe');
    assert.equal(fs.existsSync(path.join(dir, 'Nexo-Setup-9.9.9.exe.part')), false, '校验失败不能留下 .part');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('downloadInstaller: body 永不结束时按空闲超时 reject，不会永远卡住', async () => {
  const good = createHash('sha256').update(Buffer.from('x')).digest('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-update-idle-'));
  // 真的 fetch 会把 signal 接到 body 上；这里照做，否则 abort() 对假 body 没有任何效果。
  const hangingFetch = (url, init) => {
    if (String(url).endsWith('.sha256')) {
      return Promise.resolve({ ok: true, text: async () => `${good}  Nexo-Setup-2.0.2.exe\n` });
    }
    // 只吐一个 chunk，然后既不结束也不关闭 —— 模拟连接半开
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(1024));
        init.signal.addEventListener('abort', () => c.error(new Error('aborted')));
      },
    });
    return Promise.resolve({ ok: true, body, headers: { get: () => null } });
  };

  try {
    const started = Date.now();
    await assert.rejects(
      downloadInstaller(
        { name: 'Nexo-Setup-2.0.2.exe', url: 'https://example.invalid/a.exe', size: 999999, checksumUrl: 'https://example.invalid/a.exe.sha256' },
        dir,
        () => {},
        hangingFetch,
        200
      ),
      /下载超时/
    );
    assert.ok(Date.now() - started < 5000, '应该在空闲超时后很快返回，而不是一直挂着');
    assert.equal(fs.existsSync(path.join(dir, 'Nexo-Setup-2.0.2.exe.part')), false, '超时后不能留下 .part');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('downloadInstaller: 写入流出错时 reject，不崩进程', async () => {
  const exe = Buffer.alloc(128 * 1024, 3);
  const good = createHash('sha256').update(exe).digest('hex');
  const server = await serve({ '/a.exe': exe, '/a.exe.sha256': `${good}  Nexo-Setup-2.0.2.exe\n` });
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-update-werr-'));
  try {
    fs.mkdirSync(path.join(dir, 'Nexo-Setup-2.0.2.exe.part'));
    await assert.rejects(
      downloadInstaller(
        { name: 'Nexo-Setup-2.0.2.exe', url: `${base}/a.exe`, size: exe.length, checksumUrl: `${base}/a.exe.sha256` },
        dir,
        () => {}
      ),
      (err) => ['EISDIR', 'EPERM'].includes(err?.code)
    );
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('only stable releases from the configured repository are accepted', () => {
  for (const invalid of [{tag_name:'../bad'}, {tag_name:'v2.0.2',draft:true}, {tag_name:'v2.0.2',prerelease:true}]) {
    assert.throws(() => parseRelease(invalid, '2.0.1'), /无效/);
  }
  const assets = ['Nexo-Setup-2.0.2.exe','Nexo-Setup-2.0.2.exe.sha256'].map(name => ({name,browser_download_url:`${DL.replace('v2.0.2','v2.0.1')}${name}`}));
  assert.equal(parseRelease(release(assets),'2.0.1').installer,undefined);
});

test('an empty repository is distinguished from current-version and network errors', async () => {
  const info = await fetchUpdateInfo('0.4.12',async url => {
    assert.equal(url,'https://api.github.com/repos/sthess548/Nexo/releases/latest');
    return new Response('',{status:404});
  });
  assert.equal(info.unpublished,true);
  assert.equal(info.updateAvailable,false);
  await assert.rejects(fetchUpdateInfo('0.4.12',async()=>new Response('',{status:429})),/受限/);
});

test('shared update downloads recover from failure and reject tampered installers', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexo-update-service-'));
  const binary=Buffer.from('mock installer');
  const checksum=createHash('sha256').update(binary).digest('hex');
  const assets=['Nexo-Setup-2.0.2.exe','Nexo-Setup-2.0.2.exe.sha256'].map(name=>({name,size:binary.length,browser_download_url:DL+name}));
  let downloads=0;
  let fail=true;
  const service=new DesktopUpdateService('2.0.1',directory,async url=>{
    if(url===RELEASES_API) return Response.json(release(assets));
    if(url.endsWith('.sha256')) return new Response(checksum);
    downloads++;
    if(fail) throw new Error('offline');
    return new Response(binary);
  });
  try {
    assert.throws(()=>service.verifiedInstaller(),/先下载/);
    await assert.rejects(service.download(()=>{}),/offline/);
    fail=false;
    const first=service.download(()=>{});
    assert.equal(service.download(()=>{}),first);
    assert.equal(await first,'2.0.2');
    assert.equal(downloads,2);
    assert.equal(service.downloadedVersion,'2.0.2');
    const file=service.verifiedInstaller();
    fs.writeFileSync(file,'tampered');
    assert.throws(()=>service.verifiedInstaller(),/校验失败/);
    assert.equal(service.downloadedVersion,undefined);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
