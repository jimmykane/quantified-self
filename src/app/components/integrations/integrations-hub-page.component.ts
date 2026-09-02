import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { ServiceSourceIconComponent } from '../event-summary/service-source-icon/service-source-icon.component';
import { INTEGRATION_HUB_CARDS } from './integration-pages.content';
import { PublicFeaturePreviewComponent } from '../public-seo/public-feature-preview.component';

@Component({
  selector: 'app-integrations-hub-page',
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    ServiceSourceIconComponent,
    PublicFeaturePreviewComponent,
  ],
  templateUrl: './integrations-hub-page.component.html',
  styleUrls: ['./integrations-hub-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationsHubPageComponent {
  readonly integrationCards = INTEGRATION_HUB_CARDS;
}
