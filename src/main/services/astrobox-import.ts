import { identifyBandModel, type BandModelId } from '../../common/band-models.ts';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { maskMacAddress, type DeviceConfigService, type SaveDeviceConfigResult } from './device-config-service.ts';

const API_BASE = 'http://127.0.0.1:10721';
const isKnownBand = (name: string) => Boolean(identifyBandModel(name));

export interface AstroBoxImportDevice {
  id: string;
  name: string;
  maskedMac: string;
  connected: boolean;
  model?: BandModelId;
  connectionAvailable?: boolean;
  modelStatus?: string;
}

export interface AstroBoxImportList {
  ok: boolean;
  devices: AstroBoxImportDevice[];
  pairingRequired?: boolean;
  error?: string;
}

interface SavedIdentity {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

interface DeviceRecord {
  deviceId: string;
  name: string;
  authkey?: string;
  connectType?: string;
  connectionState: string;
  codename?: string;
}

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super('AstroBox 本地接口请求失败。');
    this.status = status;
    this.code = code;
  }
}

class PairingRequired extends Error {}

/** Based on the public AstroBox Local API contract. Credentials remain in the main process. */
export class AstroBoxImportService {
  private identity?: SavedIdentity;
  private token?: { value: string; expiresAt: number };
  private pairing?: { id: string; expiresAt: number };
  private devices = new Map<string, string>();
  private listing?: Promise<AstroBoxImportList>;
  private identityPath: string;
  private config: DeviceConfigService;
  private fetcher: typeof fetch;

  constructor(
    identityPath: string,
    config: DeviceConfigService,
    fetcher: typeof fetch = fetch,
  ) {
    this.identityPath = identityPath;
    this.config = config;
    this.fetcher = fetcher;
  }

