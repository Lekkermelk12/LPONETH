interface GraphResult {
  data?: Record<string, { volumeUSD: string }[]>;
}

async function queryGraph(url: string, query: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json() as GraphResult;
    const entities = json.data ? Object.values(json.data) : [];
    const row = entities[0]?.[0];
    if (!row?.volumeUSD) return null;
    return parseFloat(row.volumeUSD);
  } catch {
    return null;
  }
}

export interface VolumeResult {
  uniV2:  number | null;
  uniV3:  number | null;
  pancake: number | null;
}

export async function get24hVolume(): Promise<VolumeResult> {
  const dayQuery = (entity: string) =>
    `{ ${entity}(first:1, orderBy:date, orderDirection:desc) { volumeUSD } }`;

  const [uniV2, uniV3, pancake] = await Promise.all([
    queryGraph(
      'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2',
      dayQuery('uniswapDayDatas'),
    ),
    queryGraph(
      'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3',
      dayQuery('uniswapDayDatas'),
    ),
    queryGraph(
      'https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v3-eth',
      dayQuery('pancakeDayDatas'),
    ),
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
