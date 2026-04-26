import { Contract, Interface, id, zeroPadValue } from 'ethers';
import { getWsProvider, httpProvider, onWsReconnect, onKeepalive } from './rpc';
import {
  BURN_ADDRESSES,
  LOCKERS,
  UNIV2_FACTORY,
  QUOTE_TOKENS,
  SAFE_THRESHOLD_PCT,
} from './constants';
import { analyzePair } from './lp-analyzer';
import { getTokenInfo } from './uniswap';
import { formatReport, broadcast } from './telegram';
import { pushAlert } from './recent-alerts';

const TRANSFER_TOPIC = id('Transfer(address,address,uint256)');

const PAIR_INTROSPECT_ABI = [
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

// pre-built filter — stable object reference so we can remove it cleanly
const destinations = [...BURN_ADDRESSES, ...LOCKERS.map(l => l.address)];
const destTopics   = destinations.map(a => zeroPadValue(a, 32));
const LOG_FILTER   = { topics: [TRANSFER_TOPIC, null, destTopics] };

const isPairCache  = new Map<string, boolean>();
const memeTokenCache = new Map<string, string | null>();
const alerted = new Set<string>();

// track the active provider + handler so we can remove the old one on refresh
let _activeProvider: any = null;
let _activeHandler: ((log: any) => void) | null = null;

export const stats = {
  rawEvents: 0,
  pairChecks: 0,
  alertsFired: 0,
  startedAt: Date.now(),
  lastEventAt: null as number | null,
};

async function isV2Pair(address: string): Promise<boolean> {
  const key = address.toLowerCase();
  const cached = isPairCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const c = new Contract(address, PAIR_INTROSPECT_ABI, httpProvider);
    const factory = (await c.factory()) as string;
    const ok = factory.toLowerCase() === UNIV2_FACTORY.toLowerCase();
    isPairCache.set(key, ok);
    return ok;
  } catch {
    isPairCache.set(key, false);
    return false;
  }
}

async function resolveMemeToken(pairAddr: string): Promise<string | null> {
  const key = pairAddr.toLowerCase();
  if (memeTokenCache.has(key)) return memeTokenCache.get(key)!;
  try {
    const c = new Contract(pairAddr, PAIR_INTROSPECT_ABI, httpProvider);
    const [t0, t1] = await Promise.all([
      c.token0() as Promise<string>,
      c.token1() as Promise<string>,
    ]);
    const quotes = new Set(QUOTE_TOKENS.map(q => q.toLowerCase()));
    const t0q = quotes.has(t0.toLowerCase());
    const t1q = quotes.has(t1.toLowerCase());
    const meme = t0q && !t1q ? t1 : !t0q && t1q ? t0 : null;
    memeTokenCache.set(key, meme);
    return meme;
  } catch {
    memeTokenCache.set(key, null);
    return null;
  }
}

function topicToAddress(topic: string): string {
  return '0x' + topic.slice(-40);
}

function registerFilter(provider: any) {
  // remove old listener before re-registering to avoid duplicate events
  if (_activeHandler && _activeProvider) {
    try { _activeProvider.off(LOG_FILTER, _activeHandler); } catch {}
  }

  const handler = async (log: any) => {
    stats.rawEvents++;
    stats.lastEventAt = Date.now();

    const emitter: string = log.address;
    const emitterKey = emitter.toLowerCase();

    if (alerted.has(emitterKey)) return;

    stats.pairChecks++;
    if (!(await isV2Pair(emitter))) return;

    const token = await resolveMemeToken(emitter);
    if (!token) return;

    try {
      const analysis = await analyzePair(emitter, token);
      console.log(
        `[monitor] LP event ${emitter.slice(0, 10)}… ` +
        `verdict=${analysis.verdict} ` +
        `burn=${analysis.burnedPct.toFixed(1)}% ` +
        `lock=${analysis.lockedPct.toFixed(1)}% ` +
        `secured=${analysis.securedPct.toFixed(1)}%`,
      );

      if (analysis.securedPct >= SAFE_THRESHOLD_PCT) {
        const info = await getTokenInfo(token).catch(() => ({
          address: token, name: 'Unknown', symbol: '?', decimals: 18,
        }));
        const msg = formatReport(info, analysis);
        pushAlert({ ts: Date.now(), info, analysis, message: msg });
        await broadcast(msg);
        alerted.add(emitterKey);
        stats.alertsFired++;
        console.log(`[monitor] ALERT sent for ${emitter} (${info.symbol})`);
      }
    } catch (e: any) {
      console.warn(`[monitor] process ${emitter} failed:`, e?.message ?? e);
    }
  };

  _activeProvider = provider;
  _activeHandler  = handler;
  provider.on(LOG_FILTER, handler);

  console.log(
    `[monitor] filter registered on ${provider.constructor.name} — ` +
    `watching ${destinations.length} burn/locker destinations, alerts at ≥${SAFE_THRESHOLD_PCT}%`,
  );
}

export function startMonitor() {
  const provider = getWsProvider() ?? httpProvider;
  registerFilter(provider);

  // re-register after every WS reconnect (handles full disconnection)
  onWsReconnect(newProvider => {
    console.log('[monitor] WS reconnected — re-registering filter');
    registerFilter(newProvider);
  });

  // periodic refresh every 3 min to recover from silent subscription drops
  // (WS connection stays alive but provider silently kills the log subscription)
  let tick = 0;
  onKeepalive(() => {
    if (++tick % 6 === 0) {
      const p = getWsProvider() ?? httpProvider;
      console.log('[monitor] periodic filter refresh');
      registerFilter(p);
    }
  });
}
