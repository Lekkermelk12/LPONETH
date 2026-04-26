import { Contract, Interface, ZeroAddress, isAddress, getAddress } from 'ethers';
import { httpProvider } from './rpc';
import { UNIV2_FACTORY, MULTICALL3, QUOTE_TOKENS } from './constants';
import { ERC20_ABI, UNIV2_FACTORY_ABI, MULTICALL3_ABI } from './abis';
import { TokenInfo } from './types';

const factoryIface = new Interface(UNIV2_FACTORY_ABI);
const erc20Iface   = new Interface(ERC20_ABI);
const multicall    = new Contract(MULTICALL3, MULTICALL3_ABI, httpProvider);

interface Call3 { target: string; allowFailure: boolean; callData: string }
interface Result { success: boolean; returnData: string }

export async function findBestPair(token: string): Promise<{ pair: string; quote: string } | null> {
  if (!isAddress(token)) return null;
  const calls: Call3[] = QUOTE_TOKENS.map(quote => ({
    target: UNIV2_FACTORY,
    allowFailure: false,
    callData: factoryIface.encodeFunctionData('getPair', [token, quote]),
  }));
  const results = await multicall.aggregate3.staticCall(calls) as Result[];
  for (let i = 0; i < results.length; i++) {
    const pair = factoryIface.decodeFunctionResult('getPair', results[i].returnData)[0] as string;
    if (pair && pair !== ZeroAddress) return { pair, quote: QUOTE_TOKENS[i] };
  }
  return null;
}

export async function getTokenInfo(address: string): Promise<TokenInfo> {
  const calls: Call3[] = [
    { target: address, allowFailure: true, callData: erc20Iface.encodeFunctionData('name') },
    { target: address, allowFailure: true, callData: erc20Iface.encodeFunctionData('symbol') },
    { target: address, allowFailure: true, callData: erc20Iface.encodeFunctionData('decimals') },
  ];
  const [nameRes, symRes, decRes] = await multicall.aggregate3.staticCall(calls) as Result[];

  const name = nameRes.success
    ? (erc20Iface.decodeFunctionResult('name', nameRes.returnData)[0] as string)
    : 'Unknown';
  const symbol = symRes.success
    ? (erc20Iface.decodeFunctionResult('symbol', symRes.returnData)[0] as string)
    : '?';
  const decimals = decRes.success
    ? Number(erc20Iface.decodeFunctionResult('decimals', decRes.returnData)[0])
    : 18;

  return { address: getAddress(address), name, symbol, decimals };
}
