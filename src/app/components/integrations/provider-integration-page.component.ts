import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { ServiceSourceIconComponent } from '../event-summary/service-source-icon/service-source-icon.component';
import { getProviderIntegrationPage } from './integration-pages.content';

@Component({
  selector: 'app-provider-integration-page',
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    ServiceSourceIconComponent,
  ],
  templateUrl: './provider-integration-page.component.html',
  styleUrls: ['./provider-integration-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProviderIntegrationPageComponent {
  private readonly route = inject(ActivatedRoute);

  readonly page = getProviderIntegrationPage(this.route.snapshot.data['integrationProvider']);
}
