import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AppAnalyticsService, ToolCompareEntrySource } from '../../services/app.analytics.service';


interface ToolCard {
  title: string;
  description: string;
  icon: string;
  route: string;
  status: 'Available' | 'Available in your account';
  actionLabel: string;
}

@Component({
  selector: 'app-tools-hub-page',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule],
  templateUrl: './tools-hub-page.component.html',
  styleUrls: ['./tools-hub-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolsHubPageComponent {
  private analyticsService = inject(AppAnalyticsService);


  readonly tools: ToolCard[] = [
    {
      title: 'File comparison',
      description: 'Compare FIT, GPX, TCX, JSON, and SML recordings as one saved benchmark event.',
      icon: 'compare_arrows',
      route: '/tools/compare',
      status: 'Available',
      actionLabel: 'Open',
    },
    {
      title: 'File analysis',
      description: 'Upload an activity from Dashboard, then open its details to review maps, charts and statistics in your archive.',
      icon: 'query_stats',
      route: '/dashboard',
      status: 'Available in your account',
      actionLabel: 'Open Dashboard',
    },
    {
      title: 'Device benchmarks',
      description: 'Open Saved File Comparisons to review existing benchmark reports or generate a report from a saved comparison.',
      icon: 'analytics',
      route: '/tools/compare/saved',
      status: 'Available in your account',
      actionLabel: 'Open Saved Comparisons',
    },
  ];

  logCompareEntry(source: ToolCompareEntrySource): void {
    this.analyticsService.logToolCompareEntry(source);
  }

  logToolCardEntry(route: string): void {
    if (route === '/tools/compare') {
      this.logCompareEntry('tools_hub_card');
    }
  }
}
