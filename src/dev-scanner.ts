import { Contract, Interface, getAddress, isAddress } from 'ethers';
import { httpProvider } from './rpc';
import { MULTICALL3 } from './constants';
import { MULTICALL3_ABI, ERC20_ABI } from './abis';

const API_KEY = process.env.ETHERSCAN_API_KEY ?? '';
const erc20Iface = new Interface(ERC20_ABI);
const multicall  = new Contract(MULTICALL3, MULTICALL3_ABI, httpProvider);

interface Call3  { target: string; allowFailure: boolean; callData: string }
interface Result { success: boolean; returnData: string }

interface EtherscanTx {
  timeStamp: string;
  contractAddress: string;
  to: string;
  isError: string;
}

export interface DeployedToken {
  address: string;
  name: string;
  symbol: string;
  deployedAt: number; // unix seconds
}

async function getDeployments(wallet: string): Promise<{ address: string; deployedAt: number }[]> {
  if (!API_KEY) return [];
  const url =
    `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist` +
    `&address=${wallet}&startblock=0&endblock=99999999` +
    `&sort=desc&page=1&offset=500&apikey=${API_KEY}`;

  const res  = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const data = await res.json() as { status: string; result: EtherscanTx[] | string };
  if (data.status !== '1' || !Array.isArray(data.result)) return [];

  return data.result
    .filter(tx => tx.to === '' && tx.contractAddress && tx.isError === '0')
    .map(tx => ({
      address:    getAddress(tx.contractAddress),
      deployedAt: parseInt(tx.timeStamp, 10),
    }));
}

async function filterERC20s(
  deployments: { address: string; deployedAt: number }[],
): Promise<DeployedToken[]> {
  if (deployments.length === 0) return [];

  const calls: Call3[] = deployments.flatMap(d => [
    { target: d.address, allowFailure: true, callData: erc20Iface.encodeFunctionData('name') },
    { target: d.address, allowFailure: true, callData: erc20Iface.encodeFunctionData('symbol') },
    { target: d.address, allowFailure: true, callData: erc20Iface.encodeFunctionData('decimals') },
  ]);

  const results = await multicall.aggregate3.staticCall(calls) as Result[];
  const tokens: DeployedToken[] = [];

  for (let i = 0; i < deployments.length; i++) {
    const nameRes = results[i * 3];
    const symRes  = results[i * 3 + 1];
    const decRes  = results[i * 3 + 2];
    if (!nameRes.success || !symRes.success || !decRes.success) continue;

    try {
      const name    = erc20Iface.decodeFunctionResult('name',     nameRes.returnData)[0] as string;
      const symbol  = erc20Iface.decodeFunctionResult('symbol',   symRes.returnData)[0]  as string;
      const decimals = Number(erc20Iface.decodeFunctionResult('decimals', decRes.returnData)[0]);
      if (!name || !symbol || decimals < 0 || decimals > 30) continue;
      tokens.push({ address: deployments[i].address, name, symbol, deployedAt: deployments[i].deployedAt });
    } catch {
      // not a standard ERC-20
    }
  }

  return tokens;
}

export async function getDevTokens(wallet: string): Promise<DeployedToken[]> {
  if (!isAddress(wallet)) throw new Error('Invalid wallet address');
  const deployments = await getDeployments(wallet);
  return filterERC20s(deployments);
}
