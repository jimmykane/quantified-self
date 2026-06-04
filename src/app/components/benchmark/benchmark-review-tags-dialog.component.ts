import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatChipInputEvent } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  BENCHMARK_REVIEW_TAG_LIMIT,
  normalizeBenchmarkReviewTags,
} from '../../helpers/benchmark-review.helper';
import { SharedModule } from '../../modules/shared.module';

export interface BenchmarkReviewTagsDialogData {
  title?: string;
  tags: string[];
  suggestions?: string[];
  save?: (tags: string[]) => Promise<string[]>;
}

@Component({
  selector: 'app-benchmark-review-tags-dialog',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './benchmark-review-tags-dialog.component.html',
  styleUrls: ['./benchmark-review-tags-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BenchmarkReviewTagsDialogComponent {
  @ViewChild('tagInputElement') tagInputElement?: ElementRef<HTMLInputElement>;

  private dialogRef = inject(MatDialogRef<BenchmarkReviewTagsDialogComponent>);
  private snackBar = inject(MatSnackBar);
  private data = inject<BenchmarkReviewTagsDialogData>(MAT_DIALOG_DATA);

  readonly separatorKeysCodes = [ENTER, COMMA] as const;
  readonly tagLimit = BENCHMARK_REVIEW_TAG_LIMIT;
  readonly title = this.data.title || 'Review tags';
  readonly originalTags = normalizeBenchmarkReviewTags(this.data.tags);
  readonly stagedTags = signal<string[]>(this.originalTags);
  readonly tagInput = signal('');
  readonly isSaving = signal(false);
  readonly suggestions = signal<string[]>(this.normalizeSuggestions(this.data.suggestions || []));
  readonly hasReachedLimit = computed(() => this.stagedTags().length >= this.tagLimit);
  readonly hasChanges = computed(() => !this.areTagsEqual(this.originalTags, this.stagedTags()));
  readonly filteredSuggestions = computed(() => {
    const query = this.tagInput().trim().toLowerCase();
    const selectedKeys = new Set(this.stagedTags().map(tag => tag.toLowerCase()));
    return this.suggestions()
      .filter(tag => !selectedKeys.has(tag.toLowerCase()))
      .filter(tag => !query || tag.toLowerCase().includes(query));
  });

  addTagFromInput(event: MatChipInputEvent): void {
    const rawValue = event.value || this.tagInput();
    this.addTag(rawValue);
    event.chipInput?.clear();
    this.tagInput.set('');
  }

  selectSuggestion(event: MatAutocompleteSelectedEvent): void {
    this.addTag(event.option.value);
    this.clearInputElement();
  }

  updateTagInput(value: string): void {
    this.tagInput.set(value);
  }

  removeTag(tag: string): void {
    if (this.isSaving()) {
      return;
    }

    const key = tag.toLowerCase();
    this.stagedTags.update(tags => tags.filter(existingTag => existingTag.toLowerCase() !== key));
  }

  async apply(): Promise<void> {
    if (this.isSaving()) {
      return;
    }

    const tags = this.stagedTags();
    if (!this.hasChanges()) {
      this.dialogRef.close(null);
      return;
    }

    this.isSaving.set(true);
    try {
      const savedTags = this.data.save
        ? await this.data.save(tags)
        : tags;
      this.dialogRef.close(normalizeBenchmarkReviewTags(savedTags));
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Could not save review tags.';
      this.snackBar.open(message, undefined, { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  private addTag(rawValue: unknown): void {
    if (this.isSaving()) {
      return;
    }

    const [tag] = normalizeBenchmarkReviewTags([rawValue]);
    if (!tag) {
      return;
    }

    this.stagedTags.update((tags) => {
      if (tags.some(existingTag => existingTag.toLowerCase() === tag.toLowerCase())) {
        return tags;
      }
      if (tags.length >= this.tagLimit) {
        this.snackBar.open(`Use up to ${this.tagLimit} review tags.`, undefined, { duration: 2500 });
        return tags;
      }
      return [...tags, tag];
    });
  }

  private clearInputElement(): void {
    if (this.tagInputElement?.nativeElement) {
      this.tagInputElement.nativeElement.value = '';
    }
    this.tagInput.set('');
  }

  private normalizeSuggestions(suggestions: string[]): string[] {
    return normalizeBenchmarkReviewTags(suggestions)
      .sort((first, second) => first.localeCompare(second));
  }

  private areTagsEqual(firstTags: string[], secondTags: string[]): boolean {
    if (firstTags.length !== secondTags.length) {
      return false;
    }
    return firstTags.every((tag, index) => tag === secondTags[index]);
  }
}
