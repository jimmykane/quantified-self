import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { SummaryPrimaryInfoMetric } from '../summary-primary-info/summary-primary-info.component';

@Component({
    selector: 'app-hero-metrics',
    templateUrl: './hero-metrics.component.html',
    styleUrls: ['./hero-metrics.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class HeroMetricsComponent {
    @Input() metrics: SummaryPrimaryInfoMetric[] = [];

    get isEmpty(): boolean {
        return this.metrics.length === 0 || this.metrics.every(m => !m.value || m.value === '--');
    }

    // Expose skeleton count as an array for @for loops
    readonly skeletonItems = [0, 1, 2];
}