  private async request(endpoint: string, body?: unknown, token?: string): Promise<any> {
    let response: Response;
    try {
      response = await this.fetcher(API_BASE + endpoint, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(4_000),
        redirect: 'error',
      });
    } catch {
      throw new Error('无法连接 AstroBox。请打开电脑端 AstroBox，并确认本地 API 服务可用，再点击重新读取。');
    }
    let data: any;
    try {
      const text = await response.text();
      if (text.length > 1_048_576) throw new Error();
      data = text ? JSON.parse(text) : {};
    } catch {
      if (!response.ok) throw new ApiError(response.status, '');
      throw new Error('AstroBox 返回的数据格式异常。请更新 AstroBox 后重试。');
    }
    if (!response.ok) throw new ApiError(response.status, typeof data?.error?.code === 'string' ? data.error.code : '');
    if (data?.ok === false) throw new Error('AstroBox 未能读取设备，请在 AstroBox 中检查设备同步状态。');
    return data;
  }

  private getIdentity(): SavedIdentity {
    if (this.identity) return this.identity;
    if (fs.existsSync(this.identityPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.identityPath, 'utf8'));
        if (typeof data.publicKey !== 'string' || typeof data.privateKey !== 'string') throw new Error();
        createPrivateKey({ key: Buffer.from(data.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
        this.identity = {
          publicKey: data.publicKey,
          privateKey: data.privateKey,
          fingerprint: createHash('sha256').update(Buffer.from(data.publicKey, 'base64url')).digest('hex'),
        };
        return this.identity;
      } catch {
        throw new Error('Nexo 的 AstroBox 授权文件读取失败，请检查本机配置目录的访问权限。');
      }
    }
    const keys = generateKeyPairSync('ed25519');
    const publicKey = keys.publicKey.export({ format: 'jwk' }).x!;
    const identity = {
      publicKey,
      privateKey: keys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
      fingerprint: createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('hex'),
    };
    const temporary = `${this.identityPath}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.identityPath), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(identity), { mode: 0o600 });
      fs.renameSync(temporary, this.identityPath);
    } catch {
      throw new Error('无法保存 Nexo 的 AstroBox 授权文件，请检查本机配置目录的写入权限。');
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    this.identity = identity;
    return identity;
  }

  private async authorize(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 5_000) return this.token.value;
    const identity = this.getIdentity();
    if (this.pairing) {
      const pairing = await this.request(`/v2/auth/pairing-requests/${encodeURIComponent(this.pairing.id)}`);
      if (pairing.state === 'denied') {
        this.pairing = undefined;
        throw new Error('AstroBox 中的授权已被拒绝。再次读取可重新申请。');
      }
      if (pairing.state !== 'granted') {
        if (pairing.state === 'expired' || this.pairing.expiresAt <= Date.now()) {
          this.pairing = undefined;
          throw new Error('AstroBox 授权请求已过期，请重新读取并在 AstroBox 中批准。');
        }
        throw new PairingRequired();
      }
      this.pairing = undefined;
    }
    let challenge: any;
    try {
      challenge = await this.request('/v2/auth/challenges', { fingerprint: identity.fingerprint });
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'client_not_paired') throw error;
      const pairing = await this.request('/v2/auth/pairing-requests', {
        clientName: 'Nexo', publicKey: identity.publicKey,
        requestedScopes: ['device.read'], deviceAllowlist: [],
      });
      if (typeof pairing.pairingId !== 'string') throw new Error('AstroBox 的授权响应不完整，请更新后重试。');
      this.pairing = { id: pairing.pairingId, expiresAt: Date.parse(pairing.expiresAt) || Date.now() + 300_000 };
      throw new PairingRequired();
    }
    if (typeof challenge.signingPayload !== 'string' || typeof challenge.challengeId !== 'string') {
      throw new Error('AstroBox 的授权验证数据不完整，请更新后重试。');
    }
    const privateKey = createPrivateKey({ key: Buffer.from(identity.privateKey, 'base64'), type: 'pkcs8', format: 'der' });
    const signature = sign(null, Buffer.from(challenge.signingPayload, 'base64url'), privateKey).toString('base64url');
    const session = await this.request('/v2/auth/sessions', { challengeId: challenge.challengeId, signature });
    const expiresAt = Date.parse(session.expiresAt);
    if (typeof session.token !== 'string' || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error('AstroBox 的授权会话无效，请重新读取。');
    }
    this.token = { value: session.token, expiresAt };
    return session.token;
  }

  private async readDevices(): Promise<{ legacy: boolean; records: DeviceRecord[] }> {
    let data: any;
    let legacy = false;
    try {
      data = await this.request('/v2/devices');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 404) {
        legacy = true;
        data = await this.request('/device/list');
      } else if (error.status !== 401 && error.status !== 403) throw error;
    }
    if (!legacy) {
      const token = await this.authorize();
      try {
        data = await this.request('/v2/devices', undefined, token);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) this.token = undefined;
        throw error;
      }
    }
    if (!Array.isArray(data?.devices) || data.devices.length > 200) throw new Error('AstroBox 的设备列表格式异常。');
    const records = data.devices.filter((device: any) => device && typeof device.name === 'string').map((device: any) => ({
      deviceId: legacy ? device.addr : device.deviceId,
      name: device.name,
      authkey: device.authkey,
      connectType: device.connectType,
      codename: device.codename,
      connectionState: legacy ? (device.connected ? 'connected' : 'disconnected') : device.connectionState,
    })).filter((device: DeviceRecord) => typeof device.deviceId === 'string' && isKnownBand(device.name));
    return { legacy, records };
  }

  listDevices(): Promise<AstroBoxImportList> {
    if (!this.listing) this.listing = this.loadList().finally(() => { this.listing = undefined; });
    return this.listing;
  }

  private async loadList(): Promise<AstroBoxImportList> {
    this.devices.clear();
    try {
      const { records } = await this.readDevices();
      const devices = records.filter((device) => /^[0-9a-f]{12}$/i.test(device.deviceId.replace(/[:-]/g, ''))).map((device) => {
        const id = randomUUID();
        this.devices.set(id, device.deviceId);
        const model = identifyBandModel(device.name)!;
        const connectionAvailable = !device.connectType || device.connectType.toLowerCase() === 'spp';
        return {
          id,
          model: model.id,
          connectionAvailable,
          modelStatus: connectionAvailable ? model.status : '当前连接方式尚未接入，请使用 SPP',
          name: device.name.slice(0, 100),
          maskedMac: maskMacAddress(device.deviceId),
          connected: device.connectionState === 'connected',
        };
      });
      return { ok: true, devices };
    } catch (error) {
      if (error instanceof PairingRequired) return { ok: false, devices: [], pairingRequired: true };
      return { ok: false, devices: [], error: this.errorMessage(error) };
    }
  }

  async importDevice(id: unknown): Promise<SaveDeviceConfigResult> {
    const deviceId = typeof id === 'string' ? this.devices.get(id) : undefined;
    if (!deviceId) return { ok: false, error: '请重新读取 AstroBox 设备，再选择要导入的手环。' };
    try {
      const { legacy, records } = await this.readDevices();
      let device = records.find((record) => record.deviceId === deviceId);
      if (!device) return { ok: false, error: '该手环已从 AstroBox 列表移除，请重新读取。' };
      if (!legacy) {
        device = await this.request(`/v2/devices/${encodeURIComponent(deviceId)}`, undefined, this.token?.value);
      }
      if (!device || device.deviceId !== deviceId || typeof device.name !== 'string' || !isKnownBand(device.name)) {
        return { ok: false, error: '设备信息已变化，请重新读取并选择小米手环 9、10 或 11 标准版 / NFC 版。' };
      }
      if (typeof device.authkey !== 'string' || !/^[0-9a-f]{32}$/i.test(device.authkey)) {
        return { ok: false, error: 'AstroBox 尚未提供有效的手环密钥。请先登录小米账号同步设备，再重试导入。' };
      }
      return this.config.saveImportedDevice({ name: device.name, addr: deviceId, authkey: device.authkey, connectType: device.connectType, codename: device.codename });
    } catch (error) {
      if (error instanceof PairingRequired) return { ok: false, error: '请在 AstroBox 中批准 Nexo 的读取请求，然后重新读取设备。' };
      return { ok: false, error: this.errorMessage(error) };
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) return 'AstroBox 未允许设备读取。请检查 Nexo 的授权并重新读取。';
      return 'AstroBox 本地接口暂不可用，请更新 AstroBox 并重试。';
    }
    return error instanceof Error ? error.message : '读取 AstroBox 设备失败，请重试。';
  }
}
