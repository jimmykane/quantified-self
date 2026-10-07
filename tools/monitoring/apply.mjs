import { validateTarget } from './target.mjs';

const logging = 'https://logging.googleapis.com/v2';
const monitoring = 'https://monitoring.googleapis.com';

/** Injected transport makes every provisioning test offline. No deletion operations. */
/** Shared provisioning for two explicit, separately owned monitoring bundles. */
export async function applyOwnedMonitoring(bundle, request, owner) {
  const { project, metrics, dashboard, policies } = bundle;
  const channel = policies[0]?.notificationChannels[0];
  validateTarget(project, channel);
  if (!Object.hasOwn(dashboard.labels || {}, owner) || dashboard.labels[owner] !== ''
      || policies.some(policy => policy.userLabels?.managed_by !== owner)
      || metrics.some(metric => !metric.description?.startsWith(`[${owner}]`))) {
    throw new Error('Refusing a bundle with mismatched monitoring ownership.');
  }
  if (!channel || policies.some(policy => policy.notificationChannels.length !== 1
      || policy.notificationChannels[0] !== channel)) throw new Error('One explicit existing email channel is required.');
  const selected = await request('GET', `${monitoring}/v3/${channel}`);
  if (selected?.type !== 'email' || selected.enabled !== true
      || selected.verificationStatus === 'UNVERIFIED') throw new Error('Selected email channel must be enabled and verified when verification is required.');

  async function list(url, key) {
    const items = []; const seen = new Set(); let token;
    do {
      const page = await request('GET', `${url}${token ? `?pageToken=${encodeURIComponent(token)}` : ''}`);
      if (!page || (page[key] !== undefined && !Array.isArray(page[key]))) throw new Error('Malformed monitoring inventory.');
      items.push(...(page[key] || []));
      token = page.nextPageToken;
      if (token !== undefined && typeof token !== 'string') throw new Error('Malformed inventory page token.');
      if (token && seen.has(token)) throw new Error('Repeated inventory page token.');
      seen.add(token);
    } while (token);
    return items;
  }
  // Preflight all inventories and ownership before making any mutation. Existing
  // Essentials/OOM configuration is untouched; name collisions fail closed.
  const dashboardsUrl = `${monitoring}/v1/projects/${project}/dashboards`;
  const policiesUrl = `${monitoring}/v3/projects/${project}/alertPolicies`;
  const [existingDashboards, existingPolicies, existingMetrics] = await Promise.all([
    list(dashboardsUrl, 'dashboards'), list(policiesUrl, 'alertPolicies'),
    list(`${logging}/projects/${project}/metrics`, 'metrics'),
  ]);
  function owned(items, title, id) {
    const isOwned = item => id === undefined ? Object.hasOwn(item.labels || {}, owner) && item.labels[owner] === ''
      : item.userLabels?.managed_by === owner;
    const matches = items.filter(item => item.displayName === title
      || (item.userLabels?.managed_by === owner && item.userLabels.policy_id === id)
      || (id === undefined && isOwned(item)));
    if (matches.length > 1) throw new Error('Duplicate managed configuration; resolve manually.');
    const found = matches[0];
    if (found && !isOwned(found)) {
      throw new Error('Refusing to overwrite unowned monitoring configuration.');
    }
    return found;
  }
  function resourceName(name, kind) {
    // The API can return the numeric project identity even when listed by ID.
    const match = /^projects\/([a-z][a-z0-9-]*|[0-9]+)\/(dashboards|alertPolicies)\/([A-Za-z0-9_-]+)$/.exec(name || '');
    if (!match || match[0] !== name || (match[1] !== project && !/^[0-9]+$/.test(match[1])) || match[2] !== kind) {
      throw new Error('Unexpected monitoring resource identity.');
    }
    return name;
  }
  const oldDashboard = owned(existingDashboards, dashboard.displayName);
  if (oldDashboard) {
    resourceName(oldDashboard.name, 'dashboards');
    if (!oldDashboard.etag) throw new Error('Dashboard concurrency token missing.');
  }
  const oldPolicies = policies.map(policy => {
    const old = owned(existingPolicies, policy.displayName, policy.userLabels.policy_id);
    if (old) resourceName(old.name, 'alertPolicies');
    return old;
  });
  for (const metric of metrics) {
    const matches = existingMetrics.filter(old => old.name === metric.name);
    if (matches.length > 1 || (matches[0] && !matches[0].description?.startsWith(`[${owner}]`))) {
      throw new Error('Refusing to overwrite unowned log metric.');
    }
    const old = matches[0]?.metricDescriptor;
    if (old && (old.metricKind !== metric.metricDescriptor.metricKind || old.valueType !== metric.metricDescriptor.valueType
        || old.unit !== metric.metricDescriptor.unit
        // STRING is the default enum value and can be omitted in API JSON.
        || JSON.stringify((old.labels || []).map(label => [label.key, label.valueType ?? 'STRING']).sort())
          !== JSON.stringify(metric.metricDescriptor.labels.map(label => [label.key, label.valueType]).sort()))) {
      throw new Error('Immutable log metric schema changed; use a new versioned metric name.');
    }
  }
  for (const metric of metrics) await request('PUT', `${logging}/projects/${project}/metrics/${metric.name}`, metric);
  const savedDashboard = oldDashboard
    ? await request('PATCH', `${monitoring}/v1/${oldDashboard.name}`, {
      ...dashboard, name: oldDashboard.name, etag: oldDashboard.etag,
    })
    : await request('POST', dashboardsUrl, dashboard);
  for (const [index, policy] of policies.entries()) {
    const old = oldPolicies[index];
    if (old) {
      const conditions = policy.conditions.map(condition => {
        const previous = old.conditions?.find(item => item.displayName === condition.displayName);
        return previous?.name ? { ...condition, name: previous.name } : condition;
      });
      await request('PATCH', `${monitoring}/v3/${old.name}?updateMask=displayName,userLabels,enabled,severity,combiner,conditions,notificationChannels,alertStrategy,documentation`,
        { ...policy, name: old.name, conditions });
    } else await request('POST', policiesUrl, policy);
  }
  return { metrics: metrics.length, policies: policies.length, dashboard: savedDashboard.name };
}
