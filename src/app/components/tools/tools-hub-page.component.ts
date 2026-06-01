import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SharedModule } from '../../modules/shared.module';

interface ToolCard {
  title: string;
  description: string;
  icon: string;
  route: string;
  status: 'available' | 'planned';
}

@Component({
  selector: 'app-tools-hub-page',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './tools-hub-page.component.html',
  styleUrls: ['./tools-hub-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolsHubPageComponent {
  readonly tools: ToolCard[] = [
    {
      title: 'File comparison',
      description: 'Compare FIT, GPX, and TCX recordings as one saved benchmark event.',
      icon: 'compare_arrows',
      route: '/tools/compare',
      status: 'available',
    },
    {
      title: 'File analysis',
      description: 'Inspect a single activity file and keep the source data in your archive.',
      icon: 'query_stats',
      route: '/features/fit-gpx-tcx-file-analyzer',
      status: 'planned',
    },
    {
      title: 'Device benchmarks',
      description: 'Open saved benchmark reports for review, coaching, and QA workflows.',
      icon: 'analytics',
      route: '/features/sports-watch-benchmark',
      status: 'planned',
    },
  ];
}
