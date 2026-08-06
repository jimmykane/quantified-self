import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export type AppPageHeaderVariant = 'route' | 'compact';
export type AppPageHeaderStatus = 'pending' | 'warning';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './page-header.component.html',
  styleUrls: ['./page-header.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeaderComponent {
  readonly title = input<string | null>(null);
  readonly titleId = input<string | null>(null);
  readonly headingLevel = input<1 | 2>(1);
  readonly eyebrow = input<string | null>(null);
  readonly subtitle = input<string | null>(null);
  readonly variant = input<AppPageHeaderVariant>('route');
  readonly status = input<AppPageHeaderStatus | null>(null);
  readonly leadingAction = input(false);
  readonly ariaLabel = input<string | null>(null);

  protected statusIcon(): string | null {
    switch (this.status()) {
      case 'pending':
        return 'sync';
      case 'warning':
        return 'error_outline';
      default:
        return null;
    }
  }
}
