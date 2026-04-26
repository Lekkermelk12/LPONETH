const DEBRIDGE_API = 'https://stats-api.dln.trade/api/Orders/filteredList';

const CHAIN_NAMES: Record<number, string> = {
  1:       'Ethereum',
  56:      'BSC',
  137:     'Polygon',
  42161:   'Arbitrum',
  43114:   'Avalanche',
  7565164: 'Solana',
  8453:    'Base',
  10:      'Optimism',
  59144:   'Linea',
  100:     'Gnosis',
};

interface Offer {
  chainId:  { bigIntegerValue: number };
  amount:   { stringValue: string };
  metadata: { symbol: string; decimals: number };
}

interface PreswapData {
  inAmount:        { stringValue: string };
  tokenInMetadata: { symbol: string; decimals: number };
}

interface DebridgeOrder {
  orderId:                    { stringValue: string };
  creationTimestamp:          number;
  giveOfferWithMetadata:      Offer;
  takeOfferWithMetadata:      Offer;
  unlockAuthorityDst:         { stringValue: string } | null;
  state:                      string;
  preswapData:                PreswapData | null;
  createEventTransactionHash: { stringValue: string };
}

export interface BridgeTx {
  orderId:    string;
  timestamp:  number;
  fromChain:  string;
  toChain:    string;
  fromSymbol: string;
  fromAmount: string;
  toSymbol:   string;
  toAmount:   string;
  receiver:   string | null;
  txHash:     string;
  state:      string;
}

function fmtAmt(raw: string, decimals: number): string {
  if (!raw || raw === '0') return '0';
  try {
    const n = BigInt(raw);
    const d = BigInt(10 ** Math.min(decimals, 18));
    const whole = n / d;
    const frac  = (n % d).toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
  } catch {
    return raw;
  }
}

function chainName(id: number): string {
  return CHAIN_NAMES[id] ?? `Chain ${id}`;
}

export async function getBridgeHistory(
  wallet: string,
  take = 15,
): Promise<{ txs: BridgeTx[]; total: number }> {
  const res = await fetch(DEBRIDGE_API, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify({ skip: 0, take, filterBySender: wallet }),
    signal:  AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`deBridge API error: ${res.status}`);
  const data = await res.json() as { orders: DebridgeOrder[]; totalCount: number };

  const txs: BridgeTx[] = data.orders.map(o => {
    const give = o.giveOfferWithMetadata;
    const recv = o.takeOfferWithMetadata;
    const pre  = o.preswapData;

    const fromSymbol  = pre ? pre.tokenInMetadata.symbol  : give.metadata.symbol;
    const fromDec     = pre ? pre.tokenInMetadata.decimals : give.metadata.decimals;
    const fromRaw     = pre ? pre.inAmount.stringValue     : give.amount.stringValue;

    return {
      orderId:    o.orderId.stringValue,
      timestamp:  o.creationTimestamp,
      fromChain:  chainName(give.chainId.bigIntegerValue),
      toChain:    chainName(recv.chainId.bigIntegerValue),
      fromSymbol,
      fromAmount: fmtAmt(fromRaw, fromDec),
      toSymbol:   recv.metadata.symbol,
      toAmount:   fmtAmt(recv.amount.stringValue, recv.metadata.decimals),
      receiver:   o.unlockAuthorityDst?.stringValue ?? null,
      txHash:     o.createEventTransactionHash.stringValue,
      state:      o.state,
    };
  });

  return { txs, total: data.totalCount };
}
