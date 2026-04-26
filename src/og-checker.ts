const DS_BASE = 'https://api.dexscreener.com/latest/dex';

interface DSPair {
  chainId: string;
  baseToken: { address: string; name: string; symbol: string };
  pairCreatedAt?: number;
  marketCap?: number;
  fdv?: number;
}

export interface OGMatch {
  address: string;
  name: string;
  symbol: string;
  pairCreatedAt: number;
  marketCap: number | null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

async function getTargetCreatedAt(address: string): Promise<number | null> {
  const data = await fetchJson<{ pairs?: DSPair[] }>(`${DS_BASE}/tokens/${address}`);
  const pairs = (data?.pairs ?? []).filter(p => p.chainId === 'ethereum' && p.pairCreatedAt);
  if (!pairs.length) return null;
  return Math.min(...pairs.map(p => p.pairCreatedAt!));
}

export async function findOGMatches(
  targetAddress: string,
  targetSymbol: string,
): Promise<{ matches: OGMatch[]; targetCreatedAt: number | null }> {
  const [targetCreatedAt, searchData] = await Promise.all([
    getTargetCreatedAt(targetAddress),
    fetchJson<{ pairs?: DSPair[] }>(`${DS_BASE}/search?q=${encodeURIComponent(targetSymbol)}`),
  ]);

  const seen = new Set<string>();
  const matches: OGMatch[] = [];

  for (const p of searchData?.pairs ?? []) {
    if (p.chainId !== 'ethereum') continue;
    if (!p.pairCreatedAt) continue;
    if (p.baseToken.symbol.toLowerCase() !== targetSymbol.toLowerCase()) continue;

    const addr = p.baseToken.address.toLowerCase();
    if (seen.has(addr)) continue;
    seen.add(addr);

    matches.push({
      address: p.baseToken.address,
      name: p.baseToken.name,
      symbol: p.baseToken.symbol,
      pairCreatedAt: p.pairCreatedAt,
      marketCap: p.marketCap ?? p.fdv ?? null,
    });
  }

  matches.sort((a, b) => a.pairCreatedAt - b.pairCreatedAt);
  return { matches: matches.slice(0, 8), targetCreatedAt };
}

export function formatAge(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  return `${Math.floor(ms / 60_000)}m ago`;
}

export function formatMc(mc: number | null): string {
  if (mc === null) return 'N/A';
  if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(1)}M`;
  if (mc >= 1_000)     return `$${(mc / 1_000).toFixed(1)}K`;
  return `$${mc.toFixed(0)}`;
}

export function marketCapStars(mc: number | null): string {
  if (mc === null)      return '☆☆☆☆☆';
  if (mc >= 100_000)   return '★★★★★';
  if (mc >= 50_000)    return '★★★★☆';
  if (mc >= 10_000)    return '★★★☆☆';
  if (mc >= 1_000)     return '★★☆☆☆';
  return '★☆☆☆☆';
}
