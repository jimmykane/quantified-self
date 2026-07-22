import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ShadeComponent } from '../components/loading/shade.component';
import { AppSkeletonComponent } from '../components/loading/skeleton/app.skeleton.component';
import { AppLoadingOverlayComponent } from '../components/loading/loading-overlay/loading-overlay.component';
import { MaterialModule } from './material.module';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { PrivacyIconComponent } from '../components/privacy-icon/privacy-icon.component';
import { EventActionsComponent } from '../components/event-actions/event.actions.component';
import { ConfirmationDialogComponent } from '../components/confirmation-dialog/confirmation-dialog.component';
import { DataTypeIconComponent } from '../components/data-type-icon/data-type-icon.component';

import { RouterModule } from '@angular/router';

import { EventSearchComponent } from '../components/event-search/event-search.component';
import { ActivityTypesFilterMenuComponent } from '../components/activity-types-filter-menu/activity-types-filter-menu.component';
import { ActivityTypesMultiSelectComponent } from '../components/activity-types-multi-select/activity-types-multi-select.component';
import { ActivityTypeIconComponent } from '../components/activity-type-icon/activity-type-icon.component';

import { ServiceSyncingStateComponent } from '../components/shared/service-syncing-state/service-syncing-state.component';
import { ServiceSourceIconComponent } from '../components/event-summary/service-source-icon/service-source-icon.component';
import { StatusInfoComponent } from '../components/shared/status-info/status-info.component';
import { BottomSheetHeaderComponent } from '../components/shared/bottom-sheet-header/bottom-sheet-header.component';
import { PeekPanelComponent } from '../components/shared/peek-panel/peek-panel.component';
import { MaterialPillTabsComponent } from '../components/shared/material-pill-tabs/material-pill-tabs.component';
import { MaterialPillTabDirective } from '../components/shared/material-pill-tabs/material-pill-tab.directive';
import { EventSectionHeaderComponent } from '../components/event/section-header/event.section-header.component';
import { SummaryPrimaryInfoComponent } from '../components/shared/summary-primary-info/summary-primary-info.component';
import { HeroMetricsComponent } from '../components/shared/hero-metrics/hero-metrics.component';
import { MapActivityPopupComponent } from '../components/shared/map-activity-popup/map-activity-popup.component';
import { MapLayersActionsComponent } from '../components/map/map-layers-actions/map-layers-actions.component';
import { MyTracksMapLayersControlComponent } from '../components/map/my-tracks-map-layers-control/my-tracks-map-layers-control.component';
import { MapLayersMenuPanelComponent } from '../components/map/shared/map-layers-menu-panel.component';
import { EventIntensityZonesComponent } from '../components/event/intensity-zones/event.intensity-zones.component';
import { MenuRadioListComponent } from '../components/shared/menu-radio-list/menu-radio-list.component';
import { TypedPromptRotatorComponent } from '../components/shared/typed-prompt-rotator/typed-prompt-rotator.component';
import { HapticTapDirective } from '../directives/haptic-tap.directive';
import { TooltipTapDirective } from '../directives/tooltip-tap.directive';
import { UploadActivitiesComponent } from '../components/upload/upload-activities/upload-activities.component';
import { EventCardChartPanelComponent } from '../components/event/chart/panel/event.card.chart.panel.component';
import { DashboardActionPromptComponent } from '../components/dashboard/dashboard-action-prompt/dashboard-action-prompt.component';
import { WorkspaceSectionNavigationComponent } from '../components/shared/workspace-section-navigation/workspace-section-navigation.component';
import { DurabilityReadingGuideComponent } from '../components/shared/durability-reading-guide/durability-reading-guide.component';

@NgModule({
    imports: [
        CommonModule,
        MaterialModule,
        RouterModule,
        ReactiveFormsModule,
        FormsModule
    ],
    declarations: [
        ShadeComponent,
        PrivacyIconComponent,
        EventActionsComponent,
        ConfirmationDialogComponent,
        DataTypeIconComponent,
        EventSearchComponent,
        ActivityTypesFilterMenuComponent,
        ActivityTypesMultiSelectComponent,
        ActivityTypeIconComponent,
        AppSkeletonComponent,
        AppLoadingOverlayComponent,
        ServiceSyncingStateComponent,
        ServiceSourceIconComponent,
        StatusInfoComponent,
        BottomSheetHeaderComponent,
        PeekPanelComponent,
        MaterialPillTabsComponent,
        MaterialPillTabDirective,
        EventSectionHeaderComponent,
        SummaryPrimaryInfoComponent,
        HeroMetricsComponent,
        MapActivityPopupComponent,
        MapLayersActionsComponent,
        MyTracksMapLayersControlComponent,
        MapLayersMenuPanelComponent,
        EventIntensityZonesComponent,
        MenuRadioListComponent,
        TypedPromptRotatorComponent,
        HapticTapDirective,
        TooltipTapDirective,
        UploadActivitiesComponent,
        EventCardChartPanelComponent,
        DashboardActionPromptComponent,
        WorkspaceSectionNavigationComponent,
        DurabilityReadingGuideComponent,
    ],
    providers: [],
    exports: [
        CommonModule,
        MaterialModule,
        RouterModule,
        ShadeComponent,
        AppSkeletonComponent,
        AppLoadingOverlayComponent,
        PrivacyIconComponent,
        EventActionsComponent,
        ConfirmationDialogComponent,
        DataTypeIconComponent,
        ReactiveFormsModule,
        FormsModule,
        EventSearchComponent,
        ActivityTypesFilterMenuComponent,
        ActivityTypesMultiSelectComponent,
        ActivityTypeIconComponent,
        ServiceSyncingStateComponent,
        ServiceSourceIconComponent,
        StatusInfoComponent,
        BottomSheetHeaderComponent,
        PeekPanelComponent,
        MaterialPillTabsComponent,
        MaterialPillTabDirective,
        EventSectionHeaderComponent,
        SummaryPrimaryInfoComponent,
        HeroMetricsComponent,
        MapActivityPopupComponent,
        MapLayersActionsComponent,
        EventIntensityZonesComponent,
        MenuRadioListComponent,
        TypedPromptRotatorComponent,
        HapticTapDirective,
        TooltipTapDirective,
        UploadActivitiesComponent,
        EventCardChartPanelComponent,
        DashboardActionPromptComponent,
        WorkspaceSectionNavigationComponent,
        DurabilityReadingGuideComponent,
    ]
})


export class SharedModule {
}
