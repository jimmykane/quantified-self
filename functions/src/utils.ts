import * as base58 from 'bs58';

export function generateIDFromParts(parts: string[]): string{
  return base58.encode(Buffer.from(`${parts.join(':')}`));
}
