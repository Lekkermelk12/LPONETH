import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { isAddress } from 'ethers';
import { findBestPair, getTokenInfo } from './uniswap';
import { analyzePair } from './lp-analyzer';
import { subs, subscribe, unsubscribe } from './subscribers';
import { getRecent, AlertRecord } from './recent-alerts';
import { LpAnalysis, TokenInfo } from './types';
import { WETH, USDC, USDT, DAI } from './constants';
import { getTokenSecurity, TokenSecurity } from './goplus';
import { findOGMatches, formatAge, formatMc, marketCapStars } from './og-checker';
import { getDevTokens, resolveDeployer, getWalletFunder } from './dev-scanner';
import { getBridgeHistory } from './debridge';
import { get24hVolume, fmtVol } from './volume';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set in .env');

export const bot = new Telegraf(TOKEN);

bot.telegram.setMyCommands([
  { command: 'help',        description: 'Show all commands' },
  { command: 'scan',        description: 'Analyze a token — LP, tax, OG' },
  { command: 'og',          description: 'Find older tokens with the same ticker' },
  { command: 'dev',         description: 'All ERC-20s deployed by a wallet' },
  { command: 'bridge',      description: 'deBridge cross-chain history for a wallet' },
  { command: 'volume',      description: '24h volume on Uniswap and PancakeSwap' },
  { command: 'recent',      description: 'Browse latest alerts' },
  { command: 'subscribe',   description: 'Get live LP alerts' },
  { command: 'unsubscribe', description: 'Stop live alerts' },
]).catch(e => console.warn('[bot] setMyCommands failed:', e?.message ?? e));

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

function yn(val: boolean): string {
  return val ? '⚠️ Yes' : '✅ No';
}

export function formatReport(
  info: TokenInfo,
  a: LpAnalysis,
  sec?: TokenSecurity | null,
  ogOlderCount?: number,
  marketCap?: number | null,
): string {
  const lines: string[] = [];
  lines.push(`${alertHeader(a)} — <b>${esc(info.name)}</b> (${esc(info.symbol)})`);
  lines.push(`<code>${info.address}</code>`);
  lines.push('');
  if (marketCap !== undefined && marketCap !== null) {
    lines.push(`MC:  ${formatMc(marketCap)}`);
  }
  lines.push(`LP:  ${lpLine(a)}`);

  if (sec) {
    lines.push(`Honeypot: ${sec.isHoneypot ? '🚨 YES' : '✅ No'}`);
    lines.push(`Tax:      Buy ${sec.buyTax.toFixed(1)}% / Sell ${sec.sellTax.toFixed(1)}%`);
    lines.push(`Mintable: ${yn(sec.isMintable)}`);
    lines.push(`Freeze:   ${yn(sec.isFreezable)}`);
    if (sec.flags.length > 0) lines.push(`⚠️ Flags: ${sec.flags.join(', ')}`);
  }

  if (ogOlderCount !== undefined) {
    lines.push(ogOlderCount > 0
      ? `OG:  ⚠️ ${ogOlderCount} older $${esc(info.symbol)} token(s) exist`
      : `OG:  ✅ First $${esc(info.symbol)} on Ethereum`);
  }

  lines.push('');
  lines.push(
    `<a href="https://gmgn.ai/eth/token/${info.address}">GMGN</a> · ` +
    `<a href="https://x.com/search?q=%24${encodeURIComponent(info.symbol)}">X</a> · ` +
    `<a href="https://etherscan.io/token/${info.address}">CA</a> · ` +
    `<a href="https://dexscreener.com/ethereum/${info.address}">DEX</a>`,
  );
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
  '/scan <token_address> — LP, tax, and OG analysis\n' +
  '/og <token_address> — check for older tokens with same ticker\n' +
  '/dev <wallet_address> — all ERC-20s deployed by a wallet\n' +
  '/bridge <wallet> — deBridge cross-chain history (SOL↔ETH)\n' +
  '/recent — browse latest alerts\n' +
  '/subscribe — get live alerts\n' +
  '/unsubscribe — stop alerts\n' +
  '/volume — 24h volume on Uniswap and PancakeSwap',
));

