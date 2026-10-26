import { Component, computed, inject, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ServiceSourceIconComponent } from '../event-summary/service-source-icon/service-source-icon.component';
import { HistoryImportProgressService } from '../../services/history-import-progress.service';
import { AppHapticsService } from '../../services/app.haptics.service';

@Component({selector: 'app-history-import-cards', standalone: true,
  imports: [DecimalPipe, RouterLink, MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule, MatProgressSpinnerModule, MatTooltipModule, ServiceSourceIconComponent],
  templateUrl: './history-import-cards.component.html', styleUrl: './history-import-cards.component.scss'})
export class HistoryImportCardsComponent {
  readonly ownerUid = input.required<string>();
  readonly placement = input<'dashboard' | 'panel'>('panel');
  readonly detailsOpened = output<void>();
  private readonly progress = inject(HistoryImportProgressService);
  private readonly haptics = inject(AppHapticsService);
  readonly refreshing = this.progress.refreshing;
  readonly items = computed(() => this.progress.owner()?.uid === this.ownerUid() ? this.progress.view().items : []);
  readonly showCards = computed(() => this.items().length > 0
    && (this.placement() !== 'dashboard' || !this.progress.dashboardHidden()));
  hideDashboard(): void {
    const owner = this.progress.owner();
    if (this.placement() !== 'dashboard' || owner?.uid !== this.ownerUid()) return;
    if (this.progress.setDashboardHidden(true, owner)) this.haptics.selection();
  }
  refresh(): void {
    if (this.progress.owner()?.uid !== this.ownerUid() || this.refreshing()) return;
    this.haptics.selection(); this.progress.refresh();
  }
  openDetails(event: MouseEvent): void {
    // Router navigation owns the selection haptic. Modified links keep the panel open.
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) this.detailsOpened.emit();
  }
}
