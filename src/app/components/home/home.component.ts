import { Component, AfterViewInit, OnDestroy, OnInit, ElementRef, DestroyRef, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import {
  MAT_TOOLTIP_DEFAULT_OPTIONS,
  MatTooltipModule,
  type MatTooltipDefaultOptions,
} from '@angular/material/tooltip';
import { AppAuthService } from '../../authentication/app.auth.service';
import { ASSISTANT_STARTER_PROMPTS } from '@shared/assistant.prompts';
import { TypedPromptRotatorComponent } from '../shared/typed-prompt-rotator/typed-prompt-rotator.component';
import { TrainingSummaryCardsComponent } from '../shared/training-summary/training-summary-cards.component';
import { TrainingMetricGridComponent } from '../shared/training-summary/training-metric-grid.component';
import type {
  TrainingSummaryCard,
  TrainingSummaryMetric,
} from '../shared/training-summary/training-summary.models';
import { HomeSignalChartsPreviewComponent } from './home-signal-charts-preview.component';
import { HomeDashboardPreviewComponent } from './home-dashboard-preview.component';
import { HomeWorkoutPreviewComponent } from './home-workout-preview.component';

const HOME_TOOLTIP_DEFAULT_OPTIONS: MatTooltipDefaultOptions = {
  showDelay: 0,
  hideDelay: 0,
  touchendHideDelay: 1500,
  touchGestures: 'off',
};

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatTooltipModule,
    HomeDashboardPreviewComponent,
    HomeSignalChartsPreviewComponent,
    HomeWorkoutPreviewComponent,
    TrainingSummaryCardsComponent,
    TrainingMetricGridComponent,
    TypedPromptRotatorComponent,
  ],
  providers: [
    { provide: MAT_TOOLTIP_DEFAULT_OPTIONS, useValue: HOME_TOOLTIP_DEFAULT_OPTIONS },
  ],
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {

  public readonly trainingPreviewCards: readonly TrainingSummaryCard[] = [
    {
      id: 'state',
      label: 'State',
      valueText: 'Balanced',
      captionText: 'TSS-only load model',
      kind: 'state',
    },
    {
      id: 'readiness',
      label: 'Readiness today',
      valueText: '78',
      qualifierText: 'Ready',
      captionText: 'Load + recorded sleep signals',
      indicator: {
        label: 'Readiness',
        value: 78,
        tone: 'ready',
        showThresholds: true,
      },
    },
    {
      id: 'training-time',
      label: 'Training time',
      valueText: '18h 42m',
      captionText: '+12% versus usual 28 days',
      indicator: {
        label: 'Training time versus usual',
        value: 12,
        variant: 'deviation',
        compact: true,
      },
    },
    {
      id: 'workouts',
      label: 'Workouts',
      valueText: '14',
      captionText: '2 more than usual',
      indicator: {
        label: 'Workouts versus usual',
        value: 17,
        variant: 'deviation',
        compact: true,
      },
    },
  ];

  public readonly trainingPreviewLoadMetrics: readonly TrainingSummaryMetric[] = [
    { id: 'fitness', label: 'Fitness (CTL)', valueText: '62', detailText: '42-day load' },
    { id: 'fatigue', label: 'Fatigue (ATL)', valueText: '54', detailText: '7-day load' },
    { id: 'form-now', label: 'Form now', valueText: '+8', detailText: 'Fitness − fatigue' },
    { id: 'ramp', label: 'Ramp', valueText: '+1.4', detailText: '7-day fitness change' },
    { id: 'acwr', label: 'ACWR', valueText: '1.03', detailText: 'Acute ÷ chronic load' },
    { id: 'monotony', label: 'Monotony', valueText: '1.42', detailText: 'Weekly load variability' },
    { id: 'strain', label: 'Strain', valueText: '684', detailText: 'Load × monotony' },
    { id: 'form-plus-seven', label: 'Form +7 days', valueText: '+15', detailText: 'No-additional-load scenario' },
  ];

  public readonly trainingPreviewContextMetrics: readonly TrainingSummaryMetric[] = [
    { id: 'recovery-debt', label: 'Recovery debt', valueText: '2 days', detailText: 'Estimated to neutral Form' },
    { id: 'recovery-left', label: 'Recovery left', valueText: '8h 20m', detailText: 'Imported estimate' },
    { id: 'intensity-balance', label: 'Intensity balance', valueText: '72% easy · 14% hard', detailText: 'Latest eligible week' },
    { id: 'efficiency', label: 'Efficiency', valueText: '+3.2%', detailText: 'Versus previous 4 weeks' },
  ];

  private observer: IntersectionObserver | undefined;
  public readonly assistantPromptExamples: readonly string[] = ASSISTANT_STARTER_PROMPTS;
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  constructor(
    public authService: AppAuthService,
    public router: Router,
    private elementRef: ElementRef
  ) { }

  ngOnInit() {
    if (!this.isBrowser) {
      return;
    }

    this.authService.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(user => {
        if (user) {
          void this.router.navigate(['/dashboard']);
        }
      });
  }

  ngAfterViewInit() {
    if (!this.isBrowser) {
      return;
    }

    const elements = this.elementRef.nativeElement.querySelectorAll('.animate-on-scroll');
    if (typeof IntersectionObserver === 'undefined') {
      elements.forEach((el: Element) => el.classList.add('is-visible'));
      return;
    }

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add('is-visible');
        this.observer?.unobserve(entry.target);
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    });

    elements.forEach((el: Element) => this.observer?.observe(el));
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

  async navigateToDashboardOrLogin() {
    const user = await this.authService.getUser();
    if (user) {
      await this.router.navigate(['/dashboard']);
    } else {
      await this.router.navigate(['/login']);
    }
  }

}
