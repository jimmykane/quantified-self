import { CommonModule } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { Component, NgModule, computed, inject, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ServiceSourceIconComponent } from '../../../src/app/components/event-summary/service-source-icon/service-source-icon.component';
import { ConnectionHistoryOptionComponent } from '../../../src/app/components/services/connection-history/connection-history.component';
import { ServiceConnectionStatusComponent } from '../../../src/app/components/services/service-connection-status/service-connection-status.component';
import { AppEventService } from '../../../src/app/services/app.event.service';
import { AppHapticsService } from '../../../src/app/services/app.haptics.service';
import { AppIconService } from '../../../src/app/services/app.icon.service';
import { AppUserService } from '../../../src/app/services/app.user.service';
import { SharedModule } from '../../../src/app/modules/shared.module';
import type { ConnectionHistoryRangePreset } from '../../../shared/connection-history';

// This entry point is built independently. The production app never imports it.
// Existing app components render against local fixtures, without Firebase/Auth/Stripe.
@NgModule({
  declarations: [ServiceConnectionStatusComponent],
  imports: [CommonModule, MatIconModule, MatChipsModule, MatDividerModule, MatProgressBarModule],
  exports: [ServiceConnectionStatusComponent],
})
class ConnectionPreviewPrimitivesModule {}

type PreviewState = 'start' | 'importing' | 'ready';

@Component({
  selector: 'app-pro-onboarding-preview',
  standalone: true,
  imports: [CommonModule, SharedModule, ConnectionPreviewPrimitivesModule, ServiceSourceIconComponent,
    ConnectionHistoryOptionComponent, MatButtonModule, MatButtonToggleModule, MatIconModule,
    MatToolbarModule, MatDividerModule, MatProgressBarModule],
  templateUrl: './preview.html',
  styleUrls: ['../../../src/app/components/services/services.component.scss', './preview.scss'],
})
class ProOnboardingPreviewComponent {
  private readonly params = new URLSearchParams(window.location.search);
  readonly state = signal<PreviewState>(this.params.get('state') === 'ready' ? 'ready'
    : this.params.get('state') === 'importing' ? 'importing' : 'start');
  readonly connected = computed(() => this.state() !== 'start');
  readonly ready = computed(() => this.state() === 'ready');
  readonly activeStep = computed(() => this.ready() ? 2 : this.connected() ? 1 : 0);
  readonly providers = [
    { id: ServiceNames.GarminAPI, label: 'Garmin Connect', icon: 'garmin' },
    { id: ServiceNames.SuuntoApp, label: 'Suunto App', icon: 'suunto' },
    { id: ServiceNames.COROSAPI, label: 'COROS', icon: 'coros' },
    { id: ServiceNames.WahooAPI, label: 'Wahoo', icon: 'wahoo' },
  ] as const;
  readonly selectedProvider = signal<ServiceNames>(ServiceNames.GarminAPI);
  readonly provider = computed(() => this.providers.find(p => p.id === this.selectedProvider())!);
  readonly steps = ['Connect a provider', 'Bring in activities', 'Explore your training'];
  readonly historyChecked = signal(true);
  readonly historyRange = signal<ConnectionHistoryRangePreset>('30_days');
  readonly notice = signal('');

  constructor() {
    inject(AppIconService).registerIcons();
    inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-rounded', 'mat-ligature-font');
  }

  selectProvider(provider: ServiceNames): void {
    this.selectedProvider.set(provider);
    this.state.set('start');
    this.notice.set('');
  }

  previewConnection(): void {
    this.notice.set('Preview only: provider authorization would open here. No connection or import has started.');
  }

  previewDashboard(): void {
    this.notice.set('Preview only: this action would open your Dashboard.');
  }
}

if (new URLSearchParams(window.location.search).get('theme') !== 'light') {
  document.body.classList.add('dark-theme');
}

bootstrapApplication(ProOnboardingPreviewComponent, {
  providers: [provideHttpClient(), provideNoopAnimations(),
    { provide: AppHapticsService, useValue: { selection() {}, success() {}, error() {} } },
    { provide: AppEventService, useValue: {} },
    { provide: AppUserService, useValue: { user: signal({ uid: 'local-preview-user' }) } },
  ],
}).then(() => document.body.classList.add('app-hydrated'))
  .catch(error => { document.body.textContent = 'Preview failed to render.'; console.error(error); });
