export interface DailyUsage {
  date: string;
  cny: number | null;
  usd: number | null;
  exchangeRate: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  pricedRequests: number;
  unpricedRequests: number;
  incomplete: boolean;
  updatedAt: number;
}
