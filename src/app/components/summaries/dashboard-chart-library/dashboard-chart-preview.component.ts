import { Component, LOCALE_ID, Input, OnChanges, OnDestroy, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { TileSettingsInterface, TileTypes } from '@sports-alliance/sports-lib';
import { AppUserInterface } from '../../../models/app-user.interface';
import { DashboardChartPreviewService } from '../../../services/dashboard-chart-preview.service';
import { DashboardPreviewInput, DashboardChartPreview, buildDashboardThumbnailPreview } from '../../../helpers/dashboard-chart-preview.helper';
import { DashboardChartTileViewModel, DashboardMapTileViewModel } from '../../../helpers/dashboard-tile-view-model.helper';
import { buildActivityCalendarViewModel } from '../../../helpers/activity-calendar.helper';
import { DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE, isDashboardKpiChartType } from '../../../helpers/dashboard-special-chart-types';
@Component({ selector: 'app-dashboard-chart-preview', standalone: false, templateUrl: './dashboard-chart-preview.component.html', styleUrls: ['./dashboard-chart-preview.component.css'] })
export class DashboardChartPreviewComponent implements OnChanges, OnDestroy {
  private readonly locale = inject(LOCALE_ID);
  private readonly data = inject(DashboardChartPreviewService);
  @Input({ required: true }) user: AppUserInterface;
  @Input({ required: true }) tile: TileSettingsInterface;
  @Input() seed: DashboardPreviewInput = { tiles: [] };
  @Input() thumbnail = false;
  @Input() darkTheme = false;
  readonly preview = signal<DashboardChartPreview | null>(null);
  readonly chart = computed(() => this.preview()?.tile.type === TileTypes.Chart ? this.preview()!.tile as DashboardChartTileViewModel : null);
  readonly isKpi = computed(() => isDashboardKpiChartType(this.chart()?.chartType));
  readonly mapTile = computed(() => this.preview()?.tile.type === TileTypes.Map ? this.preview()!.tile as DashboardMapTileViewModel : null);
  readonly calendar = computed(() => `${this.chart()?.chartType}` === DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE
    ? buildActivityCalendarViewModel(this.preview()!.calendarEvents, { view: 'month', anchorDate: new Date(this.preview()!.anchorMs), now: new Date(this.preview()!.anchorMs), startOfWeek: this.user?.settings?.unitSettings?.startOfTheWeek, locale: this.locale }) : null);
  private subscription = new Subscription();
  ngOnChanges(): void {
    this.subscription.unsubscribe();
    if (!this.tile || !this.user) return;
    if (this.thumbnail) {
      this.preview.set(buildDashboardThumbnailPreview(this.tile, this.seed));
      return;
    }
    this.subscription = this.data.watch(this.user, this.tile, this.seed).subscribe(preview => this.preview.set(preview));
  }
  ngOnDestroy(): void { this.subscription.unsubscribe(); }
}
