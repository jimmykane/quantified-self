import { Clipboard } from '@angular/cdk/clipboard';
import { inject, Injectable } from '@angular/core';
import { User } from '@sports-alliance/sports-lib';
import { AppEventInterface, BenchmarkResult } from '@shared/app-event.interface';
import {
  BenchmarkReviewerSummary,
  buildBenchmarkReviewerSummary,
  normalizeBenchmarkReviewTags,
} from '../helpers/benchmark-review.helper';
import { AppEventService } from './app.event.service';

@Injectable({
  providedIn: 'root',
})
export class BenchmarkReviewService {
  private eventService = inject(AppEventService);
  private clipboard = inject(Clipboard);

  normalizeTags(value: unknown): string[] {
    return normalizeBenchmarkReviewTags(value);
  }

  getEventTags(event: AppEventInterface | null | undefined): string[] {
    return this.normalizeTags(event?.benchmarkReviewTags);
  }

  async saveEventTags(user: User, event: AppEventInterface, tags: unknown): Promise<string[]> {
    const eventID = event.getID?.();
    if (!eventID) {
      throw new Error('Cannot save tags for a comparison without an event ID.');
    }

    const normalizedTags = this.normalizeTags(tags);
    await this.eventService.updateEventProperties(user, eventID, {
      benchmarkReviewTags: normalizedTags,
    });
    event.benchmarkReviewTags = normalizedTags;
    return normalizedTags;
  }

  buildSummary(result: BenchmarkResult | null | undefined, tags: unknown): BenchmarkReviewerSummary {
    return buildBenchmarkReviewerSummary(result, this.normalizeTags(tags));
  }

  copySummary(result: BenchmarkResult | null | undefined, tags: unknown): boolean {
    return this.clipboard.copy(this.buildSummary(result, tags).text);
  }
}
