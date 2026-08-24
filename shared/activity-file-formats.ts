/**
 * Canonical activity-file formats accepted by upload and file-comparison entry
 * points. Route files intentionally have a narrower format set.
 */
export const ACTIVITY_FILE_BASE_EXTENSIONS = ['fit', 'gpx', 'tcx', 'json', 'sml'] as const;

export type ActivityFileBaseExtension = (typeof ACTIVITY_FILE_BASE_EXTENSIONS)[number];

const activityFileBaseExtensionSet = new Set<string>(ACTIVITY_FILE_BASE_EXTENSIONS);

export function isSupportedActivityFileBaseExtension(
  extension: string,
): extension is ActivityFileBaseExtension {
  return activityFileBaseExtensionSet.has(extension);
}
