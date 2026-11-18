/** Category failures retain the existing channel; shared worker health is monitored once. */
export function appendTrainingPushMonitoring(bundle, project, channel, owner, runbook) {
  const base = `resource.type="cloud_run_revision" resource.labels.project_id="${project}" resource.labels.location="europe-west2"`;
  const name = 'qs_training_sync_push_outcomes_v1';
  const filter = `metric.type="logging.googleapis.com/user/${name}" ${base}`;
  const aggregate = { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: [] };
  bundle.metrics.push({ name, description: `[${owner}] Training notification admission and send outcomes. Acceptance is not display.`,
    filter: `${base} jsonPayload.message:"[TrainingSyncPush]" jsonPayload.telemetryVersion=1 jsonPayload.phase=("admission" OR "send" OR "sweep") jsonPayload.outcome=("accepted" OR "expired" OR "failed" OR "cancelled" OR "limited")`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1', labels: ['outcome', 'phase'].map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
    labelExtractors: { outcome: 'EXTRACT(jsonPayload.outcome)', phase: 'EXTRACT(jsonPayload.phase)' } });
  const threshold = (displayName, filter) => ({ displayName, conditionThreshold: {
    filter, aggregations: [aggregate], comparison: 'COMPARISON_GT', thresholdValue: 2,
    duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } });
  bundle.policies.push({ displayName: 'QS Web Push: Training-sync sender health', userLabels: { managed_by: owner, policy_id: 'training-sender' },
    enabled: true, severity: 'WARNING', combiner: 'OR', notificationChannels: channel ? [channel] : [], conditions: [
      threshold('Repeated training notification admission or send failures', `${filter} metric.labels.outcome="failed"`),
      threshold('Repeated training notification runtime failures', `metric.type="run.googleapis.com/request_count" ${base} resource.labels.service_name="queuetrainingsyncnotification" metric.labels.response_code_class="5xx"`),
    ], alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
    documentation: { mimeType: 'text/markdown', subject: '[QS Web Push] Training-sync sender health',
      content: `Training attention uses the shared sendActivitySyncNotifications worker, dueAt queue and single backlog/heartbeat policy. Explicit Training results send directly in queueTrainingSyncNotification when all captured workouts finish. Check switches, preferences and key pairing. Provider retries and dead letters remain covered by Training delivery monitoring. Claims never replay after ambiguous sends. Never expose private data or clear receipts. [Runbook](${runbook})` } });
  bundle.dashboard.mosaicLayout.tiles.push({ yPos: 40, width: 12, height: 4, widget: {
    title: 'Training-sync notification outcomes', xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: {
      filter, aggregation: { ...aggregate, groupByFields: ['metric.label.outcome', 'metric.label.phase'] } }, unitOverride: '1' } }],
    yAxis: { label: 'Count', scale: 'LINEAR' } },
  } });
}
