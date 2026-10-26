import { Component, DestroyRef, ElementRef, EventEmitter, Input, Output, ViewChild, afterNextRender, inject, signal } from '@angular/core';
import type { Type } from '@angular/core';
import { BrowserCompatibilityService } from '../../services/browser.compatibility.service';

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
  private _authState: boolean | null = null;
  private historyImportLoad: Promise<void> | null = null;
  private historyImportType: Type<unknown> | null = null;
  private readonly destroyRef = inject(DestroyRef);
  @ViewChild('header') private header?: ElementRef<HTMLElement>;

  @Input() bannerHeight = 0;
  @Input() get authState(): boolean | null { return this._authState; }
  set authState(value: boolean | null) {
    this._authState = value;
    if (value === true) this.loadHistoryImports();
    else this.historyImportComponent.set(null);
  }
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
  @Output() heightChanged = new EventEmitter<number>();

  readonly dashboardHeaderUploadComponent = signal<Type<unknown> | null>(null);
  readonly historyImportComponent = signal<Type<unknown> | null>(null);
  readonly dashboardHeaderUploadInputs = signal<Record<string, unknown>>({ isHandset: false });

  constructor() {
    afterNextRender(() => {
      if (!this.header || this.destroyRef.destroyed) return;
      const measure = () => {
        if (this.destroyRef.destroyed) return;
        const height = Math.ceil(this.header?.nativeElement.getBoundingClientRect().height || 0);
        if (height >= 64) this.heightChanged.emit(height);
      };
      measure();
      if (!BrowserCompatibilityService.checkResizeObserverSupport()) return;
      const observer = new ResizeObserver(measure);
      observer.observe(this.header.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  private loadHistoryImports(): void {
    if (this.historyImportType) { this.historyImportComponent.set(this.historyImportType); return; }
    if (this.historyImportLoad) return;
    this.historyImportLoad = import('../history-import-progress/history-import-indicator.component')
      .then(({HistoryImportIndicatorComponent}) => {
        this.historyImportType = HistoryImportIndicatorComponent;
        if (!this.destroyRef.destroyed && this._authState === true) this.historyImportComponent.set(this.historyImportType);
      }).catch((error: unknown) => {
        this.historyImportLoad = null;
        console.error('Failed to load history import status.', error);
      });
  }

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
