import { Component, computed, effect, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { HistoryImportProgressService, type HistoryImportOwner } from '../../services/history-import-progress.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { HistoryImportCardsComponent } from './history-import-cards.component';

export interface HistoryImportPanelData { owner: HistoryImportOwner; }
@Component({selector: 'app-history-import-panel', standalone: true,
  imports: [MatButtonModule, MatIconModule, HistoryImportCardsComponent],
  templateUrl: './history-import-panel.component.html', styleUrl: './history-import-panel.component.scss',
  host: {'[class.history-bottom-sheet]': 'bottomSheet'}})
export class HistoryImportPanelComponent {
  private readonly progress = inject(HistoryImportProgressService);
  private readonly dialogRef = inject(MatDialogRef, {optional: true});
  private readonly sheetRef = inject(MatBottomSheetRef, {optional: true});
  private readonly haptics = inject(AppHapticsService);
  readonly data = inject<HistoryImportPanelData>(MAT_DIALOG_DATA, {optional: true}) || inject<HistoryImportPanelData>(MAT_BOTTOM_SHEET_DATA, {optional: true});
  readonly bottomSheet = !!this.sheetRef;
  readonly ownerUid = this.data?.owner.uid || '';
  readonly view = this.progress.view;
  readonly count = computed(() => this.view().items.length);
  constructor() { effect(() => { if (this.progress.owner() !== this.data?.owner) this.close(false); }); }
  close(feedback = true): void {
    if (feedback) this.haptics.selection();
    this.dialogRef?.close(); this.sheetRef?.dismiss();
  }
}
