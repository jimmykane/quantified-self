import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { CompactFeatureRowComponent } from '../compact-feature-row/compact-feature-row.component';

@Component({
  selector: 'app-reviewer-benchmark-preview',
  standalone: true,
  imports: [MatIconModule, CompactFeatureRowComponent],
  templateUrl: './reviewer-benchmark-preview.component.html',
  styleUrls: ['./reviewer-benchmark-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewerBenchmarkPreviewComponent {}
