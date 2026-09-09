import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export type CompactRowTone =
  'primary' | 'secondary' | 'tertiary' | 'neutral';

@Component({
  selector: 'app-compact-row',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './compact-row.component.html',
  styleUrl: './compact-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.compact-row-host--without-divider]': '!showDivider()',
    '[class.compact-row-host--fill-height]': 'fillHeight() && layout() === "stacked"',
  },
})
export class CompactRowComponent {
  readonly title = input.required<string>();
  readonly titleId = input<string | null>(null);
  readonly headingLevel = input<2 | 3 | 4>(3);
  readonly summary = input<string | null>(null);
  readonly icon = input<string | null>(null);
  readonly iconTone = input<CompactRowTone>('primary');
  readonly showDivider = input(true);
  readonly fillHeight = input(false);
  readonly layout = input<'columns' | 'stacked'>('columns');
  readonly density = input<'comfortable' | 'compact'>('comfortable');
}
