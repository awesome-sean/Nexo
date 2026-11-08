/**
 * 检查更新 + 下载安装包（GitHub Releases）。
 *
 * 发布流程上传 `Nexo-Setup-<版本>.exe` 和对应的 `.sha256`。
 * 下载后必须用 .sha256 校验，校验不过就删掉，绝不启动一个没对上哈希的 exe。
 * 下载地址由主进程从 Nexo 的 GitHub Releases 读取。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isVersionNewer } from './version-check.ts';
import { UPDATE_REPOSITORY, UPDATE_RELEASES_URL } from '../../common/update-source.ts';

export const RELEASES_API = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${UPDATE_REPOSITORY}/releases/download/`;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  unpublished?: boolean;
  /** 安装包与校验文件都在 release 里时才有，缺一个就只能去网页手动下载 */
  installer?: { name: string; url: string; size: number; checksumUrl: string };
}

export interface DownloadProgress {
  received: number;
  total: number;
  stage?: 'downloading' | 'verifying';
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function parseRelease(release: any, currentVersion: string): UpdateInfo {
  const latestVersion = typeof release?.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : '';
  if (!/^\d+\.\d+\.\d+$/.test(latestVersion) || release.draft || release.prerelease) {
    throw new Error('GitHub 正式版本信息无效');
  }
  const tag = encodeURIComponent(release.tag_name);
  const releaseUrl = `${UPDATE_RELEASES_URL}/tag/${tag}`;
  const assets: any[] = Array.isArray(release?.assets) ? release.assets : [];
  const name = `Nexo-Setup-${latestVersion}.exe`;
  const exe = assets.find((a) => a?.name === name);
  const sha = assets.find((a) => a?.name === `${name}.sha256`);
  const trusted = (a: any) => typeof a?.name === 'string' && a.browser_download_url === `${DOWNLOAD_PREFIX}${tag}/${encodeURIComponent(a.name)}`;

  return {
    currentVersion,
    latestVersion,
    updateAvailable: isVersionNewer(latestVersion, currentVersion),
    releaseUrl,
    installer:
      trusted(exe) && trusted(sha)
        ? { name, url: exe.browser_download_url, size: Number(exe.size) || 0, checksumUrl: sha.browser_download_url }
        : undefined,
  };
}

export async function fetchUpdateInfo(currentVersion: string, fetchImpl: FetchLike = fetch): Promise<UpdateInfo> {
  const res = await fetchImpl(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return { currentVersion, latestVersion: '', updateAvailable: false, releaseUrl: UPDATE_RELEASES_URL, unpublished: true };
  if (!res.ok) throw new Error(res.status === 403 || res.status === 429 ? 'GitHub 请求暂时受限，请稍后重试' : `GitHub 返回 ${res.status}`);
  return parseRelease(await res.json(), currentVersion);
}

/** 下载安装包时的空闲超时：多久收不到一个字节就判定链路已死（不是总时长） */
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

/**
 * 下载到 destDir，边写边算 SHA256；对不上就删掉并抛错。返回安装包路径。
 *
 * idleTimeoutMs 可注入，便于测试用很小的值跑超时路径。
 */
export async function downloadInstaller(
  installer: NonNullable<UpdateInfo['installer']>,
  destDir: string,
  onProgress: (p: DownloadProgress) => void,
  fetchImpl: FetchLike = fetch,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS
): Promise<string> {
  const shaRes = await fetchImpl(installer.checksumUrl, { signal: AbortSignal.timeout(30_000) });
  if (!shaRes.ok) throw new Error(`下载校验文件失败：${shaRes.status}`);
  const expected = (await shaRes.text()).trim().split(/\s+/)[0].toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('校验文件格式不对');
  if (!/^Nexo-Setup-\d+\.\d+\.\d+\.exe$/.test(installer.name)) throw new Error('安装包名称无效');

  // 空闲超时：连接半开（对端消失但没发 FIN）时 await 会永远不返回，界面就一直停在
  // 「下载中」，而且这个 promise 被上层缓存，重试也没用。每收到一个 chunk 就重置计时器；
  // 不用总时长超时 —— 安装包大、网速慢时会误杀。
  const controller = new AbortController();
  let idleTimer: NodeJS.Timeout | null = null;
  let idleTimedOut = false;
  const clearIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
  const resetIdle = () => {
    clearIdle();
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      controller.abort();
    }, idleTimeoutMs);
  };

