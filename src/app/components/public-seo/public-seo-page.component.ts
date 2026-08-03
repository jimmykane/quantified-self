import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import type { PublicSeoPage } from './public-seo-pages.content';

@Component({
  selector: 'app-public-seo-page',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule],
  templateUrl: './public-seo-page.component.html',
  styleUrls: ['./public-seo-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicSeoPageComponent {
  private readonly route = inject(ActivatedRoute);

  readonly page = this.route.snapshot.data['publicSeoPage'] as PublicSeoPage;
}
