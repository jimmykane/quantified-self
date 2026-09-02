import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { PublicSeoPage } from './public-seo-pages.content';
import { PublicFeaturePreviewComponent } from './public-feature-preview.component';
import { CompactFeatureRowComponent } from '../shared/compact-feature-row/compact-feature-row.component';

@Component({
  selector: 'app-public-seo-page',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, PublicFeaturePreviewComponent, CompactFeatureRowComponent],
  templateUrl: './public-seo-page.component.html',
  styleUrls: ['./public-seo-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicSeoPageComponent {
  private readonly route = inject(ActivatedRoute);

  readonly page = this.route.snapshot.data['publicSeoPage'] as PublicSeoPage;
}