const HELP_TEXT =
  `<b>LPONETH — Ethereum token scanner</b>\n\n` +
  `<b>Token analysis</b>\n` +
  `/scan &lt;CA&gt; — LP status, buy/sell tax, OG check\n` +
  `/og &lt;CA&gt; — find older tokens with the same ticker\n\n` +
  `<b>Wallet tools</b>\n` +
  `/dev &lt;CA or wallet&gt; — all ERC-20s deployed by a wallet (auto-detects deployer from CA)\n` +
  `/bridge &lt;wallet&gt; — deBridge cross-chain history (links SOL ↔ ETH wallets)\n\n` +
  `<b>Market</b>\n` +
  `/volume — 24h volume on Uniswap V2, V3 and PancakeSwap\n\n` +
  `<b>Alerts</b>\n` +
  `/recent — browse latest LP burn/lock alerts\n` +
  `/subscribe — receive live alerts\n` +
  `/unsubscribe — stop alerts`;

bot.command('help', ctx => ctx.reply(HELP_TEXT, { parse_mode: 'HTML' }));

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

    const [analysis, sec, ogResult] = await Promise.all([
      analyzePair(found.pair, token),
      getTokenSecurity(token),
      findOGMatches(token, info.symbol),
    ]);

    const olderCount = ogResult.targetCreatedAt != null
      ? ogResult.matches.filter(
          m => m.address.toLowerCase() !== token.toLowerCase()
            && m.pairCreatedAt < ogResult.targetCreatedAt!,
        ).length
      : undefined;

    return ctx.reply(formatReport(info, analysis, sec, olderCount, ogResult.marketCap), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (e: any) {
    console.error('[scan] error:', e);
    ctx.reply(`Error: ${e?.message ?? String(e)}`).catch(() => {});
    return;
  }
});

bot.command('og', async ctx => {
  const parts = ctx.message.text.trim().split(/\s+/);
  const token = parts[1];
  if (!token || !isAddress(token)) {
    return ctx.reply('Usage: /og 0x... (ERC-20 token address)');
  }
  await ctx.reply('Searching for OG matches…');
  try {
    const info = await getTokenInfo(token);
    const { matches, targetCreatedAt } = await findOGMatches(token, info.symbol);

    if (matches.length === 0) {
      return ctx.reply(
        `🔍 OG Scan — <b>${esc(info.name)}</b> ($${esc(info.symbol)})\n\n` +
        `No other $${esc(info.symbol)} tokens found on Ethereum.`,
        { parse_mode: 'HTML' },
      );
    }

    const now = Date.now();
    const targetAddr = token.toLowerCase();
    const olderCount = targetCreatedAt != null
      ? matches.filter(m => m.address.toLowerCase() !== targetAddr && m.pairCreatedAt < targetCreatedAt).length
      : 0;

    const lines: string[] = [];
    lines.push(`🔍 OG Scan — <b>${esc(info.name)}</b> ($${esc(info.symbol)})\n`);

    if (olderCount > 0) {
      lines.push(`⚠️ ${olderCount} older $${esc(info.symbol)} token(s) found:\n`);
    } else {
      lines.push(`${matches.length} $${esc(info.symbol)} token(s) on Ethereum:\n`);
    }

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const isTarget = m.address.toLowerCase() === targetAddr;
      const age = formatAge(now - m.pairCreatedAt);
      const mc  = formatMc(m.marketCap);
      const stars = marketCapStars(m.marketCap);
      const tag = isTarget ? ' ← (this token)' : '';
      lines.push(
        `${i + 1}. <b>${esc(m.name)}</b> ($${esc(m.symbol)}) · ${age} · ${mc} ${stars}${tag}\n` +
        `<code>${m.address}</code>`,
      );
    }

    return ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (e: any) {
    return ctx.reply(`Error: ${e?.message ?? e}`);
  }
});

