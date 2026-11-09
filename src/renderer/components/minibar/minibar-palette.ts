// Surface colors from the supplied dark and light SVG families.
export const MINIBAR_PALETTES = {
  dark: {
    body: '#27262D',
    surfaceRgb: '39,38,45',
    lettering: '#C9C7D6',
    ringBackground: '#08080A',
    ringTrack: '#1C1C22',
    menuRgb: '18,18,20',
    menuText: '#FFFFFF',
  },
  light: {
    body: '#FFFFFF',
    surfaceRgb: '255,255,255',
    lettering: '#55545E',
    ringBackground: '#FFFFFF',
    ringTrack: '#E7E8E1',
    menuRgb: '255,255,255',
    menuText: '#55545E',
  },
} as const;
