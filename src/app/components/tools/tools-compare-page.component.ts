import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '@sports-alliance/sports-lib';
import { AppEventInterface } from '@shared/app-event.interface';
import { catchError, firstValueFrom, of, switchMap, tap } from 'rxjs';

import { AppAuthService } from '../../authentication/app.auth.service';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../confirmation-dialog/confirmation-dialog.component';
import { SharedModule } from '../../modules/shared.module';
import { AppEventService } from '../../services/app.event.service';
import { AppToolsComparisonService } from '../../services/app.tools-comparison.service';

interface SelectedFileItem {
  index: number;
  name: string;
  extension: string;
  sizeLabel: string;
}

interface ComparisonListItem {
  id: string;
  title: string;
  date: Date | null;
  sourceFilesCount: number | null;
  activitiesCount: number | null;
  sourceFilesLabel: string;
  activitiesLabel: string;
  hasReport: boolean;
  reportCount: number;
  event: AppEventInterface;
}

type ComparisonEventFields = AppEventInterface & {
  sourceFilesCount?: number;
  activitiesCount?: number;
  comparisonTitle?: string;
  benchmarkResult?: unknown;
};

const MAX_COMPARISON_FILES = 10;

@Component({
  selector: 'app-tools-compare-page',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './tools-compare-page.component.html',
  styleUrls: ['./tools-compare-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolsComparePageComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private authService = inject(AppAuthService);
  private eventService = inject(AppEventService);
  private comparisonService = inject(AppToolsComparisonService);

  readonly selectedFiles = signal<File[]>([]);
  readonly comparisonTitle = signal('');
  readonly isCreating = signal(false);
  readonly currentUser = signal<User | null>(null);
  readonly comparisons = signal<AppEventInterface[]>([]);
  readonly isLoadingComparisons = signal(false);
  readonly deletingEventID = signal<string | null>(null);
  readonly selectedTabIndex = signal(this.route.snapshot.data['defaultTab'] === 'saved' ? 1 : 0);

  readonly selectedFileItems = computed<SelectedFileItem[]>(() =>
    this.selectedFiles().map((file, index) => ({
      index,
      name: file.name || `File ${index + 1}`,
      extension: this.resolveExtensionFromFilename(file.name).toUpperCase(),
      sizeLabel: this.formatFileSize(file.size),
    })),
  );

  readonly validationMessage = computed(() => {
    const files = this.selectedFiles();
    if (files.length === 0) {
      return null;
    }
    if (files.length === 1) {
      return 'Add one more file to create a comparison.';
    }
    return this.comparisonService.validateFiles(files);
  });

  readonly canCreateComparison = computed(() =>
    !this.isCreating()
    && this.selectedFiles().length >= 2
    && !this.validationMessage(),
  );

  readonly comparisonItems = computed<ComparisonListItem[]>(() =>
    this.comparisons()
      .map((event) => this.toComparisonListItem(event))
      .filter((item): item is ComparisonListItem => !!item),
  );

  ngOnInit(): void {
    this.authService.user$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((user) => {
          this.currentUser.set(user);
          this.isLoadingComparisons.set(!!user);
          if (!user) {
            this.comparisons.set([]);
          }
        }),
        switchMap((user) => {
          if (!user) {
            return of([]);
          }
          return this.comparisonService.getBenchmarkComparisons(user).pipe(
            tap(() => this.isLoadingComparisons.set(false)),
            catchError(() => {
              this.isLoadingComparisons.set(false);
              this.snackBar.open('Could not load saved comparisons.', undefined, { duration: 3000 });
              return of([]);
            }),
          );
        }),
      )
      .subscribe((events) => this.comparisons.set(events));
  }

  onTabIndexChange(index: number): void {
    this.selectedTabIndex.set(index);
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    this.addFiles(files);
    input.value = '';
  }

  removeFile(index: number): void {
    if (this.isCreating()) {
      return;
    }

    this.selectedFiles.update(files => files.filter((_file, fileIndex) => fileIndex !== index));
  }

  clearFiles(): void {
    if (this.isCreating()) {
      return;
    }

    this.selectedFiles.set([]);
  }

  updateTitle(value: string): void {
    if (this.isCreating()) {
      return;
    }

    this.comparisonTitle.set(value);
  }

  async createComparison(): Promise<void> {
    if (this.isCreating()) {
      return;
    }

    const user = this.currentUser();
    if (!user) {
      await this.signIn('/tools/compare');
      return;
    }

    const validationError = this.comparisonService.validateFiles(this.selectedFiles());
    if (validationError) {
      this.snackBar.open(validationError, undefined, { duration: 3000 });
      return;
    }

    this.isCreating.set(true);
    try {
      const result = await this.comparisonService.createComparison(
        this.selectedFiles(),
        this.comparisonTitle(),
      );
      this.selectedFiles.set([]);
      this.comparisonTitle.set('');
      this.snackBar.open(result.alreadyExists ? 'Existing comparison opened.' : 'Comparison created.', undefined, { duration: 2000 });
      await this.router.navigate(['/user', user.uid, 'event', result.eventId], {
        queryParams: { benchmark: '1' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create comparison.';
      this.snackBar.open(message, 'Close', { duration: 5000 });
    } finally {
      this.isCreating.set(false);
    }
  }

  async openComparison(item: ComparisonListItem, benchmark: boolean): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      await this.signIn('/tools/compare/saved');
      return;
    }

    await this.router.navigate(['/user', user.uid, 'event', item.id], {
      queryParams: benchmark ? { benchmark: '1' } : undefined,
    });
  }

  async deleteComparison(item: ComparisonListItem): Promise<void> {
    if (this.deletingEventID()) {
      return;
    }

    const user = this.currentUser();
    if (!user) {
      return;
    }

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Delete comparison?',
        message: 'This removes the saved benchmark event and its source files.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmationDialogData,
    });
    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    if (!confirmed) {
      return;
    }

    this.deletingEventID.set(item.id);
    try {
      await this.eventService.deleteAllEventData(user, item.id);
      this.comparisons.update(events => events.filter(event => event.getID() !== item.id));
      this.snackBar.open('Comparison deleted.', undefined, { duration: 2000 });
    } catch (error) {
      this.snackBar.open('Could not delete comparison.', undefined, { duration: 3000 });
    } finally {
      this.deletingEventID.set(null);
    }
  }

  async signIn(redirectUrl = '/tools/compare'): Promise<void> {
    this.authService.redirectUrl = redirectUrl;
    await this.router.navigate(['/login']);
  }

  private addFiles(files: File[]): void {
    if (this.isCreating() || !files.length) {
      return;
    }

    const nextFiles = [...this.selectedFiles()];
    const rejectedNames: string[] = [];
    let rejectedForLimit = false;

    for (const file of files) {
      if (nextFiles.length >= MAX_COMPARISON_FILES) {
        rejectedForLimit = true;
        continue;
      }

      const extension = this.resolveExtensionFromFilename(file.name);
      const baseExtension = extension.endsWith('.gz') ? extension.slice(0, -3) : extension;
      if (!['fit', 'gpx', 'tcx'].includes(baseExtension)) {
        rejectedNames.push(file.name || 'Selected file');
        continue;
      }

      nextFiles.push(file);
    }

    this.selectedFiles.set(nextFiles);
    if (rejectedForLimit) {
      this.snackBar.open(`You can compare up to ${MAX_COMPARISON_FILES} files at once.`, undefined, { duration: 3000 });
    } else if (rejectedNames.length > 0) {
      this.snackBar.open('Only FIT, GPX, and TCX files are supported.', undefined, { duration: 3000 });
    }
  }

  private toComparisonListItem(event: AppEventInterface): ComparisonListItem | null {
    const eventID = event.getID();
    if (!eventID) {
      return null;
    }

    const comparisonEvent = event as ComparisonEventFields;
    const benchmarkResults = event.benchmarkResults || {};
    const savedReportCount = Object.keys(benchmarkResults).length;
    const reportCount = savedReportCount || (comparisonEvent.benchmarkResult ? 1 : 0);
    const sourceFilesCount = typeof comparisonEvent.sourceFilesCount === 'number'
      ? comparisonEvent.sourceFilesCount
      : this.getOriginalFilesCount(event);
    const activities = event.getActivities?.() || [];
    const activitiesCount = typeof comparisonEvent.activitiesCount === 'number'
      ? comparisonEvent.activitiesCount
      : (activities.length > 0 ? activities.length : null);

    return {
      id: eventID,
      title: comparisonEvent.comparisonTitle || event.name || 'Benchmark comparison',
      date: event.startDate instanceof Date ? event.startDate : null,
      sourceFilesCount,
      activitiesCount,
      sourceFilesLabel: this.formatCountLabel(sourceFilesCount, 'file', 'Files unknown'),
      activitiesLabel: this.formatCountLabel(activitiesCount, 'activity', 'Activities unknown'),
      hasReport: reportCount > 0,
      reportCount,
      event,
    };
  }

  private getOriginalFilesCount(event: AppEventInterface): number | null {
    if (Array.isArray(event.originalFiles)) {
      return event.originalFiles.length;
    }
    return event.originalFile ? 1 : null;
  }

  private formatCountLabel(count: number | null, singularLabel: string, emptyLabel: string): string {
    if (count === null) {
      return emptyLabel;
    }
    return `${count} ${singularLabel}${count === 1 ? '' : 's'}`;
  }

  private resolveExtensionFromFilename(filename: string): string {
    const normalized = filename.trim().toLowerCase();
    const parts = normalized.split('.').filter(Boolean);
    if (parts.length < 2) {
      return '';
    }

    const last = parts[parts.length - 1];
    if (last === 'gz' && parts.length >= 3) {
      return `${parts[parts.length - 2]}.gz`;
    }
    return last;
  }

  private formatFileSize(size: number): string {
    if (size < 1024) {
      return `${size} B`;
    }
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
}
