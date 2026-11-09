import { DOCUMENT } from '@angular/common';
import { Component, EventEmitter, Injector, Input, OnChanges, OnDestroy, Output, SimpleChanges, TemplateRef, ViewChild, afterNextRender, inject } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSelectionListChange } from '@angular/material/list';
import { DataGradeAdjustedPaceAvg } from '@sports-alliance/sports-lib/metrics';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppUserUtilities } from '../../../utils/app.user.utilities';

@Component({
  selector: 'app-event-table-actions',
  templateUrl: 'event.table.actions.component.html',
  styleUrls: ['event.table.actions.component.css'],
  standalone: false,
})
export class EventTableActionsComponent implements OnChanges, OnDestroy {
  private readonly haptics = inject(AppHapticsService);
  private readonly dialog = inject(MatDialog);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private dialogRef: MatDialogRef<unknown> | null = null;
  private destroyed = false;
  @ViewChild('columnsDialog') private columnsDialog?: TemplateRef<unknown>;
  @Input() selectedDataTypes: string[] = [];
  @Input() icon = 'view_column';
  @Input() disabled = false;
  @Input() saving = false;
  @Input() saveError: string | null = null;
  @Input() contextKey = '';
  @Input() scopeHint = 'Changes save automatically. Date, tags, description and row actions stay in their fixed positions. On phones, sport and tags stay first.';
  @Input() dataTypes = [
    ...AppUserUtilities.getDefaultSelectedTableColumns().filter(type => type !== 'Description'),
    DataGradeAdjustedPaceAvg.type,
  ];
  @Output() selectedDataTypesChange = new EventEmitter<string[]>();
  selectedColumns: string[] = [];
  availableColumns: string[] = [];
  searchTerm = '';
  announcement = '';
  readonly labels: Record<string, string> = { [DataGradeAdjustedPaceAvg.type]: 'GAP (grade-adjusted pace)' };

  ngOnChanges(changes: SimpleChanges): void {
    const focused = this.getPickerFocus();
    if (this.disabled || (changes.contextKey && !changes.contextKey.firstChange)) this.dialogRef?.close('context-changed');
    this.refreshColumns();
    if (changes.saveError && this.saveError) this.announcement = this.saveError;
    this.restorePickerFocus(focused);
  }

  openColumnsDialog(): void {
    if (this.disabled || this.dialogRef || !this.columnsDialog) return;
    this.searchTerm = '';
    this.announcement = '';
    this.refreshColumns();
    const ref = this.dialog.open(this.columnsDialog, {
      ariaLabel: 'Choose table columns', width: '520px', maxWidth: 'calc(100vw - 24px)',
      maxHeight: 'calc(100dvh - 24px)', autoFocus: 'first-heading', restoreFocus: true,
    });
    this.dialogRef = ref;
    this.haptics.selection();
    ref.afterClosed().subscribe(result => {
      if (this.dialogRef === ref) this.dialogRef = null;
      if (!this.destroyed && result !== 'context-changed') this.haptics.selection();
    });
  }

  selectionChange(event: MatSelectionListChange): void {
    const added = event.options.filter(option => option.selected && typeof option.value === 'string').map(option => option.value);
    this.applyColumns([...this.selectedColumns, ...added], added[0]);
  }

  removeColumn(type: string): void {
    this.applyColumns(this.selectedColumns.filter(column => column !== type));
  }

  moveColumn(type: string, direction: -1 | 1): void {
    const index = this.selectedColumns.indexOf(type);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= this.selectedColumns.length) return;
    const next = [...this.selectedColumns];
    [next[index], next[destination]] = [next[destination], next[index]];
    if (this.applyColumns(next, type) && !this.saveError) this.announcement = `${this.labels[type] || type} moved to position ${destination + 1} of ${next.length}.`;
  }

  search(event: Event): void {
    this.searchTerm = (event.target as HTMLInputElement).value;
    this.refreshColumns();
  }

  clearSearch(): void {
    if (!this.searchTerm) return;
    const focused = this.getPickerFocus();
    this.searchTerm = '';
    this.refreshColumns();
    this.haptics.selection();
    this.restorePickerFocus(focused);
  }

  private refreshColumns(): void {
    const allowed = new Set(this.dataTypes);
    this.selectedColumns = [...new Set(this.selectedDataTypes)].filter(type => allowed.has(type));
    const selected = new Set(this.selectedColumns);
    const search = this.searchTerm.trim().toLowerCase();
    this.availableColumns = this.dataTypes.filter(type => !selected.has(type)
      && `${type} ${this.labels[type] || ''}`.toLowerCase().includes(search));
  }

  private applyColumns(columns: string[], focusType?: string): boolean {
    if (this.disabled || this.saving) return false;
    const next = [...new Set(columns)].filter(type => this.dataTypes.includes(type));
    if (next.length === this.selectedColumns.length && next.every((type, index) => type === this.selectedColumns[index])) return false;
    const focused = this.getPickerFocus();
    // The parent owns the accepted selection and any save rollback. Mutating an
    // input here can hide a synchronous rollback when its binding stays unchanged.
    this.announcement = '';
    this.haptics.selection();
    this.selectedDataTypesChange.emit(next);
    this.restorePickerFocus(focused, focusType);
    return true;
  }

  private getPickerFocus(): HTMLElement | null {
    const active = this.document.activeElement;
    const dialog = this.dialogRef && this.document.getElementById(this.dialogRef.id);
    return active instanceof HTMLElement && dialog?.contains(active) ? active : null;
  }

  private restorePickerFocus(previous: HTMLElement | null, type?: string): void {
    const dialogId = this.dialogRef?.id;
    if (!previous || !dialogId || this.destroyed) return;
    afterNextRender(() => {
      if (this.destroyed || this.dialogRef?.id !== dialogId) return;
      const active = this.document.activeElement;
      if (active !== previous && active !== this.document.body) return;
      const dialog = this.document.getElementById(dialogId);
      const row = Array.from(dialog?.querySelectorAll<HTMLElement>('[data-event-column]') || [])
        .find(element => element.dataset.eventColumn === type);
      const target = previous.isConnected && !previous.matches(':disabled') ? previous
        : row?.querySelector<HTMLInputElement>('input:not(:disabled)')
          || dialog?.querySelector<HTMLElement>('[data-event-column-search]');
      target?.focus();
    }, { injector: this.injector });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.dialogRef?.close('context-changed');
  }
}
