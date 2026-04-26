import 'dotenv/config';
import { JsonRpcProvider, WebSocketProvider } from 'ethers';

const HTTP = process.env.ETH_RPC_HTTP;
const WSS  = process.env.ETH_RPC_WSS;

if (!HTTP) throw new Error('ETH_RPC_HTTP not set in .env');

export const httpProvider = new JsonRpcProvider(HTTP);

let _ws: WebSocketProvider | null = WSS ? new WebSocketProvider(WSS) : null;
const _reconnectCallbacks: Array<(p: WebSocketProvider) => void> = [];
const _keepaliveCallbacks: Array<() => void> = [];

export function onKeepalive(cb: () => void) {
  _keepaliveCallbacks.push(cb);
}

export function getWsProvider(): WebSocketProvider | null {
  return _ws;
}

export function onWsReconnect(cb: (p: WebSocketProvider) => void) {
  _reconnectCallbacks.push(cb);
}

async function reconnect() {
  if (!WSS) return;
  console.log('[rpc] reconnecting WebSocket…');
  try { (_ws as any).destroy?.(); } catch {}
  _ws = new WebSocketProvider(WSS);
  for (const cb of _reconnectCallbacks) {
    try { cb(_ws); } catch (e) { console.warn('[rpc] reconnect callback error:', e); }
  }
}

export function startWsKeepalive() {
  if (!WSS) return;
  setInterval(async () => {
    try {
      await _ws!.getBlockNumber();
      for (const cb of _keepaliveCallbacks) { try { cb(); } catch {} }
    } catch (e: any) {
      console.warn('[rpc] WS ping failed:', e?.message ?? e);
      await reconnect();
    }
  }, 30_000);
  console.log('[rpc] WS keepalive started (30s interval)');
}

// keep legacy export for any existing imports
export const wsProvider = _ws;
