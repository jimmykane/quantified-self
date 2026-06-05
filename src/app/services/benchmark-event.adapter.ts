import { Injectable } from '@angular/core';
import { AppEventInterface, BenchmarkResult } from '@shared/app-event.interface';
import { normalizeBenchmarkReviewTags } from '../helpers/benchmark-review.helper';

@Injectable({
  providedIn: 'root'
})
export class BenchmarkEventAdapter {
  applyBenchmarkFieldsFromFirestore(event: AppEventInterface, rawData: any): void {
    if (!rawData) return;

    const toDate = (val: any): Date => {
      if (!val) return new Date();
      if (val instanceof Date) return val;
      if (typeof val.toDate === 'function') return val.toDate();
      if (val.seconds !== undefined) return new Date(val.seconds * 1000);
      return new Date(val);
    };

    const normalizeDevice = (name?: string): string | null => {
      if (!name) return null;
      return name.trim().replace(/\s+/g, ' ').toLowerCase();
    };

    const getNonNegativeInteger = (value: unknown): number | null => {
      return typeof value === 'number' && Number.isInteger(value) && value >= 0
        ? value
        : null;
    };

    const applyResultDates = (result: BenchmarkResult): void => {
      if (result.timestamp) {
        result.timestamp = toDate(result.timestamp);
      }
      if (result.qualityIssues && Array.isArray(result.qualityIssues)) {
        result.qualityIssues.forEach((issue) => {
          if (issue.timestamp) {
            issue.timestamp = toDate(issue.timestamp);
          }
        });
      }
    };

    const cloneBenchmarkResult = (result: BenchmarkResult): BenchmarkResult => ({
      ...result,
      metrics: result.metrics
        ? {
          ...result.metrics,
          gnss: result.metrics.gnss ? { ...result.metrics.gnss } : result.metrics.gnss,
          streamMetrics: result.metrics.streamMetrics
            ? Object.fromEntries(
              Object.entries(result.metrics.streamMetrics)
                .map(([streamType, metrics]) => [streamType, { ...metrics }]),
            )
            : result.metrics.streamMetrics,
        }
        : result.metrics,
      qualityIssues: Array.isArray(result.qualityIssues)
        ? result.qualityIssues.map((issue) => ({ ...issue }))
        : result.qualityIssues,
    });

    if (rawData.benchmarkResults) {
      event.benchmarkResults = {};
      for (const key of Object.keys(rawData.benchmarkResults)) {
        const result = cloneBenchmarkResult(rawData.benchmarkResults[key] as BenchmarkResult);
        applyResultDates(result);
        event.benchmarkResults[key] = result;
      }
    }

    if (rawData.hasBenchmark !== undefined) {
      event.hasBenchmark = rawData.hasBenchmark;
    }
    if (Array.isArray(rawData.benchmarkDevices)) {
      event.benchmarkDevices = [...rawData.benchmarkDevices];
    }
    if (rawData.benchmarkLatestAt) {
      event.benchmarkLatestAt = toDate(rawData.benchmarkLatestAt);
    }
    if (typeof rawData.mergeType === 'string') {
      event.mergeType = rawData.mergeType;
    }
    if (typeof rawData.toolSource === 'string') {
      event.toolSource = rawData.toolSource;
    }
    if (typeof rawData.comparisonTitle === 'string') {
      event.comparisonTitle = rawData.comparisonTitle;
    }
    if (Array.isArray(rawData.benchmarkReviewTags)) {
      event.benchmarkReviewTags = normalizeBenchmarkReviewTags(rawData.benchmarkReviewTags);
    }

    const sourceFilesCount = getNonNegativeInteger(rawData.sourceFilesCount);
    if (sourceFilesCount !== null) {
      event.sourceFilesCount = sourceFilesCount;
    }
    const activitiesCount = getNonNegativeInteger(rawData.activitiesCount);
    if (activitiesCount !== null) {
      event.activitiesCount = activitiesCount;
    }

    if (event.benchmarkResults && Object.keys(event.benchmarkResults).length > 0) {
      if (event.hasBenchmark === undefined) {
        event.hasBenchmark = true;
      }
      if (!event.benchmarkDevices || event.benchmarkDevices.length === 0) {
        const devices = new Set<string>();
        Object.values(event.benchmarkResults).forEach((result) => {
          const names = [result.referenceName, result.testName];
          names.forEach((name) => {
            const normalized = normalizeDevice(name);
            if (normalized) devices.add(normalized);
          });
        });
        event.benchmarkDevices = Array.from(devices);
      }
      if (!event.benchmarkLatestAt) {
        const timestamps = Object.values(event.benchmarkResults)
          .map((result) => result.timestamp)
          .filter(Boolean)
          .map((date) => (date instanceof Date ? date : toDate(date)));
        if (timestamps.length > 0) {
          event.benchmarkLatestAt = new Date(Math.max(...timestamps.map((d) => d.getTime())));
        }
      }
    } else if (event.hasBenchmark === undefined) {
      event.hasBenchmark = false;
    }
  }
}
