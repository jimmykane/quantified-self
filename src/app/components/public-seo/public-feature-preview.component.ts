import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, PLATFORM_ID, afterNextRender, inject, input, signal } from '@angular/core';
import { chartViewportQueue } from '../../helpers/chart-viewport-queue';
import { HomeDashboardPreviewComponent } from '../home/home-dashboard-preview.component';
import { HomeMyTracksPreviewComponent } from '../home/home-my-tracks-preview.component';
import { HomeSignalChartsPreviewComponent } from '../home/home-signal-charts-preview.component';
import { HomeWorkoutPreviewComponent } from '../home/home-workout-preview.component';
import { ProviderDataFlowMatrixComponent } from '../shared/provider-data-flow-matrix/provider-data-flow-matrix.component';
import { buildPublicProviderDataFlowRows } from '../shared/provider-data-flow-matrix/provider-data-flow-matrix.helper';
import { TrainingSnapshotPreviewComponent } from '../shared/training-summary/training-snapshot-preview.component';
import { ReviewerBenchmarkPreviewComponent } from '../shared/reviewer-benchmark-preview/reviewer-benchmark-preview.component';
import { AssistantExamplePreviewComponent } from '../shared/assistant-example-preview/assistant-example-preview.component';
import { McpReadOnlyFlowPreviewComponent } from '../shared/mcp-read-only-flow-preview/mcp-read-only-flow-preview.component';
import type { PublicFeaturePreviewKey } from './public-feature-preview.types';
import { HealthPreviewComponent } from './health-preview.component';
import { HealthOverviewPreviewComponent } from './health-overview-preview.component';
import { HealthNoteComparisonPreviewComponent } from './health-note-comparison-preview.component';
import { TrainingExplorerPreviewComponent } from './training-explorer-preview.component';
import { TrainingPlansPreviewComponent } from './training-plans-preview.component';

@Component({
  selector: 'app-public-feature-preview',
  standalone: true,
  imports: [
    HealthPreviewComponent,
    HealthOverviewPreviewComponent,
    HealthNoteComparisonPreviewComponent,
    TrainingExplorerPreviewComponent,
    TrainingPlansPreviewComponent,
    HomeDashboardPreviewComponent,
    HomeMyTracksPreviewComponent,
    HomeSignalChartsPreviewComponent,
    HomeWorkoutPreviewComponent,
    ProviderDataFlowMatrixComponent,
    TrainingSnapshotPreviewComponent,
    ReviewerBenchmarkPreviewComponent,
    AssistantExamplePreviewComponent,
    McpReadOnlyFlowPreviewComponent,
  ],
  templateUrl: './public-feature-preview.component.html',
  styleUrls: ['./public-feature-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.preview-prepares-ahead]': 'prepareAhead()' },
})
export class PublicFeaturePreviewComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly previewKey = input.required<PublicFeaturePreviewKey>();
  readonly prepareAhead = input(false);
  readonly previewReady = signal(false);
  readonly providerDataFlowRows = buildPublicProviderDataFlowRows();

  constructor() {
    afterNextRender(() => {
      if (!this.isBrowser || !this.prepareAhead()) return;
      // Share the plots' scroll root, 600px lookahead and one-per-frame scheduling.
      const pending = chartViewportQueue.wait(this.host.nativeElement);
      this.destroyRef.onDestroy(pending.cancel);
      void pending.ready.then(ready => {
        if (ready && !this.destroyRef.destroyed) this.previewReady.set(true);
      });
    });
  }
}
