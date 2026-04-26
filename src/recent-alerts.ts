import { LpAnalysis, TokenInfo } from './types';

const MAX = 20;

export interface AlertRecord {
  ts: number;
  info: TokenInfo;
  analysis: LpAnalysis;
  message: string;
}

const ring: AlertRecord[] = [];

export function pushAlert(record: AlertRecord) {
  ring.unshift(record);
  if (ring.length > MAX) ring.length = MAX;
}

export function getRecent(n = 5): AlertRecord[] {
  return ring.slice(0, n);
}
