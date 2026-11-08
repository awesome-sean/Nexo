export type MiniBarDockPreference = 'remember' | 'left' | 'right' | 'top' | 'bottom';

export function resolveMiniBarVisibility(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true;
}

export function resolveMiniBarDockPreference(value: unknown): MiniBarDockPreference {
  if (value === 'left' || value === 'right' || value === 'top' || value === 'bottom' || value === 'remember') {
    return value;
  }
  return 'remember';
}

/** Resolve a fixed edge or restore the last saved edge. */
export function resolveInitialDockSide(
  preference: MiniBarDockPreference,
  savedDockSide?: string | null,
): 'left' | 'right' | 'top' | 'bottom' {
  if (preference !== 'remember') return preference;
  if (savedDockSide === 'left' || savedDockSide === 'top' || savedDockSide === 'bottom') return savedDockSide;
  return 'right';
}

