import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RoutePreviewJSONInterface } from '@sports-alliance/sports-lib';
import { buildRoutePreviewThumbnail } from '../../../helpers/route-preview-map.helper';

@Component({
  selector: 'app-route-preview-thumbnail',
  standalone: true,
  templateUrl: './route-preview-thumbnail.component.html',
  styleUrls: ['./route-preview-thumbnail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoutePreviewThumbnailComponent {
  readonly preview = input<RoutePreviewJSONInterface | null | undefined>(null);
  readonly routeName = input<string | null | undefined>('Route');

  readonly thumbnail = computed(() => buildRoutePreviewThumbnail(this.preview()));
  readonly displayRouteName = computed(() => {
    const routeName = this.routeName();
    return typeof routeName === 'string' && routeName.trim().length > 0 ? routeName.trim() : 'Route';
  });
  readonly ariaLabel = computed(() => (
    this.thumbnail()
      ? `Preview map for ${this.displayRouteName()}`
      : `No preview map available for ${this.displayRouteName()}`
  ));
}