bot.command('bridge', async ctx => {
  const parts = ctx.message.text.trim().split(/\s+/);
  const wallet = parts[1];
  if (!wallet) return ctx.reply('Usage: /bridge <wallet> (ETH 0x... or Solana address)');
  await ctx.reply('Fetching bridge history…');
  try {
    const { txs, total } = await getBridgeHistory(wallet);
    if (txs.length === 0) {
      return ctx.reply('No deBridge transactions found for this wallet.');
    }

    const now = Date.now();
    const lines: string[] = [];
    lines.push(`🌉 <b>deBridge History</b> — <code>${wallet}</code>`);
    lines.push(`Showing ${txs.length} of ${total} total txs\n`);

    for (const t of txs) {
      const age     = formatAge(now - t.timestamp * 1000);
      const stateIco = t.state === 'Fulfilled' ? '✅' : t.state === 'SentUnlock' ? '✅' : t.state === 'Created' ? '⏳' : '❌';
      const receiver = t.receiver
        ? `\nReceiver: <code>${t.receiver}</code>`
        : '';
      lines.push(
        `${stateIco} <b>${t.fromChain} → ${t.toChain}</b> · ${age}\n` +
        `Sent:     ${t.fromAmount} ${esc(t.fromSymbol)}\n` +
        `Received: ${t.toAmount} ${esc(t.toSymbol)}` +
        receiver,
      );
    }

    return ctx.reply(lines.join('\n\n'), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (e: any) {
    console.error('[bridge] error:', e);
    ctx.reply(`Error: ${e?.message ?? String(e)}`).catch(() => {});
    return;
  }
});

bot.command('volume', async ctx => {
  await ctx.reply('Fetching volume…');
  try {
    const { uniV2, uniV3, pancake } = await get24hVolume();
    const total = (uniV2 ?? 0) + (uniV3 ?? 0) + (pancake ?? 0);
    return ctx.reply(
      `📊 <b>Ethereum 24h Volume</b>\n\n` +
      `Uniswap V2:     ${fmtVol(uniV2)}\n` +
      `Uniswap V3:     ${fmtVol(uniV3)}\n` +
      `PancakeSwap V3: ${fmtVol(pancake)}\n\n` +
      `<b>Total: ${fmtVol(total > 0 ? total : null)}</b>`,
      { parse_mode: 'HTML' },
    );
  } catch (e: any) {
    return ctx.reply(`Error: ${e?.message ?? String(e)}`);
  }
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

bot.command('dev', async ctx => {
  const parts = ctx.message.text.trim().split(/\s+/);
  const input = parts[1];
  if (!input || !isAddress(input)) {
    return ctx.reply('Usage: /dev 0x... (token CA or deployer wallet)');
  }
  await ctx.reply('Resolving deployer…');
  try {
    const { deployer, isContract } = await resolveDeployer(input);
    if (isContract) {
      await ctx.reply(`Contract deployer: <code>${deployer}</code>\nFetching all deployments…`, {
        parse_mode: 'HTML',
      });
    }

    const [tokens, funder] = await Promise.all([
      getDevTokens(deployer),
      getWalletFunder(deployer),
    ]);
    if (tokens.length === 0) {
      return ctx.reply('No ERC-20 tokens deployed from this wallet.');
    }

    const now = Date.now();
    const lines: string[] = [];
    lines.push(`👨‍💻 <b>Dev:</b> <code>${deployer}</code>`);
    if (funder) {
      const funderAge = formatAge(now - funder.timestamp * 1000);
      lines.push(`💰 Funded by: <code>${funder.address}</code> · ${funderAge}\n    → /dev ${funder.address}`);
    }
    lines.push(`<b>${tokens.length}</b> ERC-20 token(s) deployed:\n`);

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const age = formatAge(now - t.deployedAt * 1000);
      lines.push(
        `${i + 1}. <b>${esc(t.name)}</b> ($${esc(t.symbol)}) · ${age}\n` +
        `<code>${t.address}</code>\n` +
        `<a href="https://gmgn.ai/eth/token/${t.address}">GMGN</a> · ` +
        `<a href="https://etherscan.io/token/${t.address}">CA</a> · ` +
        `<a href="https://dexscreener.com/ethereum/${t.address}">DEX</a>`,
      );
    }

    return ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (e: any) {
    console.error('[dev] error:', e);
    ctx.reply(`Error: ${e?.message ?? String(e)}`).catch(() => {});
    return;
  }
});

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
