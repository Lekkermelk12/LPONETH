import fs from 'fs';
import path from 'path';

const FILE = process.env.SUBSCRIBERS_FILE ?? path.join(process.cwd(), 'subscribers.json');

function load(): Set<number> {
  try {
    return new Set(JSON.parse(fs.readFileSync(FILE, 'utf-8')));
  } catch {
    return new Set();
  }
}

function save(set: Set<number>) {
  fs.writeFileSync(FILE, JSON.stringify([...set], null, 2));
}

export const subs = load();

export function subscribe(chatId: number) {
  subs.add(chatId);
  save(subs);
}

export function unsubscribe(chatId: number) {
  subs.delete(chatId);
  save(subs);
}
