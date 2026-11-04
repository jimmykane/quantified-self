/** Provider request bound includes one day of context on either side. */
export const SUUNTO_HEALTH_MAX_WINDOW_DAYS = 28;
export const SUUNTO_HEALTH_CONTEXT_PADDING_DAYS = 1;
export const SUUNTO_HEALTH_MAX_TARGET_WINDOW_DAYS = SUUNTO_HEALTH_MAX_WINDOW_DAYS - 2 * SUUNTO_HEALTH_CONTEXT_PADDING_DAYS;
