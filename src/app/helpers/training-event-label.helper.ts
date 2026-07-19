export function resolveTrainingEventDisplayLabel(value: string | null | undefined): string | null {
  const label = `${value || ''}`.trim();
  return label && !isGenericTrainingEventLabel(label) ? label : null;
}

export function isGenericTrainingEventLabel(value: string | null | undefined): boolean {
  const label = `${value || ''}`.trim();
  return !label || /^new event$/i.test(label) || /^\d{4}-\d{2}-\d{2}(?:$|[ t])/i.test(label);
}
