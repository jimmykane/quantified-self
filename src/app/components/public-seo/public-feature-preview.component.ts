import { ChangeDetectionStrategy, Component, input } from '@angular/core';
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

@Component({
  selector: 'app-public-feature-preview',
  standalone: true,
  imports: [
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
})
export class PublicFeaturePreviewComponent {
  readonly previewKey = input.required<PublicFeaturePreviewKey>();
  readonly reviewerChartsFirst = input(false);
  readonly providerDataFlowRows = buildPublicProviderDataFlowRows();
}
