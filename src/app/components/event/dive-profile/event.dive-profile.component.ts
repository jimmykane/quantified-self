import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  signal,
  ViewChild,
} from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Subscription } from 'rxjs';
import type { EChartsType } from 'echarts/core';
import { ActivityInterface, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { AppBreakpoints } from '../../../constants/breakpoints';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import {
  buildEventDiveProfile,
  buildEventDiveProfileChartOption,
  EventDiveProfileModel,
} from '../../../helpers/event-dive-profile.helper';
import {
  ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../../helpers/echarts-host-controller';
import { resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];

@Component({
  selector: 'app-event-dive-profile',
  templateUrl: './event.dive-profile.component.html',
  styleUrls: ['./event.dive-profile.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class EventDiveProfileComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() activities: ActivityInterface[] = [];
  @Input() unitSettings!: UserUnitSettingsInterface;
  @Input() darkTheme = false;
  @Input() useAnimations = false;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  public readonly model = signal<EventDiveProfileModel | null>(null);
  public readonly showTemperature = signal(false);
  public readonly showHeartRate = signal(false);
  public readonly hasTemperature = computed(() => !!this.model()?.temperaturePanel);
  public readonly hasHeartRate = computed(() => !!this.model()?.heartRatePanel);

  private readonly chartHost: EChartsHostController;
  private readonly breakpointSubscription: Subscription;
  private isMobile = false;

  constructor(
    breakpointObserver: BreakpointObserver,
    eChartsLoader: EChartsLoaderService,
    private eventColorService: AppEventColorService,
    logger: LoggerService,
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader,
      logger,
      logPrefix: '[EventDiveProfileComponent]',
      initOptions: { useDirtyRect: true },
    });
    this.breakpointSubscription = breakpointObserver
      .observe([AppBreakpoints.XSmall])
      .subscribe((result) => {
        const changed = this.isMobile !== result.matches;
        this.isMobile = result.matches;
        if (changed && this.chartDiv?.nativeElement) {
          void this.refreshChart();
        }
      });
  }

  public async ngAfterViewInit(): Promise<void> {
    await this.refreshChart();
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartDiv?.nativeElement) {
      return;
    }
    if (changes.activities || changes.unitSettings || changes.darkTheme || changes.useAnimations) {
      void this.refreshChart();
    }
  }

  public ngOnDestroy(): void {
    this.breakpointSubscription.unsubscribe();
    this.chartHost.dispose();
  }

  public setShowTemperature(value: boolean): void {
    this.showTemperature.set(value);
    this.renderChart();
  }

  public setShowHeartRate(value: boolean): void {
    this.showHeartRate.set(value);
    this.renderChart();
  }

  private async refreshChart(): Promise<void> {
    const chart = await this.chartHost.init(
      this.chartDiv?.nativeElement,
      resolveEChartsThemeName(this.darkTheme),
    );
    if (!chart || !this.unitSettings) {
      return;
    }
    this.model.set(buildEventDiveProfile({
      activities: this.activities,
      userUnitSettings: this.unitSettings,
      eventColorService: this.eventColorService,
    }));
    if (!this.hasTemperature()) {
      this.showTemperature.set(false);
    }
    if (!this.hasHeartRate()) {
      this.showHeartRate.set(false);
    }
    this.renderChart();
  }

  private renderChart(): void {
    const model = this.model();
    if (!model) {
      this.chartHost.setOption({ xAxis: [], yAxis: [], series: [] }, ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS);
      return;
    }
    const option = buildEventDiveProfileChartOption({
      model,
      showTemperature: this.showTemperature(),
      showHeartRate: this.showHeartRate(),
      darkTheme: this.darkTheme,
      isMobile: this.isMobile,
      useAnimations: this.useAnimations,
    }) as ChartOption;
    this.chartHost.setOption(option, ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }
}
