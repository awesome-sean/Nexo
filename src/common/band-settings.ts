export interface BandSettings {
  vibrationEnabled: boolean;
  revision: number;
}

export const DEFAULT_BAND_SETTINGS: Readonly<BandSettings> = {
  vibrationEnabled: true,
  revision: 0,
};
