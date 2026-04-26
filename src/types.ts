export interface LockerInfo {
  name: string;
  address: string;
}

export interface LpBreakdown {
  source: string;
  address: string;
  amount: bigint;
  pct: number;
  tx?: string | null;
}

export type Verdict = 'SAFE' | 'PARTIAL' | 'UNSAFE';

export interface LpAnalysis {
  pair: string;
  token: string;
  quoteToken: string;
  totalLp: bigint;
  burned: LpBreakdown[];
  locked: LpBreakdown[];
  burnedPct: number;
  lockedPct: number;
  securedPct: number;
  verdict: Verdict;
  reservesToken: bigint;
  reservesQuote: bigint;
  tokenTotalSupply: bigint;
  tokenInPair: bigint;
  tokenBurned: bigint;
  tokenOutsideLp: bigint;
  tokenOutsideLpPct: number;
  supplyWarning: boolean;
}

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}
