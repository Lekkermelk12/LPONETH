import 'dotenv/config';
import { bot } from './telegram';
import { startMonitor } from './monitor';
import { startWsKeepalive } from './rpc';

process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));
process.on('uncaughtException',  (e) => console.error('[uncaughtException]', e));

async function main() {
  startMonitor();
  startWsKeepalive();
  bot.launch({ dropPendingUpdates: true }).catch(e => {
    console.error('[bot] launch failed:', e);
    process.exit(1);
  });
  console.log('[bot] polling Telegram');
}

function shutdown(sig: string) {
  console.log(`[bot] ${sig} received, stopping…`);
  try { bot.stop(sig); } catch {}
  setTimeout(() => process.exit(0), 500);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

main().catch(e => {
  console.error(e);
  process.exit(1);
});
