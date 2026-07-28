import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import type { Type } from '@angular/core';

@Component({
  selector: 'app-shell-header',
  templateUrl: './app-shell-header.component.html',
  styleUrls: ['./app-shell-header.component.scss'],
  standalone: false
})
export class AppShellHeaderComponent {
  private _isHandset = false;
  private _showUploadActivities = false;
  private dashboardHeaderUploadLoad: Promise<void> | null = null;

  @Input() bannerHeight = 0;
  @Input() authState: boolean | null = null;
  @Input() isDashboardRoute = false;
  @Input() isLoginRoute = false;
  @Input() isAdminRoute = false;
  @Input()
  get isHandset(): boolean {
    return this._isHandset;
  }
  set isHandset(value: boolean) {
    this._isHandset = value;
    this.dashboardHeaderUploadInputs.set({ isHandset: value });
  }
  @Input()
  get showUploadActivities(): boolean {
    return this._showUploadActivities;
  }
  set showUploadActivities(value: boolean) {
    this._showUploadActivities = value;
    if (value) {
      this.loadDashboardHeaderUpload();
    }
  }
  @Input() isAdminUser = false;
  @Input() unreadWhatsNewCount = 0;

  @Output() toggleSidenav = new EventEmitter<void>();
  @Output() logoClick = new EventEmitter<void>();
  @Output() whatsNewClick = new EventEmitter<void>();
  @Output() dashboardClick = new EventEmitter<void>();
  @Output() adminClick = new EventEmitter<void>();
  @Output() loginClick = new EventEmitter<void>();

  readonly dashboardHeaderUploadComponent = signal<Type<unknown> | null>(null);
  readonly dashboardHeaderUploadInputs = signal<Record<string, unknown>>({ isHandset: false });

  private loadDashboardHeaderUpload(): void {
    if (this.dashboardHeaderUploadComponent() || this.dashboardHeaderUploadLoad) {
      return;
    }

    this.dashboardHeaderUploadLoad = import('../dashboard/dashboard-header-upload/dashboard-header-upload.component')
      .then(({ DashboardHeaderUploadComponent }) => {
        this.dashboardHeaderUploadComponent.set(DashboardHeaderUploadComponent);
      })
      .catch((error: unknown) => {
        this.dashboardHeaderUploadLoad = null;
        console.error('Failed to load the dashboard upload action.', error);
      });
  }
}
