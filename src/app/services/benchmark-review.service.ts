import { Clipboard } from '@angular/cdk/clipboard';
import { inject, Injectable } from '@angular/core';
import { User } from '@sports-alliance/sports-lib';
import { AppEventInterface, BenchmarkResult } from '@shared/app-event.interface';
import {
  BenchmarkReviewerSummary,
  buildBenchmarkReviewerSummary,
} from '../helpers/benchmark-review.helper';
import { EventTagService } from './event-tag.service';

@Injectable({
  providedIn: 'root',
})
export class BenchmarkReviewService {
  private eventTagService = inject(EventTagService);
  private clipboard = inject(Clipboard);

  normalizeTags(value: unknown): string[] {
    return this.eventTagService.normalizeTags(value);
  }

  getEventTags(event: AppEventInterface | null | undefined): string[] {
    return this.eventTagService.getTags(event);
  }

  async saveEventTags(
    user: User,
    event: AppEventInterface,
    tags: unknown,
    expectedTags?: unknown,
  ): Promise<string[]> {
    return this.eventTagService.saveTags(user, event, tags, expectedTags);
  }

  buildSummary(result: BenchmarkResult | null | undefined, tags: unknown): BenchmarkReviewerSummary {
    return buildBenchmarkReviewerSummary(result, this.normalizeTags(tags));
  }

  copySummary(result: BenchmarkResult | null | undefined, tags: unknown): boolean {
    return this.clipboard.copy(this.buildSummary(result, tags).text);
  }
}
