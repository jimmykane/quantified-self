import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatChipInputEvent } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  EVENT_TAG_LIMIT,
  EVENT_TAG_MAX_LENGTH,
  normalizeEventTags,
  normalizeEventTagSuggestions,
} from '@shared/event-tags';
import { SharedModule } from '../../modules/shared.module';

export interface EventTagsDialogData {
  title?: string;
  tags: string[];
  suggestions?: string[];
  save?: (tags: string[]) => Promise<string[]>;
}

@Component({
  selector: 'app-event-tags-dialog',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './event-tags-dialog.component.html',
  styleUrls: ['./event-tags-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventTagsDialogComponent {
  @ViewChild('tagInputElement') tagInputElement?: ElementRef<HTMLInputElement>;

  private dialogRef = inject(MatDialogRef<EventTagsDialogComponent>);
  private snackBar = inject(MatSnackBar);
  private data = inject<EventTagsDialogData>(MAT_DIALOG_DATA);

  readonly separatorKeysCodes = [ENTER, COMMA] as const;
  readonly tagLimit = EVENT_TAG_LIMIT;
  readonly tagMaxLength = EVENT_TAG_MAX_LENGTH;
  readonly title = this.data.title || 'Event tags';
  readonly originalTags = normalizeEventTags(this.data.tags);
  readonly stagedTags = signal<string[]>(this.originalTags);
  readonly tagInput = signal('');
  readonly isSaving = signal(false);
  readonly suggestions = signal<string[]>(
    normalizeEventTagSuggestions(this.data.suggestions || []).sort((a, b) => a.localeCompare(b)),
  );
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
    this.addTag(event.value || this.tagInput());
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
    if (!this.isSaving()) {
      this.stagedTags.update(tags => tags.filter(value => value.toLowerCase() !== tag.toLowerCase()));
    }
  }

  async apply(): Promise<void> {
    if (this.isSaving()) {
      return;
    }
    if (!this.hasChanges()) {
      this.dialogRef.close(null);
      return;
    }

    this.isSaving.set(true);
    this.dialogRef.disableClose = true;
    try {
      const tags = this.stagedTags();
      const savedTags = this.data.save ? await this.data.save(tags) : tags;
      this.dialogRef.close(normalizeEventTags(savedTags));
    } catch (error) {
      this.snackBar.open(
        error instanceof Error && error.message ? error.message : 'Could not save tags.',
        undefined,
        { duration: 3000 },
      );
    } finally {
      this.dialogRef.disableClose = false;
      this.isSaving.set(false);
    }
  }

  private addTag(rawValue: unknown): void {
    if (this.isSaving()) {
      return;
    }
    const [tag] = normalizeEventTags([rawValue]);
    if (!tag) {
      return;
    }

    this.stagedTags.update((tags) => {
      if (tags.some(value => value.toLowerCase() === tag.toLowerCase())) {
        return tags;
      }
      if (tags.length >= this.tagLimit) {
        this.snackBar.open(`Use up to ${this.tagLimit} tags.`, undefined, { duration: 2500 });
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

  private areTagsEqual(first: string[], second: string[]): boolean {
    return first.length === second.length && first.every((tag, index) => tag === second[index]);
  }
}
