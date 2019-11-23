import {NgModule} from '@angular/core';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import {EventRoutingModule} from '../event-routing.module';
import {EventCardComponent} from '../components/cards/event/event.card.component';
import {EventCardMapComponent} from '../components/cards/event/map/event.card.map.component';
import {EventCardStatsComponent} from '../components/cards/event/stats/event.card.stats.component';
import {EventCardLapsComponent} from '../components/cards/event/laps/event.card.laps.component';
import {EventCardToolsComponent} from '../components/cards/event/tools/event.card.tools.component';
import {ActivityIconComponent} from '../components/activity-icon/activity-icon.component';
import {ActivitiesToggleGroupComponent} from '../components/activities-toggle-group/activities-toggle-group.component';
import {ActivityActionsComponent} from '../components/activity-actions/activity.actions.component';
import {MapActionsComponent} from '../components/map-actions/map.actions.component';
import {EventCardChartActionsComponent} from '../components/cards/event/chart/actions/event.card.chart.actions.component';
import {EventCardDevicesComponent} from '../components/cards/event/devices/event.card.devices.component';
import {ActivityHeaderComponent} from '../components/activity-header/activity-header.component';
import {AgmCoreModule} from '@agm/core';
import {EventHeaderComponent} from '../components/event-header/event-header.component';
import {HeaderStatsComponent} from '../components/header-stats/header-stats.component';


@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    EventRoutingModule,
    AgmCoreModule
  ],
  exports: [],
  declarations: [
    EventCardComponent,
    EventCardMapComponent,
    EventCardStatsComponent,
    EventCardLapsComponent,
    EventCardToolsComponent,
    EventCardChartActionsComponent,
    EventCardDevicesComponent,
    EventHeaderComponent,
    HeaderStatsComponent,
    ActivityIconComponent,
    ActivitiesToggleGroupComponent,
    ActivityActionsComponent,
    ActivityHeaderComponent,
    MapActionsComponent,
  ],
  entryComponents: [],
})


export class EventModule {
}
