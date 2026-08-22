const sportsLib = await import('@sports-alliance/sports-lib');

Object.assign(
  sportsLib.ActivityTypeGroups as unknown as Record<string, string>,
  { UnspecifiedGroup: 'unspecified_group' },
);

Object.assign(
  sportsLib.ActivityTypesHelper as unknown as Record<string, unknown>,
  {
    shouldExcludeAscent: (activityType: unknown) => (
      (sportsLib.ACTIVITIES_EXCLUDED_FROM_ASCENT as readonly unknown[]).includes(activityType)
    ),
    shouldExcludeDescent: (activityType: unknown) => (
      (sportsLib.ACTIVITIES_EXCLUDED_FROM_DESCENT as readonly unknown[]).includes(activityType)
    ),
  },
);
