// Part of the existing cleanup monitoring owner; no separate apply/provisioner.
export function buildInactivityMonitoring(project, channel, owner) {
  const runtime = `resource.type="cloud_run_revision" resource.labels.project_id="${project}" resource.labels.location="europe-west2" resource.labels.service_name="processinactiveaccounts"`;
  const base = `${runtime} jsonPayload.message="[AccountInactivity]" jsonPayload.telemetryVersion=1`;
  const name = key => `qs_cleanup_inactivity_${key}_v1`;
  const metrics = [];
  function metric(key, selection, description, field) {
    metrics.push({ name: name(key), description: `[${owner}] ${description}`, filter: `${base} ${selection}`,
      metricDescriptor: { metricKind: 'DELTA', valueType: field ? 'DISTRIBUTION' : 'INT64', unit: '1', labels: [] }, labelExtractors: {},
      ...(field ? { valueExtractor: `EXTRACT(jsonPayload.${field})`, bucketOptions: { explicitBuckets: { bounds: [0, 1, 5, 25, 100, 500] } } } : {}) });
  }
  metric('heartbeat', 'jsonPayload.outcome=("off" OR "completed" OR "contended" OR "failed")', 'Daily scheduler observation, including off/idle; not proof of cleanup.');
  metric('failures', '(jsonPayload.outcome="failed" OR jsonPayload.counts.failed>0)', 'Actual scan, provider-read or persistence failures; protective billing holds and contention excluded.');
  metric('notice', 'jsonPayload.counts.notice_unconfirmed>0', 'Missing, malformed, failed or more than one day unconfirmed warning delivery; no deletion can proceed.');
  metric('review', 'jsonPayload.reviewRequired>0', 'Bounded pending inactivity deletion fences older than 24 hours; completed receipts excluded.');
  metric('overdue', 'jsonPayload.mode="enforce" jsonPayload.overdue>0', 'Observed still-actionable deadlines more than two days overdue; future work and protected/cancelled episodes excluded.');
  metric('scan_stalled', 'jsonPayload.scanAgeMs>=604800000', 'Auth scan has not completed a cycle for seven days; cursor progress is not complete inventory.');
  metric('warnings', 'jsonPayload.counts.queued>=0', 'Warning documents queued per invocation, not SMTP acceptance.', 'counts.queued');
  metric('deletions', 'jsonPayload.counts.deletion_requested>=0', 'Individual Auth deletion initiations, not completed data cleanup.', 'counts.deletion_requested');
  metric('holds', 'jsonPayload.counts.blocked>=0', 'Protective or uncertain billing holds; informational, never a failure page.', 'counts.blocked');
  const filter = key => `metric.type="logging.googleapis.com/user/${name(key)}" resource.type="cloud_run_revision" resource.labels.project_id="${project}"`;
  const sum = { alignmentPeriod: '86400s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: [] };
  // MetricAbsence has a 23.5-hour maximum, shorter than this job's cadence.
  // Count positive heartbeat observations across revisions, including zero/absent series.
  const heartbeat = `{__name__="logging.googleapis.com/user/${name('heartbeat')}",monitored_resource="cloud_run_revision",project_id="${project}",location="europe-west2",service_name="processinactiveaccounts"}`;
  const threshold = key => ({ displayName: key, conditionThreshold: { filter: filter(key), aggregations: [sum],
    comparison: 'COMPARISON_GT', thresholdValue: 0, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } });
  const native = { displayName: 'Native daily scheduler errors, including hard timeout', conditionThreshold: {
    filter: `metric.type="run.googleapis.com/request_count" ${runtime} metric.labels.response_code_class="5xx"`, aggregations: [sum],
    comparison: 'COMPARISON_GT', thresholdValue: 0, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE',
  } };
  const policy = (id, title, conditions) => ({ displayName: `QS Cleanup: ${title}`, userLabels: { managed_by: owner, policy_id: `inactivity_${id}` },
    enabled: true, severity: 'WARNING', combiner: 'OR', conditions, notificationChannels: channel ? [channel] : [],
    alertStrategy: { autoClose: '604800s', notificationPrompts: ['OPENED', 'CLOSED'] }, documentation: { mimeType: 'text/markdown', subject: `[QS Cleanup] ${title}`,
      content: 'Daily inactivity processing is off by default. SMTP acceptance is not inbox delivery; Auth deletion is not completed cleanup. Samples are bounded, not a global account inventory. No automatic remediation. Preserve unfinished deletion fences. Deployment, activation, replay and live account deletion require separate explicit approval. [Runbook](https://github.com/jimmykane/quantified-self/blob/develop/docs/inactive-account-retention.md).' } });
  const policies = [
    policy('failure', 'Inactivity processing failed', [threshold('failures'), native]),
    policy('notice', 'Inactivity warning unconfirmed', [threshold('notice')]),
    policy('review', 'Inactivity deletion needs review', [threshold('review')]),
    policy('progress', 'Inactivity processing overdue', [threshold('overdue'), threshold('scan_stalled')]),
    policy('heartbeat', 'Daily inactivity heartbeat missing', [{ displayName: 'Daily scheduler absent for 48 hours', conditionPrometheusQueryLanguage: {
      query: `(sum(sum_over_time(${heartbeat}[48h])) or vector(0)) < 1`,
      duration: '300s', evaluationInterval: '300s',
    } }]),
  ];
  const widgets = ['heartbeat', 'warnings', 'deletions', 'holds', 'failures', 'notice', 'review', 'overdue', 'scan_stalled'].map(key => ({
    title: `Daily inactivity: ${key} (${['warnings', 'deletions', 'holds'].includes(key) ? 'per-run count p95' : 'observations'})`,
    xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: {
      timeSeriesFilter: { filter: filter(key), aggregation: ['warnings', 'deletions', 'holds'].includes(key)
        ? { ...sum, perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX' } : sum },
      unitOverride: '1' } }], yAxis: { label: ['warnings', 'deletions', 'holds'].includes(key) ? 'per-run count p95' : 'observations', scale: 'LINEAR' } },
  }));
  return { metrics, policies, widgets };
}
