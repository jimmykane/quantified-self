import { CommonModule } from '@angular/common';
import { Component, NgModule, afterNextRender, inject, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { MatIconRegistry } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatBottomSheet, MatBottomSheetModule, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { AppThemes, ServiceNames, User } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import type { ConnectionHistoryStatusProjection } from '../../shared/connection-history';
import { AppShellModule } from '../../src/app/modules/app-shell.module';
import { AppChartSharedModule } from '../../src/app/modules/app-chart-shared.module';
import { AppShellHeaderComponent } from '../../src/app/components/app-shell-header/app-shell-header.component';
import { ProcessingIndicatorComponent } from '../../src/app/components/notifications/processing-indicator/processing-indicator.component';
import { HomeDashboardPreviewComponent } from '../../src/app/components/home/home-dashboard-preview.component';
import { ServiceSourceIconComponent } from '../../src/app/components/event-summary/service-source-icon/service-source-icon.component';
import { ConnectionHistoryStatusComponent } from '../../src/app/components/services/connection-history/connection-history.component';
import { AppProcessingService } from '../../src/app/services/app.processing.service';
import { AppThemeService } from '../../src/app/services/app.theme.service';
import { AppIconService } from '../../src/app/services/app.icon.service';
import { AppEventService } from '../../src/app/services/app.event.service';
import { AppUserService } from '../../src/app/services/app.user.service';
import { AppHapticsService } from '../../src/app/services/app.haptics.service';
import { RecordedHistoryStartService } from '../../src/app/services/recorded-history-start.service';

// Local, synthetic projections only. No Auth/Firestore/provider initialization.
const params = new URLSearchParams(location.search);
const design = ['banner', 'card', 'drawer'].includes(params.get('design') || '') ? params.get('design')! : 'banner';
const light = params.get('theme') === 'light';
document.body.classList.toggle('dark-theme', !light);
const suunto: ConnectionHistoryStatusProjection = {
  runId: 'preview-suunto', rangePreset: '90_days',
  startMs: Date.UTC(2026, 6, 28), endMs: Date.UTC(2026, 9, 26), updatedAtMs: Date.UTC(2026, 9, 26),
  active: true, canRetry: false,
  steps: [
    {id: 'activities', resources: ['activities'], status: 'requesting', count: 128},
    {id: 'sleep', resources: ['sleep'], status: 'processed', count: 14},
    {id: 'health', resources: ['health'], status: 'queued', count: 0},
  ],
};
// Compile the shipped header and processing indicator, without bootstrapping app services.
@NgModule({declarations: [AppShellHeaderComponent, ProcessingIndicatorComponent],
  imports: [CommonModule, AppShellModule], exports: [AppShellHeaderComponent]})
class PreviewShellModule {}

@Component({standalone: true, imports: [AppShellModule, AppChartSharedModule, MatDialogModule, ConnectionHistoryStatusComponent],
  template: `<h2 mat-dialog-title>Suunto history import</h2><mat-dialog-content>
    <app-connection-history-status [service]="service" [status]="status" [disabled]="true" />
    </mat-dialog-content><mat-dialog-actions align="end"><button mat-button mat-dialog-close appHapticTap>Close</button></mat-dialog-actions>`,
})
class ImportDetails {
  readonly service = ServiceNames.SuuntoApp;
  readonly status = suunto;
}

@Component({standalone: true, imports: [AppShellModule, ServiceSourceIconComponent],
  templateUrl: './import-panel.html', styleUrl: './import-panel.scss'})
class ImportPanel {
  readonly service = ServiceNames;
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef, {optional: true});
  private readonly sheetRef = inject(MatBottomSheetRef, {optional: true});
  private readonly haptics = inject(AppHapticsService);
  close(): void { this.haptics.selection(); this.dialogRef?.close(); this.sheetRef?.dismiss(); }
  showDetails(): void {
    this.haptics.selection();
    this.dialog.open(ImportDetails, {width: '560px', maxWidth: 'calc(100vw - 32px)'});
  }
}

@Component({selector: 'app-import-preview', standalone: true,
  imports: [CommonModule, PreviewShellModule, AppShellModule, AppChartSharedModule, MatCardModule,
    MatBottomSheetModule, MatDialogModule, HomeDashboardPreviewComponent, ServiceSourceIconComponent],
  templateUrl: './preview.html', styleUrl: './preview.scss'})
class ImportPreview {
  readonly design = design;
  readonly drawer = signal(false);
  readonly mobile = matchMedia('(max-width: 720px)').matches;
  readonly service = ServiceNames;
  private readonly dialog = inject(MatDialog);
  private readonly sheet = inject(MatBottomSheet);
  private readonly haptics = inject(AppHapticsService);
  constructor() {
    inject(AppIconService).registerIcons();
    inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-rounded', 'mat-ligature-font');
    afterNextRender(() => { if (design === 'drawer') this.toggleImports(false); });
  }
  toggleImports(userInitiated = true): void {
    if (this.drawer()) return;
    if (userInitiated) this.haptics.selection();
    this.drawer.set(true);
    if (this.mobile) {
      this.sheet.open(ImportPanel, {ariaLabel: 'History imports'}).afterDismissed().subscribe(() => this.drawer.set(false));
      return;
    }
    this.dialog.open(ImportPanel, {ariaLabel: 'History imports', width: '400px', maxWidth: '100vw',
      height: 'calc(100dvh - 88px)', maxHeight: 'calc(100dvh - 88px)', position: {right: '12px', top: '76px'},
    }).afterClosed().subscribe(() => this.drawer.set(false));
  }
  showDetails(): void { this.haptics.selection(); this.dialog.open(ImportDetails, {width: '560px', maxWidth: 'calc(100vw - 32px)'}); }
}

bootstrapApplication(ImportPreview, {providers: [provideNoopAnimations(), provideHttpClient(),
  {provide: AppProcessingService, useValue: {jobs$: of([])}},
  {provide: AppThemeService, useValue: {appTheme: signal(light ? AppThemes.Normal : AppThemes.Dark)}},
  {provide: AppEventService, useValue: {}},
  {provide: AppUserService, useValue: {user: signal(new User('synthetic-import-preview'))}},
  {provide: AppHapticsService, useValue: {selection() {}, success() {}, error() {}, warning() {}}},
  {provide: RecordedHistoryStartService, useValue: {
    firstSleepDate: async () => null, firstHealthDate: async () => null, lastReportedGarminSleepCutoff: async () => null,
  }},
]}).then(() => document.body.classList.add('app-hydrated'));
