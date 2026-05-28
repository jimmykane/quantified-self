import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SharedModule } from '../../modules/shared.module';
import { getProviderIntegrationPage } from './integration-pages.content';

@Component({
  selector: 'app-provider-integration-page',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './provider-integration-page.component.html',
  styleUrls: ['./provider-integration-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProviderIntegrationPageComponent {
  private readonly route = inject(ActivatedRoute);

  readonly page = getProviderIntegrationPage(this.route.snapshot.data['integrationProvider']);
}
