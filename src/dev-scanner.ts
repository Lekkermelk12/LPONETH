import { Contract, Interface, getAddress, isAddress } from 'ethers';
import { httpProvider } from './rpc';
import { MULTICALL3 } from './constants';
import { MULTICALL3_ABI, ERC20_ABI } from './abis';

const erc20Iface = new Interface(ERC20_ABI);
const multicall  = new Contract(MULTICALL3, MULTICALL3_ABI, httpProvider);

interface Call3  { target: string; allowFailure: boolean; callData: string }
interface Result { success: boolean; returnData: string }

interface AlchemyTransfer {
  from: string;
  to:   string | null;
  hash: string;
  metadata: { blockTimestamp: string };
}

interface AlchemyResponse {
  result?: {
    transfers: AlchemyTransfer[];
    pageKey?: string;
  };
  error?: { message: string };
}

export interface DeployedToken {
  address: string;
  name: string;
  symbol: string;
  deployedAt: number; // unix seconds
}

async function getDeployedContracts(
  wallet: string,
): Promise<{ address: string; deployedAt: number }[]> {
  const key = process.env.ALCHEMY_KEY;
  if (!key) throw new Error('ALCHEMY_KEY not set');

  const url = `https://eth-mainnet.g.alchemy.com/v2/${key}`;
  const contracts: { address: string; deployedAt: number }[] = [];
  let pageKey: string | undefined;

  do {
    const body: Record<string, unknown> = {
      fromBlock: '0x0',
      toBlock: 'latest',
      fromAddress: wallet,
      category: ['external'],
      excludeZeroValue: false,
      withMetadata: true,
      maxCount: '0x3e8', // 1000 per page
    };
    if (pageKey) body.pageKey = pageKey;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers', params: [body] }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json() as AlchemyResponse;
    if (data.error) throw new Error(data.error.message);

    const transfers = data.result?.transfers ?? [];
    for (const t of transfers) {
      // contract creation: to is null, the created address comes from the receipt
      if (t.to !== null) continue;
      const receipt = await httpProvider.getTransactionReceipt(t.hash);
      if (!receipt?.contractAddress) continue;
      const ts = Math.floor(new Date(t.metadata.blockTimestamp).getTime() / 1000);
      contracts.push({ address: getAddress(receipt.contractAddress), deployedAt: ts });
    }

    pageKey = data.result?.pageKey;
  } while (pageKey);

  return contracts;
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
      const name     = erc20Iface.decodeFunctionResult('name',     nameRes.returnData)[0] as string;
      const symbol   = erc20Iface.decodeFunctionResult('symbol',   symRes.returnData)[0]  as string;
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
  const deployments = await getDeployedContracts(wallet);
  return filterERC20s(deployments);
}
