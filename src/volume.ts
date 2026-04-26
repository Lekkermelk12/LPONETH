const LLAMA_BASE = 'https://api.llama.fi/summary/dexs';

interface LlamaResponse {
  total24h?: number;
  breakdown24h?: Record<string, number>;
}

async function fetchDexVolume(protocol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${LLAMA_BASE}/${protocol}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as LlamaResponse;
    // prefer Ethereum-specific volume; fall back to global total
    return data.breakdown24h?.['Ethereum'] ?? data.total24h ?? null;
  } catch {
    return null;
  }
}

export interface VolumeResult {
  uniV2:   number | null;
  uniV3:   number | null;
  pancake: number | null;
}

export async function get24hVolume(): Promise<VolumeResult> {
  const [uniV2, uniV3, pancake] = await Promise.all([
    fetchDexVolume('uniswap'),
    fetchDexVolume('uniswap-v3'),
    fetchDexVolume('pancakeswap-v3'),
  ]);
  return { uniV2, uniV3, pancake };
}

export function fmtVol(n: number | null): string {
  if (n === null) return 'N/A';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}
