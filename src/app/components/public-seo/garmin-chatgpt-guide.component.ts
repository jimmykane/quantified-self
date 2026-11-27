import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, ElementRef, PLATFORM_ID, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, Scroll } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { McpStarterPromptsComponent } from '../mcp-connections/mcp-starter-prompts.component';
import { GUIDE_EXAMPLE_GROUPS, FOLLOW_UP_QUESTIONS } from './garmin-chatgpt-examples';
import type { PublicSeoPage } from './public-seo-pages.content';

@Component({
  selector: 'app-garmin-chatgpt-guide',
  imports: [RouterLink, MatButtonModule, MatIconModule, AppChartSharedModule, McpStarterPromptsComponent],
  templateUrl: './garmin-chatgpt-guide.component.html',
  styleUrls: ['./garmin-chatgpt-guide.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GarminChatgptGuideComponent {
  protected readonly groups = GUIDE_EXAMPLE_GROUPS;
  protected readonly followUps = FOLLOW_UP_QUESTIONS;
  protected readonly page: PublicSeoPage = inject(ActivatedRoute).snapshot.data['publicSeoPage'];
  protected readonly analytics = inject(AppAnalyticsService);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    inject(Router).events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (!(event instanceof Scroll) || !event.anchor) return;
      const target = host.ownerDocument.getElementById(event.anchor);
      if (target && host.contains(target)) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'start' });
      }
    });
  }
}
