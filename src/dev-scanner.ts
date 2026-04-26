import { Contract, Interface, getAddress, isAddress } from 'ethers';
import { httpProvider } from './rpc';
import { MULTICALL3 } from './constants';
import { MULTICALL3_ABI, ERC20_ABI } from './abis';

const API_KEY   = process.env.ETHERSCAN_API_KEY ?? '';
const erc20Iface = new Interface(ERC20_ABI);
const multicall  = new Contract(MULTICALL3, MULTICALL3_ABI, httpProvider);

interface Call3  { target: string; allowFailure: boolean; callData: string }
interface Result { success: boolean; returnData: string }

export interface DeployedToken {
  address:    string;
  name:       string;
  symbol:     string;
  deployedAt: number; // unix seconds
}

export async function resolveDeployer(contractOrWallet: string): Promise<{ deployer: string; isContract: boolean }> {
  if (!isAddress(contractOrWallet)) throw new Error('Invalid address');

  // check if it's a contract by seeing if it has bytecode
  const code = await httpProvider.getCode(contractOrWallet);
  if (code === '0x') return { deployer: contractOrWallet, isContract: false };

  // it's a contract — look up the deployer via Etherscan
  if (!API_KEY) throw new Error('ETHERSCAN_API_KEY not set');
  const url =
    `https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getcontractcreation` +
    `&contractaddresses=${contractOrWallet}&apikey=${API_KEY}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await res.json() as { status: string; result?: { contractCreator: string }[] };
  if (data.status !== '1' || !data.result?.length) {
    throw new Error('Could not resolve deployer for this contract');
  }
  return { deployer: getAddress(data.result[0].contractCreator), isContract: true };
}

async function getDeployedContracts(wallet: string): Promise<{ address: string; deployedAt: number }[]> {
  if (!API_KEY) throw new Error('ETHERSCAN_API_KEY not set');

  const contracts: { address: string; deployedAt: number }[] = [];
  let page = 1;

  while (true) {
    const url =
      `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist` +
      `&address=${wallet}&startblock=0&endblock=99999999` +
      `&sort=asc&page=${page}&offset=10000&apikey=${API_KEY}`;

    const res  = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json() as {
      status: string;
      result: { to: string; contractAddress: string; timeStamp: string; isError: string }[] | string;
    };

    if (data.status !== '1' || !Array.isArray(data.result)) break;

    for (const tx of data.result) {
      if (tx.to === '' && tx.contractAddress && tx.isError === '0') {
        contracts.push({ address: getAddress(tx.contractAddress), deployedAt: parseInt(tx.timeStamp, 10) });
      }
    }

    if (data.result.length < 10000) break; // last page
    page++;
  }

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
