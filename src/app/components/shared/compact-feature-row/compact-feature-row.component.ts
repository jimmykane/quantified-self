import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export type CompactFeatureRowTone =
  'primary' | 'secondary' | 'tertiary' | 'neutral';

@Component({
  selector: 'app-compact-feature-row',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './compact-feature-row.component.html',
  styleUrl: './compact-feature-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactFeatureRowComponent {
  readonly title = input.required<string>();
  readonly summary = input<string | null>(null);
  readonly icon = input<string | null>(null);
  readonly iconTone = input<CompactFeatureRowTone>('primary');
}
