/** Canonical identifiers remain independent of provider-facing presentation. */
export const SUSTAINABLE_DISTANCE_TYPE = 'Estimated Sustainable Distance';
export const SUSTAINABLE_DISTANCE_MIN_TYPE = 'Minimum Estimated Sustainable Distance';

export interface EnduranceLabelContext {
  /** Parsed manufacturer only; never infer provenance from a friendly device name. */
  manufacturer?: unknown;
  surface?: 'stat' | 'stream' | 'picker';
}

/** One presentation policy for selectors, summaries, chart legends and accessible text. */
export function getEnduranceMetricLabel(type: string, context: EnduranceLabelContext = {}): string | null {
  const canonical = type.replace(/ in miles$/, '');
  const suunto = typeof context.manufacturer === 'string' && context.manufacturer.trim().toLowerCase() === 'suunto';
  const stamina = /^(?:(Average|Minimum|Maximum) )?Stamina$/.exec(canonical);
  if (stamina) {
    const prefix = stamina[1] ? `${stamina[1]} ` : '';
    if (context.surface === 'picker') return `${prefix}Stamina / Suunto EnergySense Endurance`;
    return suunto ? `${prefix}EnergySense Endurance` : canonical;
  }
  if (canonical !== SUSTAINABLE_DISTANCE_TYPE && canonical !== SUSTAINABLE_DISTANCE_MIN_TYPE) return null;
  const minimum = canonical === SUSTAINABLE_DISTANCE_MIN_TYPE;
  if (context.surface === 'picker') return `${minimum ? 'Minimum ' : ''}Estimated Sustainable Distance / Suunto EnergySense Sustainable Distance`;
  const prefix = minimum ? 'Minimum ' : context.surface === 'stat' ? 'Ending ' : '';
  return `${prefix}${suunto ? 'EnergySense Sustainable Distance' : context.surface === 'stat' ? 'Sustainable Distance' : 'Estimated Sustainable Distance'}`;
}

/** A combined view may use a provider name only when every contributing source agrees. */
export function getCommonMetricManufacturer(sources: readonly { creator?: { manufacturer?: unknown } }[]): string | undefined {
  if (!sources.length) return undefined;
  return sources.every(source => typeof source.creator?.manufacturer === 'string'
    && source.creator.manufacturer.trim().toLowerCase() === 'suunto') ? 'Suunto' : undefined;
}
