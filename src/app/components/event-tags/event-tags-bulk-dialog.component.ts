import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatChipInputEvent } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  EventTagChanges,
  EVENT_TAG_LIMIT,
  EVENT_TAG_MAX_LENGTH,
  normalizeEventTags,
  normalizeEventTagSuggestions,
} from '@shared/event-tags';
import { SharedModule } from '../../modules/shared.module';

export interface EventTagsBulkDialogData {
  selectedCount: number;
  addSuggestions?: string[];
  removeSuggestions?: string[];
  save: (changes: EventTagChanges) => Promise<unknown>;
}

type ChangeKind = 'add' | 'remove';

@Component({
  selector: 'app-event-tags-bulk-dialog',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './event-tags-bulk-dialog.component.html',
  styleUrls: ['./event-tags-bulk-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventTagsBulkDialogComponent {
  @ViewChild('addInputElement') addInputElement?: ElementRef<HTMLInputElement>;
  @ViewChild('removeInputElement') removeInputElement?: ElementRef<HTMLInputElement>;

  private dialogRef = inject(MatDialogRef<EventTagsBulkDialogComponent>);
  private snackBar = inject(MatSnackBar);
  private data = inject<EventTagsBulkDialogData>(MAT_DIALOG_DATA);

  readonly separatorKeysCodes = [ENTER, COMMA] as const;
  readonly tagLimit = EVENT_TAG_LIMIT;
  readonly tagMaxLength = EVENT_TAG_MAX_LENGTH;
  readonly selectedCount = this.data.selectedCount;
  readonly addTags = signal<string[]>([]);
  readonly removeTags = signal<string[]>([]);
  readonly addInput = signal('');
  readonly removeInput = signal('');
  readonly isSaving = signal(false);
  readonly hasChanges = computed(() => this.addTags().length > 0 || this.removeTags().length > 0);
  readonly addSuggestions = signal(this.normalizeSuggestions(this.data.addSuggestions || []));
  readonly removeSuggestions = signal(this.normalizeSuggestions(this.data.removeSuggestions || []));
  readonly filteredAddSuggestions = computed(() => this.filterSuggestions(
    this.addSuggestions(), [...this.addTags(), ...this.removeTags()], this.addInput(),
  ));
  readonly filteredRemoveSuggestions = computed(() => this.filterSuggestions(
    this.removeSuggestions(), [...this.removeTags(), ...this.addTags()], this.removeInput(),
  ));

  addFromInput(kind: ChangeKind, event: MatChipInputEvent): void {
    this.addTag(kind, event.value);
    event.chipInput?.clear();
    this.setInput(kind, '');
  }

  selectSuggestion(kind: ChangeKind, event: MatAutocompleteSelectedEvent): void {
    this.addTag(kind, event.option.value);
    this.clearInput(kind);
  }

  updateInput(kind: ChangeKind, value: string): void {
    this.setInput(kind, value);
  }

  removeTag(kind: ChangeKind, tag: string): void {
    if (this.isSaving()) {
      return;
    }
    const target = kind === 'add' ? this.addTags : this.removeTags;
    target.update(tags => tags.filter(value => value.toLowerCase() !== tag.toLowerCase()));
  }

  async apply(): Promise<void> {
    if (this.isSaving() || !this.hasChanges()) {
      return;
    }
    this.isSaving.set(true);
    this.dialogRef.disableClose = true;
    try {
      await this.data.save({ add: this.addTags(), remove: this.removeTags() });
      this.dialogRef.close(true);
    } catch (error) {
      this.snackBar.open(
        error instanceof Error && error.message ? error.message : 'Could not update event tags.',
        undefined,
        { duration: 3500 },
      );
    } finally {
      this.dialogRef.disableClose = false;
      this.isSaving.set(false);
    }
  }

  private addTag(kind: ChangeKind, rawValue: unknown): void {
    if (this.isSaving()) {
      return;
    }
    const [tag] = normalizeEventTags([rawValue]);
    if (!tag) {
      return;
    }
    const target = kind === 'add' ? this.addTags : this.removeTags;
    const opposite = kind === 'add' ? this.removeTags() : this.addTags();
    if (opposite.some(value => value.toLowerCase() === tag.toLowerCase())) {
      this.snackBar.open('A tag cannot be added and removed in the same update.', undefined, { duration: 2500 });
      return;
    }
    target.update((tags) => {
      if (tags.some(value => value.toLowerCase() === tag.toLowerCase())) {
        return tags;
      }
      if (tags.length >= this.tagLimit) {
        this.snackBar.open(`Use up to ${this.tagLimit} tags per change.`, undefined, { duration: 2500 });
        return tags;
      }
      return [...tags, tag];
    });
  }

  private setInput(kind: ChangeKind, value: string): void {
    (kind === 'add' ? this.addInput : this.removeInput).set(value);
  }

  private clearInput(kind: ChangeKind): void {
    const element = kind === 'add' ? this.addInputElement : this.removeInputElement;
    if (element?.nativeElement) {
      element.nativeElement.value = '';
    }
    this.setInput(kind, '');
  }

  private normalizeSuggestions(values: string[]): string[] {
    return normalizeEventTagSuggestions(values).sort((a, b) => a.localeCompare(b));
  }

  private filterSuggestions(suggestions: string[], selected: string[], queryValue: string): string[] {
    const query = queryValue.trim().toLowerCase();
    const selectedKeys = new Set(selected.map(tag => tag.toLowerCase()));
    return suggestions
      .filter(tag => !selectedKeys.has(tag.toLowerCase()))
      .filter(tag => !query || tag.toLowerCase().includes(query));
  }
}
