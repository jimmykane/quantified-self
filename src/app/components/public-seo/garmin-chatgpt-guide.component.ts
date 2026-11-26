import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { McpStarterPromptsComponent } from '../mcp-connections/mcp-starter-prompts.component';
import type { PublicSeoPage } from './public-seo-pages.content';

@Component({
  selector: 'app-garmin-chatgpt-guide',
  imports: [RouterLink, MatButtonModule, MatIconModule, AppChartSharedModule, McpStarterPromptsComponent],
  templateUrl: './garmin-chatgpt-guide.component.html',
  styleUrls: ['./garmin-chatgpt-guide.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GarminChatgptGuideComponent {
  protected readonly page: PublicSeoPage = inject(ActivatedRoute).snapshot.data['publicSeoPage'];
  protected readonly analytics = inject(AppAnalyticsService);
}
