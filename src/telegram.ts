import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { isAddress } from 'ethers';
import { findBestPair, getTokenInfo } from './uniswap';
import { analyzePair } from './lp-analyzer';
import { subs, subscribe, unsubscribe } from './subscribers';
import { getRecent, AlertRecord } from './recent-alerts';
import { stats } from './monitor';
import { LpAnalysis, TokenInfo } from './types';
import { WETH, USDC, USDT, DAI } from './constants';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set in .env');

export const bot = new Telegraf(TOKEN);

function quoteSymbol(addr: string): string {
  const a = addr.toLowerCase();
  if (a === WETH.toLowerCase()) return 'WETH';
  if (a === USDC.toLowerCase()) return 'USDC';
  if (a === USDT.toLowerCase()) return 'USDT';
  if (a === DAI.toLowerCase())  return 'DAI';
  return 'TOKEN';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function alertHeader(a: LpAnalysis): string {
  if (a.verdict === 'UNSAFE')   return '🔓 LP UNLOCKED';
  if (a.verdict === 'PARTIAL')  return '⚠️ LP PARTIAL';
  if (a.burnedPct >= 99.9)      return '🔥 LP BURNED';
  if (a.lockedPct >= 99.9)      return '🔒 LP LOCKED';
  return '🔐 LP SECURED';
}

function lpLine(a: LpAnalysis): string {
  if (a.verdict === 'UNSAFE') return '❌ Dev wallet still holds LP';

  if (a.burnedPct >= 0.01 && a.lockedPct >= 0.01) {
    return `✅ ${a.burnedPct.toFixed(1)}% burned + ${a.lockedPct.toFixed(1)}% locked`;
  }
  if (a.burnedPct >= 0.01) {
    return `✅ ${a.burnedPct.toFixed(1)}% burned`;
  }
  if (a.lockedPct >= 0.01) {
    const lockers = [...new Set(a.locked.map(l => l.source))].join(', ');
    return `✅ ${a.lockedPct.toFixed(1)}% locked @ ${lockers}`;
  }
  return `⚠️ ${a.securedPct.toFixed(1)}% secured`;
}

function devLine(a: LpAnalysis): string {
  // inLpPct = tokens physically in this pair / total supply (excludes burned supply)
  const inLpPct = a.tokenTotalSupply > 0n
    ? Number((a.tokenInPair * 10000n) / a.tokenTotalSupply) / 100
    : 0;
  const outsidePct = a.tokenOutsideLpPct;
  if (!a.supplyWarning) return `✅ ${inLpPct.toFixed(1)}% of supply in LP`;
  return `⚠️ Only <b>${inLpPct.toFixed(1)}%</b> of supply in LP — ${outsidePct.toFixed(1)}% circulating outside`;
}

export function formatReport(info: TokenInfo, a: LpAnalysis): string {
  const lines: string[] = [];
  lines.push(`${alertHeader(a)} — <b>${esc(info.name)}</b> (${esc(info.symbol)})`);
  lines.push(`<code>${info.address}</code>`);
  lines.push('');
  lines.push(`LP:  ${lpLine(a)}`);
  lines.push(`Dev: ${devLine(a)}`);
  lines.push('');
  lines.push(`${quoteSymbol(a.quoteToken)} · <a href="https://dexscreener.com/ethereum/${a.pair}">Chart</a> · <a href="https://etherscan.io/address/${a.pair}">Contract</a>`);
  return lines.join('\n');
}

function buildRecentCard(alerts: AlertRecord[], idx: number) {
  const r = alerts[idx];
  const ago = Math.round((Date.now() - r.ts) / 60000);
  const text = `<i>${ago}m ago</i>\n\n` + formatReport(r.info, r.analysis);

  const buttons = [];
  if (idx < alerts.length - 1) buttons.push(Markup.button.callback('← Older', `rp:${idx + 1}`));
  buttons.push(Markup.button.callback(`${idx + 1} / ${alerts.length}`, 'rp_noop'));
  if (idx > 0) buttons.push(Markup.button.callback('Newer →', `rp:${idx - 1}`));

  return { text, markup: Markup.inlineKeyboard([buttons]) };
}

bot.start(ctx => ctx.reply(
  'LPONETH — Uniswap V2 LP scanner on Ethereum mainnet.\n\n' +
  '/scan <token_address> — analyze a token\n' +
  '/recent — browse latest alerts\n' +
  '/subscribe — get live alerts\n' +
  '/unsubscribe — stop alerts\n' +
  '/status — uptime and stats',
));

bot.command('scan', async ctx => {
  const parts = ctx.message.text.trim().split(/\s+/);
  const token = parts[1];
  if (!token || !isAddress(token)) {
    return ctx.reply('Usage: /scan 0x... (ERC-20 token address)');
  }
  await ctx.reply('Scanning…');
  try {
    const [info, found] = await Promise.all([
      getTokenInfo(token),
      findBestPair(token),
    ]);
    if (!found) return ctx.reply('No Uniswap V2 pair found for this token (checked WETH/USDC/USDT/DAI).');
    const analysis = await analyzePair(found.pair, token);
    return ctx.reply(formatReport(info, analysis), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (e: any) {
    return ctx.reply(`Error: ${e?.message ?? e}`);
  }
});

bot.command('status', ctx => {
  const uptimeMin = Math.round((Date.now() - stats.startedAt) / 60000);
  const lastEvt = stats.lastEventAt
    ? `${Math.round((Date.now() - stats.lastEventAt) / 1000)}s ago`
    : 'none yet';
  return ctx.reply(
    `<b>LPONETH status</b>\n\n` +
    `Uptime: ${uptimeMin}m\n` +
    `Raw events: ${stats.rawEvents}\n` +
    `Pair checks: ${stats.pairChecks}\n` +
    `Alerts fired: ${stats.alertsFired}\n` +
    `Last event: ${lastEvt}`,
    { parse_mode: 'HTML' },
  );
});

bot.command('recent', async ctx => {
  const alerts = getRecent(20);
  if (alerts.length === 0) return ctx.reply('No alerts recorded yet this session.');
  const { text, markup } = buildRecentCard(alerts, 0);
  return ctx.reply(text, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...markup,
  });
});

bot.action(/^rp:(\d+)$/, async ctx => {
  const idx = parseInt(ctx.match[1], 10);
  const alerts = getRecent(20);
  if (idx >= alerts.length) return ctx.answerCbQuery('No more alerts');
  const { text, markup } = buildRecentCard(alerts, idx);
  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...markup,
  });
  return ctx.answerCbQuery();
});

bot.action('rp_noop', ctx => ctx.answerCbQuery());

bot.command('subscribe', ctx => {
  subscribe(ctx.chat.id);
  ctx.reply('Subscribed — you will receive LP burn/lock alerts.');
});

bot.command('unsubscribe', ctx => {
  unsubscribe(ctx.chat.id);
  ctx.reply('Unsubscribed.');
});

export async function broadcast(text: string) {
  const failures: string[] = [];
  for (const chatId of subs) {
    try {
      await bot.telegram.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    } catch (e: any) {
      failures.push(`${chatId}: ${e?.message ?? e}`);
    }
  }
  if (failures.length) console.warn('[broadcast] some sends failed:', failures.join('; '));
}
