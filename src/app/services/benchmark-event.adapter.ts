import { Injectable } from '@angular/core';
import { AppEventInterface, BenchmarkResult } from '../../../functions/src/shared/app-event.interface';

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

    if (rawData.benchmarkResults) {
      event.benchmarkResults = {};
      for (const key of Object.keys(rawData.benchmarkResults)) {
        const result = rawData.benchmarkResults[key] as BenchmarkResult;
        applyResultDates(result);
        event.benchmarkResults[key] = result;
      }
    }

    if (rawData.hasBenchmark !== undefined) {
      event.hasBenchmark = rawData.hasBenchmark;
    }
    if (rawData.benchmarkDevices) {
      event.benchmarkDevices = rawData.benchmarkDevices;
    }
    if (rawData.benchmarkLatestAt) {
      event.benchmarkLatestAt = toDate(rawData.benchmarkLatestAt);
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
