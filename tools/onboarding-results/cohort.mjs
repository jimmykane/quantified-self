const day = 86_400_000;
const starts = {
  onboarding_sync_selected: 'sync',
  onboarding_analyze_selected: 'analyze',
  onboarding_compare_selected: 'compare',
};
const results = {
  sync: 'activity_delivered',
  analyze: 'recorded_workout_opened',
  compare: 'comparison_result_opened',
};

function validateAccount(uid) {
  if (typeof uid !== 'string' || !uid.trim() || uid.includes('/')) throw new Error('Invalid account identifier.');
}

// Keep the first selection since rollout, including selections before the reporting window.
export function cohortStarts(events, from, until) {
  const byAccount = new Map();
  for (const { uid, name, at } of events) {
    if (!Object.hasOwn(starts, name)) continue;
    validateAccount(uid);
    const time = instant(at);
    if (time >= until) continue;
    if (!byAccount.has(uid)) byAccount.set(uid, {});
    const selections = byAccount.get(uid);
    const flow = starts[name];
    selections[flow] = Math.min(selections[flow] ?? Infinity, time);
  }
  for (const [uid, selections] of byAccount) {
    for (const [flow, first] of Object.entries(selections)) {
      if (first < from) delete selections[flow];
    }
    if (!Object.keys(selections).length) byAccount.delete(uid);
  }
  return byAccount;
}

export function freshDelivery(row) {
  return row.resultStatus === 'success' && row.destinationInfoCode !== 'ALREADY_EXISTS';
}

export function instant(value) {
  let time = value;
  if (typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) time = Date.parse(value);
  if (!Number.isSafeInteger(time) || time < 1e12) throw new Error('Expected an ISO timestamp with timezone or Unix milliseconds.');
  return time;
}

function firstOnOrAfter(times, start) {
  let first = Infinity;
  for (const time of times) if (time >= start && time < first) first = time;
  return first;
}

function cancellationOrder(first, cancel) {
  if (!Number.isFinite(first)) return 'cancellationWithoutObservedResult';
  // Stripe cancellation times have second precision.
  if (Math.floor(first / 1000) === Math.floor(cancel / 1000)) return 'sameInstant';
  return first < cancel ? 'resultBeforeCancellation' : 'cancellationBeforeFirstObservedResult';
}

export function report({ from, until, asOf, events, deliveries, cancellations, completeReceipts = false }) {
  const lo = instant(from);
  const hi = instant(until);
  const end = instant(asOf);
  if (lo >= hi || hi > end) throw new Error('Expected from < until <= asOf.');
  const users = new Map();
  for (const [uid, start] of cohortStarts(events, lo, hi)) {
    users.set(uid, { start, results: {}, cancellations: [] });
  }
  for (const { uid, name, at } of events) {
    if (name !== results.analyze && name !== results.compare) continue;
    validateAccount(uid);
    const time = instant(at);
    if (time <= end && users.has(uid)) (users.get(uid).results[name] ??= []).push(time);
  }
  for (const { uid, at } of deliveries) {
    validateAccount(uid);
    const time = instant(at);
    if (time <= end && users.has(uid)) (users.get(uid).results[results.sync] ??= []).push(time);
  }
  for (const { uid, at } of cancellations ?? []) {
    validateAccount(uid);
    const time = instant(at);
    if (time <= end && users.has(uid)) users.get(uid).cancellations.push(time);
  }

  const output = {};
  for (const [flow, result] of Object.entries(results)) {
    const minutes = [];
    const counts = { starters: 0, observed24h: 0, matureStarters: 0, pending24h: 0 };
    const order = {
      resultBeforeCancellation: 0, cancellationBeforeFirstObservedResult: 0,
      sameInstant: 0, cancellationWithoutObservedResult: 0, selectionOrderUnknown: 0,
    };
    for (const user of users.values()) {
      const start = user.start[flow];
      if (start === undefined) continue;
      counts.starters++;
      const first = firstOnOrAfter(user.results[result] ?? [], start);
      if (start + day <= end) {
        counts.matureStarters++;
        if (first <= start + day) counts.observed24h++;
        if (Number.isFinite(first)) minutes.push((first - start) / 60_000);
      } else {
        counts.pending24h++;
      }
      const selectionSecond = Math.floor(start / 1000) * 1000;
      const cancel = firstOnOrAfter(user.cancellations, selectionSecond);
      if (cancel < start) order.selectionOrderUnknown++;
      else if (Number.isFinite(cancel)) order[cancellationOrder(first, cancel)]++;
    }
    minutes.sort((a, b) => a - b);
    const lower = Math.floor((minutes.length - 1) / 2);
    const upper = Math.floor(minutes.length / 2);
    output[flow] = {
      ...counts,
      observed24hShare: counts.matureStarters ? counts.observed24h / counts.matureStarters : null,
      receiptCoverage: flow === 'sync' && !completeReceipts ? 'retained or partial receipts; lower bound' : undefined,
      medianMinutesToFirstObservedResult: minutes.length ? (minutes[lower] + minutes[upper]) / 2 : null,
      cancellationOrder: cancellations == null ? null : order,
    };
  }
  return output;
}
