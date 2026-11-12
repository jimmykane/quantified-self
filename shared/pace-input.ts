/** Unit-independent clock text. Blank clears a draft; malformed text stays invalid. */
export function parsePaceDurationSeconds(text: string): number | undefined {
  const value = text.trim();
  if (!value) return undefined;
  if (!/^\d{1,2}:[0-5]\d(?::[0-5]\d)?$/.test(value)) return NaN;
  return value.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0);
}
