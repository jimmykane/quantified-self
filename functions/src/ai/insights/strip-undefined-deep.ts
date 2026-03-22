export function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(entry => stripUndefinedDeep(entry))
      .filter(entry => entry !== undefined);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .reduce<Record<string, unknown>>((accumulator, [key, nestedValue]) => {
        const cleanedValue = stripUndefinedDeep(nestedValue);
        if (cleanedValue !== undefined) {
          accumulator[key] = cleanedValue;
        }
        return accumulator;
      }, {});
  }

  return value;
}
