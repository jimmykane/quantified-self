import { Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { HistoryImportProgressService } from '../../services/history-import-progress.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { HistoryImportPanelComponent } from './history-import-panel.component';

@Component({selector: 'app-history-import-indicator', standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatDialogModule, MatBottomSheetModule, MatTooltipModule, MatBadgeModule],
  templateUrl: './history-import-indicator.component.html', styleUrl: './history-import-indicator.component.scss',
  host: {'[style.display]': 'view().items.length ? null : "none"'}})
export class HistoryImportIndicatorComponent {
  private readonly progress = inject(HistoryImportProgressService);
  private readonly dialog = inject(MatDialog);
  private readonly sheet = inject(MatBottomSheet);
  private readonly breakpoint = inject(BreakpointObserver);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly haptics = inject(AppHapticsService);
  private dismissPanel: (() => void) | null = null;
  readonly panelOpen = signal(false);
  readonly view = this.progress.view;
  readonly ariaLabel = computed(() => {
    const count = this.view().items.length;
    return `${this.view().label}. View history import status for ${count} ${count === 1 ? 'provider' : 'providers'}`;
  });
  readonly icon = computed(() => this.view().items.some(item => item.kind === 'attention' || item.kind === 'unavailable') ? 'info' : this.view().items.some(item => item.kind === 'retrying' || item.kind === 'requested') ? 'schedule' : 'check_circle');
  constructor() { this.destroyRef.onDestroy(() => this.dismissPanel?.()); }
  open(): void {
    const owner = this.progress.owner();
    if (!owner || !this.view().items.length || this.panelOpen() || this.destroyRef.destroyed) return;
    this.haptics.selection(); this.panelOpen.set(true);
    const data = {owner};
    const closed = () => { this.panelOpen.set(false); this.dismissPanel = null; };
    if (this.breakpoint.isMatched('(max-width: 720px)')) {
      const ref = this.sheet.open(HistoryImportPanelComponent, {data, ariaLabel: 'History imports', panelClass: 'qs-bottom-sheet-container'});
      this.dismissPanel = () => ref.dismiss();
      ref.afterDismissed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(closed);
      return;
    }
    const top = Math.max(16, Math.ceil(this.element.nativeElement.getBoundingClientRect().bottom + 12));
    const ref = this.dialog.open(HistoryImportPanelComponent, {data, ariaLabel: 'History imports', width: '620px',
      maxWidth: 'calc(100vw - 32px)', maxHeight: `calc(100dvh - ${top + 16}px)`, position: {right: '16px', top: `${top}px`}});
    this.dismissPanel = () => ref.close();
    ref.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(closed);
  }
}
