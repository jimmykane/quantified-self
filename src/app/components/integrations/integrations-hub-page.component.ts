import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SharedModule } from '../../modules/shared.module';
import { INTEGRATION_HUB_CARDS } from './integration-pages.content';

@Component({
  selector: 'app-integrations-hub-page',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './integrations-hub-page.component.html',
  styleUrls: ['./integrations-hub-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationsHubPageComponent {
  readonly integrationCards = INTEGRATION_HUB_CARDS;
}
