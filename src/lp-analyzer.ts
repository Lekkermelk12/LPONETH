import { Contract, Interface } from 'ethers';
import { httpProvider } from './rpc';
import { UNIV2_PAIR_ABI, ERC20_ABI, MULTICALL3_ABI } from './abis';
import {
  BURN_ADDRESSES,
  LOCKERS,
  MULTICALL3,
  SAFE_THRESHOLD_PCT,
  PARTIAL_THRESHOLD_PCT,
  SUPPLY_WARNING_THRESHOLD_PCT,
} from './constants';
import { findDeliveryTx } from './etherscan';
import { LpAnalysis, LpBreakdown, Verdict } from './types';

const pairIface  = new Interface(UNIV2_PAIR_ABI);
const erc20Iface = new Interface(ERC20_ABI);
const multicall  = new Contract(MULTICALL3, MULTICALL3_ABI, httpProvider);

interface Call3 { target: string; allowFailure: boolean; callData: string }
interface Result { success: boolean; returnData: string }

function pct(part: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((part * 1_000_000n) / total) / 10_000;
}

export async function analyzePair(pairAddress: string, token: string): Promise<LpAnalysis> {
  const calls: Call3[] = [
    { target: pairAddress, allowFailure: false, callData: pairIface.encodeFunctionData('totalSupply') },
    { target: pairAddress, allowFailure: false, callData: pairIface.encodeFunctionData('token0') },
    { target: pairAddress, allowFailure: false, callData: pairIface.encodeFunctionData('token1') },
    { target: pairAddress, allowFailure: false, callData: pairIface.encodeFunctionData('getReserves') },
    ...BURN_ADDRESSES.map(a => ({
      target: pairAddress,
      allowFailure: false,
      callData: pairIface.encodeFunctionData('balanceOf', [a]),
    })),
    ...LOCKERS.map(l => ({
      target: pairAddress,
      allowFailure: false,
      callData: pairIface.encodeFunctionData('balanceOf', [l.address]),
    })),
    { target: token, allowFailure: false, callData: erc20Iface.encodeFunctionData('totalSupply') },
    { target: token, allowFailure: false, callData: erc20Iface.encodeFunctionData('balanceOf', [pairAddress]) },
    ...BURN_ADDRESSES.map(a => ({
      target: token,
      allowFailure: false,
      callData: erc20Iface.encodeFunctionData('balanceOf', [a]),
    })),
  ];

  const results = await multicall.aggregate3.staticCall(calls) as Result[];

  const totalSupply = pairIface.decodeFunctionResult('totalSupply', results[0].returnData)[0] as bigint;
  const token0      = pairIface.decodeFunctionResult('token0',      results[1].returnData)[0] as string;
  const token1      = pairIface.decodeFunctionResult('token1',      results[2].returnData)[0] as string;
  const reserves    = pairIface.decodeFunctionResult('getReserves', results[3].returnData) as unknown as [bigint, bigint, bigint];

  const tokenIs0 = token0.toLowerCase() === token.toLowerCase();
  const quoteToken    = tokenIs0 ? token1 : token0;
  const reservesToken = tokenIs0 ? reserves[0] : reserves[1];
  const reservesQuote = tokenIs0 ? reserves[1] : reserves[0];

  let idx = 4;
  const burned: LpBreakdown[] = BURN_ADDRESSES.map(addr => {
    const amount = pairIface.decodeFunctionResult('balanceOf', results[idx++].returnData)[0] as bigint;
    return { source: 'burn', address: addr, amount, pct: pct(amount, totalSupply) };
  }).filter(b => b.amount > 0n);

  const locked: LpBreakdown[] = LOCKERS.map(l => {
    const amount = pairIface.decodeFunctionResult('balanceOf', results[idx++].returnData)[0] as bigint;
    return { source: l.name, address: l.address, amount, pct: pct(amount, totalSupply) };
  }).filter(l => l.amount > 0n);

  const tokenTotalSupply = erc20Iface.decodeFunctionResult('totalSupply', results[idx++].returnData)[0] as bigint;
  const tokenInPair      = erc20Iface.decodeFunctionResult('balanceOf',   results[idx++].returnData)[0] as bigint;
  let tokenBurned = 0n;
  for (const _ of BURN_ADDRESSES) {
    tokenBurned += erc20Iface.decodeFunctionResult('balanceOf', results[idx++].returnData)[0] as bigint;
  }

  const tokenOutsideLp = tokenTotalSupply > tokenInPair + tokenBurned
    ? tokenTotalSupply - tokenInPair - tokenBurned
    : 0n;
  const tokenOutsideLpPct = pct(tokenOutsideLp, tokenTotalSupply);
  const supplyWarning = tokenOutsideLpPct >= SUPPLY_WARNING_THRESHOLD_PCT;

  await Promise.all(
    [...burned, ...locked].map(async b => { b.tx = await findDeliveryTx(pairAddress, b.address); }),
  );

  const burnedTotal = burned.reduce((a, b) => a + b.amount, 0n);
  const lockedTotal = locked.reduce((a, b) => a + b.amount, 0n);
  const burnedPct = pct(burnedTotal, totalSupply);
  const lockedPct = pct(lockedTotal, totalSupply);
  const securedPct = burnedPct + lockedPct;

  const verdict: Verdict =
    securedPct >= SAFE_THRESHOLD_PCT    ? 'SAFE'    :
    securedPct >= PARTIAL_THRESHOLD_PCT ? 'PARTIAL' : 'UNSAFE';

  return {
    pair: pairAddress,
    token,
    quoteToken,
    totalLp: totalSupply,
    burned,
    locked,
    burnedPct,
    lockedPct,
    securedPct,
    verdict,
    reservesToken,
    reservesQuote,
    tokenTotalSupply,
    tokenInPair,
    tokenBurned,
    tokenOutsideLp,
    tokenOutsideLpPct,
    supplyWarning,
  };
}
