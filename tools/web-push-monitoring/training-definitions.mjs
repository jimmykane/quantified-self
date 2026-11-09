/** Training notification health is separate from the existing provider-delivery queue monitoring. */
export function appendTrainingPushMonitoring(bundle, project, channel, owner, runbook) {
  const base = `resource.type="cloud_run_revision" resource.labels.project_id="${project}" resource.labels.location="europe-west2"`;
  const runtime = `${base} resource.labels.service_name="sendtrainingsyncnotifications"`;
  const names = ['qs_training_sync_push_outcomes_v1', 'qs_training_sync_push_sweeps_v1', 'qs_training_sync_push_overdue_v1'];
  const filters = [`metric.type="logging.googleapis.com/user/${names[0]}" ${base}`,
    ...names.slice(1).map(name => `metric.type="logging.googleapis.com/user/${name}" ${runtime}`)];
  const aggregate = { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: [] };
  bundle.metrics.push({ name: names[0], description: `[${owner}] Training notification admission and send outcomes. Acceptance is not display.`,
    filter: `${base} jsonPayload.message:"[TrainingSyncPush]" jsonPayload.telemetryVersion=1 jsonPayload.phase=("admission" OR "send" OR "sweep") jsonPayload.outcome=("accepted" OR "expired" OR "failed" OR "cancelled" OR "limited")`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1', labels: ['outcome', 'phase'].map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
    labelExtractors: { outcome: 'EXTRACT(jsonPayload.outcome)', phase: 'EXTRACT(jsonPayload.phase)' } });
  for (let index = 1; index < 3; index++) bundle.metrics.push({ name: names[index],
    description: `[${owner}] Bounded training notification sweep health, including disabled and idle operation.`,
    filter: `${runtime} jsonPayload.message="[TrainingSyncPushSweep]" jsonPayload.telemetryVersion=1 jsonPayload.oldestDueAgeSeconds>=0${index === 2 ? ' jsonPayload.oldestDueAgeSeconds>=180' : ''}`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1', labels: [] } });
  const threshold = (displayName, filter, thresholdValue = 2, alignmentPeriod = '900s') => ({ displayName, conditionThreshold: {
    filter, aggregations: [{ ...aggregate, alignmentPeriod }], comparison: 'COMPARISON_GT', thresholdValue,
    duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } });
  bundle.policies.push({ displayName: 'QS Web Push: Training-sync sender health', userLabels: { managed_by: owner, policy_id: 'training-sender' },
    enabled: true, severity: 'WARNING', combiner: 'OR', notificationChannels: channel ? [channel] : [], conditions: [
      threshold('Repeated training notification admission or send failures', `${filters[0]} metric.labels.outcome="failed"`),
      threshold('Repeated training notification runtime failures', `metric.type="run.googleapis.com/request_count" ${base} resource.labels.service_name=one_of("sendtrainingsyncnotifications", "queuetrainingsyncnotification") metric.labels.response_code_class="5xx"`),
      threshold('Two overdue training notification observations in five minutes', filters[2], 1, '300s'),
      { displayName: 'No completed training notification sweep for fifteen minutes', conditionAbsent: {
        filter: filters[1], aggregations: [{ ...aggregate, alignmentPeriod: '300s' }], duration: '900s', trigger: { count: 1 } } },
    ], alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
    documentation: { mimeType: 'text/markdown', subject: '[QS Web Push] Training-sync sender health',
      content: `Verify the minute scheduler, trainingDueAt collection-group index, unconditional switches and matching key. Confirm an initial heartbeat series after deployment; a never-seen series cannot bootstrap absence detection. Disabled and idle sweeps still report health. Category changes, superseded intent, pauses, recovered problems, duplicates, rate caps and expired registrations are expected. Provider retries and dead letters remain covered by Training delivery monitoring. Notification claims never replay after ambiguous sends. Never clear receipts or expose endpoints, identifiers, workout contents or raw errors. [Runbook](${runbook})` } });
  filters.forEach((filter, index) => bundle.dashboard.mosaicLayout.tiles.push({ yPos: 40 + index * 4, width: 12, height: 4, widget: {
    title: ['Training-sync notification outcomes', 'Training-sync completed sweeps', 'Training-sync overdue observations'][index],
    xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: {
      filter, aggregation: { ...aggregate, groupByFields: index === 0 ? ['metric.label.outcome', 'metric.label.phase'] : [] } }, unitOverride: '1' } }],
    yAxis: { label: 'Count', scale: 'LINEAR' } },
  } }));
}
