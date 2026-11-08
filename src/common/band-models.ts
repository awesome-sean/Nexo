/** Model identity and implemented transport are separate capabilities. */
export type BandModelId = 'band9' | 'band9-nfc' | 'band10' | 'band10-nfc' | 'band11' | 'band11-nfc';
export interface BandModel {
  id: BandModelId;
  generation: number;
  nfc: boolean;
  name: string;
  width: number;
  height: number;
  transport: 'spp';
  connectionAvailable: boolean;
  status: string;
  codename?: string;
}
export const BAND_MODELS: readonly BandModel[] = [9, 10, 11].flatMap(generation => [false, true].map(nfc => ({
  id: ('band' + generation + (nfc ? '-nfc' : '')) as BandModelId,
  generation,
  nfc,
  name: '小米手环 ' + generation + (nfc ? ' NFC 版' : ' 标准版'),
  width: generation < 10 ? 192 : 212,
  height: generation < 10 ? 490 : 520,
  transport: 'spp' as const,
  connectionAvailable: true,
  status: generation === 9 && !nfc ? '已确认实机可用' : '尚未实机检验',
  codename: generation === 9 && !nfc ? 'o66' : undefined,
})));
export function getBandModel(id: unknown): BandModel | undefined {
  return BAND_MODELS.find(model => model.id === id);
}
export function identifyBandModel(name: unknown): BandModel | undefined {
  if (typeof name !== 'string' || /pro|active/i.test(name)) return undefined;
  const match = /(?:smart\s*band|mi\s*band|小米手环)\s*(11|10|9)(?!\d)/i.exec(name);
  if (!match) return undefined;
  return BAND_MODELS.find(model => model.generation === Number(match[1]) && model.nfc === /nfc/i.test(name));
}
