// Angular's build wrapper replaces these constants without generating mutable source files.
declare const QS_BUILD_COMMIT: string | undefined;
declare const QS_BUILD_RUN: string | undefined;
declare const QS_BUILD_DIRTY: boolean | undefined;

interface BuildMetadata { commit?: unknown; run?: unknown; dirty?: unknown; }

/** Only bounded public build identifiers belong in Sentry, never arbitrary environment values. */
export function getSentryBuildTags(metadata: BuildMetadata = {
  commit: typeof QS_BUILD_COMMIT === 'undefined' ? undefined : QS_BUILD_COMMIT,
  run: typeof QS_BUILD_RUN === 'undefined' ? undefined : QS_BUILD_RUN,
  dirty: typeof QS_BUILD_DIRTY === 'undefined' ? undefined : QS_BUILD_DIRTY,
}): Record<string, string> {
  return {
    build_commit: typeof metadata.commit === 'string' && metadata.commit.trim() === metadata.commit
      && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(metadata.commit)
      ? metadata.commit : 'unknown',
    build_run: metadata.run === 'local' || typeof metadata.run === 'string' && metadata.run.trim() === metadata.run
      && /^[1-9][0-9]{0,19}\.[1-9][0-9]{0,19}$/.test(metadata.run)
      ? metadata.run : 'unknown',
    build_dirty: typeof metadata.dirty === 'boolean' ? String(metadata.dirty) : 'unknown',
  };
}

/** Preserve only known build tags through stricter diagnostic privacy filters. */
export function projectSentryBuildTags(tags: Record<string, unknown> | undefined): Record<string, string> {
  const safe = getSentryBuildTags({ commit: tags?.['build_commit'], run: tags?.['build_run'],
    dirty: tags?.['build_dirty'] === 'true' ? true : tags?.['build_dirty'] === 'false' ? false : undefined });
  return Object.fromEntries(Object.entries(safe).filter(([, value]) => value !== 'unknown'));
}
