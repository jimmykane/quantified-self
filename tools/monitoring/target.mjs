export function validateTarget(project, channel) {
  if (typeof project !== 'string' || project !== project.trim()
      || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) throw new Error('Explicit valid project ID required.');
  if (channel !== undefined) {
    const match = /^projects\/([a-z][a-z0-9-]*)\/notificationChannels\/([0-9]+)$/.exec(channel);
    if (!match || match[0] !== channel || match[1] !== project) throw new Error('Select an existing notification channel in the same project.');
  }
}
