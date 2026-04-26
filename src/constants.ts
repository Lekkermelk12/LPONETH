import { LockerInfo } from './types';

export const UNIV2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
export const MULTICALL3    = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
export const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
export const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
export const DAI  = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

export const QUOTE_TOKENS = [WETH, USDC, USDT, DAI];

export const BURN_ADDRESSES = [
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dEaD',
];

export const LOCKERS: LockerInfo[] = [
  { name: 'UNCX (Unicrypt) V2', address: '0x663A5C229c09b049E36dCc11a9B0d4a8Eb9db214' },
  { name: 'Team Finance',       address: '0xE2fE530C047f2d85298b07D9333C05737f1435fB' },
  { name: 'Pinksale',           address: '0x71B5759d73262FBb223956913ecF4ecC51057641' },
];

export const SAFE_THRESHOLD_PCT    = 99.5;
export const PARTIAL_THRESHOLD_PCT = 50;

// warn when >50% of token supply is outside LP — below that, LP coverage is healthy
export const SUPPLY_WARNING_THRESHOLD_PCT = 50;
