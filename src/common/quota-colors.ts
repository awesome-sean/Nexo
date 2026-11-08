/** Colors describe consumed quota consistently across all floating Agent rings. */
export function quotaUsageColor(usedPercent: number | null | undefined): string {
  if (usedPercent == null || !Number.isFinite(usedPercent)) return '#6B7280';
  if (usedPercent >= 100) return '#FF4545';
  if (usedPercent >= 75) return '#F59A38';
  if (usedPercent >= 50) return '#FDCC03';
  return '#45E459';
}