  fs.mkdirSync(destDir, { recursive: true });
  const finalPath = path.join(destDir, installer.name);
  const partPath = `${finalPath}.part`;
  const out = fs.createWriteStream(partPath);

  // 写盘出错（磁盘满、目标被占用）时流会 emit 'error'；没有监听者就是未捕获异常，
  // 直接把主进程带走。这里先挂上监听，再让下面每个 await 都能把它变成 reject。
  let writeError: Error | null = null;
  out.on('error', (err: Error) => {
    writeError = err;
  });
  /** 等 drain；写入流出错时立刻 reject，不能干等一个永远不会来的 drain */
  const waitDrain = () =>
    new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        out.off('error', onErr);
        resolve();
      };
      const onErr = (e: Error) => {
        out.off('drain', onDrain);
        reject(e);
      };
      out.once('drain', onDrain);
      out.once('error', onErr);
    });

  const hash = createHash('sha256');
  let received = 0;
  try {
    resetIdle();
    const res = await fetchImpl(installer.url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`下载安装包失败：${res.status}`);
    const total = Number(res.headers.get('content-length')) || installer.size;

    for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
      resetIdle();
      if (writeError) throw writeError;
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await waitDrain();
      if (writeError) throw writeError;
      onProgress({ received, total });
    }

    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => {
        out.off('error', onErr);
        reject(e);
      };
      out.once('error', onErr);
      out.end(() => {
        out.off('error', onErr);
        resolve();
      });
    });
    if (writeError) throw writeError;

    onProgress({ received, total, stage: 'verifying' });
    if (hash.digest('hex') !== expected) throw new Error('安装包校验失败（SHA256 不一致），已删除，请重试');
    fs.renameSync(partPath, finalPath);
    return finalPath;
  } catch (err: any) {
    const failure = idleTimedOut
      ? new Error(`下载超时：${Math.round(idleTimeoutMs / 1000)} 秒没有收到数据，请重试`)
      : err;
    // Windows 上句柄没关就删会 EBUSY，先等流真正关闭
    if (!out.closed) await new Promise<void>((r) => out.destroy().once('close', () => r()));
    try { fs.unlinkSync(partPath); } catch { /* Preserve the download or write failure. */ }
    throw failure;
  } finally {
    clearIdle();
  }
}

/** A shared download survives closing and reopening the About screen. */
export class DesktopUpdateService {
  private info: UpdateInfo | null = null;
  private checkTask: Promise<UpdateInfo> | null = null;
  private downloadTask: Promise<string> | null = null;
  private downloaded: { file: string; version: string; hash: string } | null = null;

  private currentVersion: string;
  private directory: string;
  private fetchImpl: FetchLike;

  constructor(currentVersion: string, directory: string, fetchImpl: FetchLike = fetch) {
    this.currentVersion = currentVersion;
    this.directory = directory;
    this.fetchImpl = fetchImpl;
  }

  get downloadedVersion(): string | undefined { return this.downloaded?.version; }
  get downloading(): boolean { return this.downloadTask !== null; }

  check(): Promise<UpdateInfo> {
    if (this.downloadTask && this.info) return Promise.resolve(this.info);
    if (this.checkTask) return this.checkTask;
    this.checkTask = fetchUpdateInfo(this.currentVersion, this.fetchImpl).then(info => {
      this.info = info;
      if (this.downloaded?.version !== info.latestVersion) this.downloaded = null;
      return info;
    }).finally(() => { this.checkTask = null; });
    return this.checkTask;
  }

  download(onProgress: (progress: DownloadProgress) => void): Promise<string> {
    if (this.downloadTask) return this.downloadTask;
    this.downloadTask = (async () => {
      const info = await this.check();
      if (!info.updateAvailable || !info.installer) throw new Error('发布页尚无可下载的新版本安装包和校验文件');
      this.downloaded = null;
      const file = await downloadInstaller(info.installer, this.directory, onProgress, this.fetchImpl);
      this.downloaded = { file, version: info.latestVersion, hash: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
      return info.latestVersion;
    })().finally(() => { this.downloadTask = null; });
    return this.downloadTask;
  }

  verifiedInstaller(): string {
    if (this.downloading || !this.downloaded) throw new Error('请先下载完成新版安装包');
    const { file, hash, version } = this.downloaded;
    if (!isVersionNewer(version, this.currentVersion) || !fs.existsSync(file) || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash) {
      this.downloaded = null;
      throw new Error('本地更新包校验失败，请重新下载');
    }
    return file;
  }
}
