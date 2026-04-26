const GOPLUS_BASE = 'https://api.gopluslabs.io/api/v1';

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
  is_anti_whale?: string;
}

export interface TokenSecurity {
  buyTax: number;
  sellTax: number;
  isHoneypot: boolean;
  isMintable: boolean;
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
    if (r.is_mintable === '1')          flags.push('mintable');
    if (r.trading_cooldown === '1')     flags.push('cooldown');
    if (r.transfer_pausable === '1')    flags.push('pausable');
    if (r.cannot_sell_all === '1')      flags.push("can't sell all");
    if (r.slippage_modifiable === '1')  flags.push('modifiable slippage');
    if (r.owner_change_balance === '1') flags.push('owner can change balance');
    if (r.is_anti_whale === '1')        flags.push('anti-whale');

    return {
      buyTax:      parseFloat(r.buy_tax  ?? '0') * 100,
      sellTax:     parseFloat(r.sell_tax ?? '0') * 100,
      isHoneypot:  r.is_honeypot === '1',
      isMintable:  r.is_mintable === '1',
      isOpenSource: r.is_open_source === '1',
      flags,
    };
  } catch {
    return null;
  }
}
