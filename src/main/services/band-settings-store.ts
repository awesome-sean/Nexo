import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BAND_SETTINGS, type BandSettings } from '../../common/band-settings';

export class BandSettingsStore {
  private settings: BandSettings = { ...DEFAULT_BAND_SETTINGS };

  constructor(private file: string) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof saved?.vibrationEnabled === 'boolean') {
        this.settings = {
          vibrationEnabled: saved.vibrationEnabled,
          revision: Number.isSafeInteger(saved.revision) && saved.revision >= 0 ? saved.revision : 0,
        };
      }
    } catch { /* Existing installations keep vibration enabled until a setting is saved. */ }
  }

  get(): BandSettings {
    return { ...this.settings };
  }

  setVibration(enabled: unknown): BandSettings {
    if (typeof enabled !== 'boolean') throw new Error('手环震动设置无效');
    if (enabled === this.settings.vibrationEnabled) return this.get();
    const next = { vibrationEnabled: enabled, revision: Math.max(Date.now(), this.settings.revision + 1) };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(next), 'utf8');
    fs.renameSync(temporary, this.file);
    this.settings = next;
    return this.get();
  }
}
