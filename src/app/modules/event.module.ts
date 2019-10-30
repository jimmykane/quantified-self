import { NgModule } from '@angular/core';
import {ServicesComponent} from '../components/services/services.component';
import {ServicesRoutingModule} from '../services-routing.module';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import {UserRoutingModule} from '../user-routing.module';
import {UserComponent} from '../components/user/user.component';
import {UserActionsComponent} from '../components/user-actions/user.actions.component';
import {UserSettingsComponent} from '../components/user-settings/user-settings.component';
import {UserFormComponent} from '../components/user-forms/user.form.component';
import {EventRoutingModule} from '../event-routing.module';
import {EventCardComponent} from '../components/cards/event/event.card.component';
import {EventCardMapComponent} from '../components/cards/event/map/event.card.map.component';
import {EventCardStatsComponent} from '../components/cards/event/stats/event.card.stats.component';
import {EventCardLapsComponent} from '../components/cards/event/laps/event.card.laps.component';
import {EventCardToolsComponent} from '../components/cards/event/tools/event.card.tools.component';
import {ActivityIconComponent} from '../components/activity-icon/activity-icon.component';
import {ActivitiesCheckboxesComponent} from '../components/acitvities-checkboxes/activities-checkboxes.component';
import {ActivityActionsComponent} from '../components/activity-actions/activity.actions.component';
import {MapActionsComponent} from '../components/map-actions/map.actions.component';
import {EventCardChartComponent} from '../components/cards/event/chart/event.card.chart.component';
import {EventCardChartActionsComponent} from '../components/cards/event/chart/actions/event.card.chart.actions.component';
import {EventCardDevicesComponent} from '../components/cards/event/devices/event.card.devices.component';
import {ActivityHeaderComponent} from '../components/activity-header/activity-header.component';
import {AgmCoreModule} from '@agm/core';


@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    EventRoutingModule,
    AgmCoreModule.forRoot({
      apiKey: 'AIzaSyBdR4jbTKmm_P4L7t26IFAgFn6Eoo02aU0',
      apiVersion: 'weekly'
    }),
  ],
  exports: [
  ],
  declarations: [
    EventCardComponent,
    EventCardMapComponent,
    EventCardStatsComponent,
    EventCardLapsComponent,
    EventCardToolsComponent,
    EventCardChartComponent,
    EventCardChartActionsComponent,
    EventCardDevicesComponent,
    ActivityIconComponent,
    ActivitiesCheckboxesComponent,
    ActivityActionsComponent,
    ActivityHeaderComponent,
    MapActionsComponent,

  ],
  entryComponents: [
  ],
  providers: [
  ]
})



export class EventModule { }