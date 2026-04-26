import 'dotenv/config';

const API_KEY = process.env.ETHERSCAN_API_KEY;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

interface EtherscanLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

interface LogsResponse {
  status: string;
  message: string;
  result: EtherscanLog[] | string;
}

const cache = new Map<string, string | null>();

export async function findDeliveryTx(pair: string, holder: string): Promise<string | null> {
  if (!API_KEY) return null;
  const key = `${pair.toLowerCase()}:${holder.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key)!;

  const paddedHolder = '0x' + holder.slice(2).toLowerCase().padStart(64, '0');
  const url =
    `https://api.etherscan.io/v2/api?chainid=1&module=logs&action=getLogs` +
    `&address=${pair}` +
    `&fromBlock=0&toBlock=latest` +
    `&topic0=${TRANSFER_TOPIC}` +
    `&topic2=${paddedHolder}` +
    `&topic0_2_opr=and` +
    `&page=1&offset=100` +
    `&apikey=${API_KEY}`;

  try {
    const res = await fetch(url);
    const data = (await res.json()) as LogsResponse;
    if (data.status !== '1' || !Array.isArray(data.result) || data.result.length === 0) {
      cache.set(key, null);
      return null;
    }
    const largest = data.result.reduce((a, b) => {
      const aVal = BigInt(a.data || '0x0');
      const bVal = BigInt(b.data || '0x0');
      return bVal > aVal ? b : a;
    });
    const hash = largest.transactionHash;
    cache.set(key, hash);
    return hash;
  } catch {
    return null;
  }
}
