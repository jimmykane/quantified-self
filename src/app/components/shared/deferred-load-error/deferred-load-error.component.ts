import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnChanges, PLATFORM_ID, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { deferredLoadLabel, type DeferredLoadArea } from '../../../helpers/deferred-load.helper';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppWindowService } from '../../../services/app.window.service';
import { DeferredLoadDiagnosticsService } from '../../../services/deferred-load-diagnostics.service';

@Component({
  selector: 'app-deferred-load-error',
  standalone: true,
  imports: [MatButtonModule],
  templateUrl: './deferred-load-error.component.html',
  styleUrls: ['./deferred-load-error.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeferredLoadErrorComponent implements OnChanges {
  private readonly diagnostics = inject(DeferredLoadDiagnosticsService);
  private readonly window = inject(AppWindowService);
  private readonly haptics = inject(AppHapticsService);
  readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly area = input.required<DeferredLoadArea>();
  readonly label = computed(() => deferredLoadLabel(this.area()));
  readonly reloading = signal(false);
  readonly reloadFailed = signal(false);
  private reloadTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() { inject(DestroyRef).onDestroy(() => this.clearReloadTimeout()); }

  ngOnChanges(): void {
    if (this.isBrowser) this.diagnostics.report(this.area());
  }

  reload(): void {
    if (!this.isBrowser || this.reloading()) return;
    this.reloading.set(true); this.reloadFailed.set(false);
    try { this.haptics.selection(); } catch { /* Optional feedback must never block recovery. */ }
    // A browser/unsaved-change prompt can cancel navigation. Permit another explicit try.
    this.reloadTimeout = setTimeout(() => { this.reloadTimeout = null; this.reloading.set(false); }, 5_000);
    try { this.window.windowRef.location.reload(); }
    catch {
      this.clearReloadTimeout(); this.reloading.set(false); this.reloadFailed.set(true);
      try { this.haptics.error(); } catch { /* Keep the fallback usable if feedback is unavailable. */ }
    }
  }

  private clearReloadTimeout(): void {
    if (this.reloadTimeout !== null) clearTimeout(this.reloadTimeout);
    this.reloadTimeout = null;
  }
}
