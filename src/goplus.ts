const GOPLUS_BASE = 'https://api.gopluslabs.io/api/v1';

const DEAD_OWNERS = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
]);

interface GoPlusResult {
  buy_tax?: string;
  sell_tax?: string;
  is_honeypot?: string;
  is_mintable?: string;
  is_open_source?: string;
  cannot_sell_all?: string;
  trading_cooldown?: string;
  transfer_pausable?: string;
  slippage_modifiable?: string;
  owner_change_balance?: string;
  owner_address?: string;
}

export interface TokenSecurity {
  buyTax:      number;
  sellTax:     number;
  isHoneypot:  boolean;
  isMintable:  boolean;
  isFreezable: boolean;
  isOpenSource: boolean;
  flags: string[];
}

export async function getTokenSecurity(address: string): Promise<TokenSecurity | null> {
  try {
    const url = `${GOPLUS_BASE}/token_security/1?contract_addresses=${address.toLowerCase()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as { result?: Record<string, GoPlusResult> };
    const r = data.result?.[address.toLowerCase()];
    if (!r) return null;

    const flags: string[] = [];
    if (r.trading_cooldown === '1')     flags.push('cooldown');
    if (r.cannot_sell_all === '1')      flags.push("can't sell all");
    if (r.slippage_modifiable === '1')  flags.push('modifiable tax');
    if (r.owner_change_balance === '1') flags.push('owner can change balance');

    return {
      buyTax:      parseFloat(r.buy_tax  ?? '0') * 100,
      sellTax:     parseFloat(r.sell_tax ?? '0') * 100,
      isHoneypot:  r.is_honeypot === '1',
      isMintable:  r.is_mintable === '1',
      isFreezable: r.transfer_pausable === '1' && !DEAD_OWNERS.has((r.owner_address ?? '').toLowerCase()),
      isOpenSource: r.is_open_source   === '1',
      flags,
    };
  } catch {
    return null;
  }
}
