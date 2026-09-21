/** Runtime environment switch: stop accepting new automatic runs without affecting manual imports. */
export function isConnectionHistoryAdmissionEnabled(): boolean {
  return process.env.CONNECTION_HISTORY_IMPORT_ENABLED !== 'false';
}
