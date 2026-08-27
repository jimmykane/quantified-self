import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Input,
  OnChanges,
  SimpleChanges,
  signal,
} from '@angular/core';
import {
  ActivityInterface,
  ActivityTypeGroups,
  ChartCursorBehaviours,
  UserUnitSettingsInterface,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { AppActivityTypeGroupGradients } from '../../../services/color/app.activity-type-group.gradients';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import {
  buildEventDiveProfile,
  EventDiveProfileModel,
} from '../../../helpers/event-dive-profile.helper';
import type { EventChartOverlayOption } from '../../../helpers/event-chart-overlay.helper';
import type { EventChartPanelModel } from '../../../helpers/event-echarts-data.helper';
import type { EventChartRange } from '../../../helpers/event-echarts-xaxis.helper';
import { AppUserUtilities } from '../../../utils/app.user.utilities';

const DIVE_PROFILE_COLORS = AppActivityTypeGroupGradients[ActivityTypeGroups.DivingGroup];

@Component({
  selector: 'app-event-dive-profile',
  templateUrl: './event.dive-profile.component.html',
  styleUrls: ['./event.dive-profile.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class EventDiveProfileComponent implements OnChanges {
  @Input() activities: ActivityInterface[] = [];
  @Input() unitSettings!: UserUnitSettingsInterface;
  @Input() darkTheme = false;
  @Input() useAnimations = false;

  public readonly xAxisType = XAxisTypes.Duration;
  public readonly model = signal<EventDiveProfileModel | null>(null);
  public readonly selectedOverlayDataType = signal<string | null>(null);
  public readonly overlayPanels = computed(() => this.getOverlayPanels(this.model()));
  public readonly overlayOptions = computed<EventChartOverlayOption[]>(() => this.overlayPanels().map((panel) => ({
    dataType: panel.dataType,
    label: panel.displayName,
    unit: panel.unit,
    color: panel.series[0]?.color || 'var(--mat-sys-primary)',
  })));
  public readonly selectedOverlayPanel = computed<EventChartPanelModel | null>(() => {
    const selectedDataType = this.selectedOverlayDataType();
    return this.overlayPanels().find((panel) => panel.dataType === selectedDataType) || null;
  });
  public readonly xDomain = computed<EventChartRange | null>(() => {
    const depthPanel = this.model()?.depthPanel;
    if (!depthPanel || !Number.isFinite(depthPanel.minX) || !Number.isFinite(depthPanel.maxX)) {
      return null;
    }
    return { start: depthPanel.minX, end: depthPanel.maxX };
  });
  public readonly showActivityNames = computed(() => (this.model()?.activities.length || 0) > 1);
  public readonly strokeWidth = computed(() => {
    const value = Number(this.userSettingsQuery.chartSettings()?.strokeWidth);
    return Number.isFinite(value) && value > 0 ? value : AppUserUtilities.getDefaultChartStrokeWidth();
  });
  public readonly fillOpacity = 1;
  public readonly areaFillOrigin = 'start';
  public readonly lightThemeAreaFillColor = DIVE_PROFILE_COLORS.end;
  public readonly darkThemeAreaFillColor = DIVE_PROFILE_COLORS.start;
  public readonly cursorBehaviour = computed<ChartCursorBehaviours>(() => (
    this.userSettingsQuery.chartSettings()?.chartCursorBehaviour
      ?? AppUserUtilities.getDefaultChartCursorBehaviour()
  ));

  private readonly eventColorService = inject(AppEventColorService);
  private readonly userSettingsQuery = inject(AppUserSettingsQueryService);

  public ngOnChanges(changes: SimpleChanges): void {
    if (!changes.activities && !changes.unitSettings) {
      return;
    }
    this.rebuildProfile();
  }

  public onOverlayDataTypeChange(dataType: string | null): void {
    this.selectedOverlayDataType.set(
      this.overlayPanels().some((panel) => panel.dataType === dataType) ? dataType : null,
    );
  }

  private rebuildProfile(): void {
    if (!this.unitSettings) {
      this.model.set(null);
      this.selectedOverlayDataType.set(null);
      return;
    }

    const model = buildEventDiveProfile({
      activities: this.activities,
      userUnitSettings: this.unitSettings,
      eventColorService: this.eventColorService,
    });
    this.model.set(model);

    const selectedDataType = this.selectedOverlayDataType();
    if (selectedDataType && !this.getOverlayPanels(model).some((panel) => panel.dataType === selectedDataType)) {
      this.selectedOverlayDataType.set(null);
    }
  }

  private getOverlayPanels(model: EventDiveProfileModel | null): EventChartPanelModel[] {
    if (!model) {
      return [];
    }
    return model.overlayPanels;
  }
}
