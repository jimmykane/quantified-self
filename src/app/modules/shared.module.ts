import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ShadeComponent} from '../components/loading/shade.component';
import {MaterialModule} from './material.module';
import {AppAuthService} from '../authentication/app.auth.service';
import {AppAuthGuard} from '../authentication/app.auth.guard';
import {MapSettingsLocalStorageService} from '../services/storage/app.map.settings.local.storage.service';
import {ChartSettingsLocalStorageService} from '../services/storage/app.chart.settings.local.storage.service';
import {UserSettingsService} from '../services/app.user.settings.service';
import {EventService} from '../services/app.event.service';
import {ActionButtonService} from '../services/action-buttons/app.action-button.service';
import {EventColorService} from '../services/color/app.event.color.service';
import {ClipboardService} from '../services/app.clipboard.service';
import {SharingService} from '../services/app.sharing.service';
import {FileService} from '../services/app.file.service';
import {UserService} from '../services/app.user.service';
import {SideNavService} from '../services/side-nav/side-nav.service';
import {ThemeService} from '../services/app.theme.service';
import {AppInfoService} from '../services/app.info.service';
import {WindowService} from '../services/app.window.service';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import {PrivacyIconComponent} from '../components/privacy-icon/privacy-icon.component';
import {EventActionsComponent} from '../components/event-actions/event.actions.component';
import {ChartAbstract} from '../components/charts/chart.abstract';
import {ChartsTimelineComponent} from '../components/charts/timeline/charts.timeline.component';
import {ChartsPieComponent} from '../components/charts/pie/charts.pie.component';
import {ChartsXYComponent} from '../components/charts/xy/charts.xy.component';
import {EventCardChartComponent} from '../components/cards/event/chart/event.card.chart.component';
import {EventFormComponent} from '../components/event-form/event.form.component';
import {ActivityFormComponent} from '../components/activity-form/activity.form.component';
import {DeleteConfirmationComponent} from '../components/delete-confirmation/delete-confirmation.component';


@NgModule({
  imports: [
    CommonModule,
    MaterialModule,
    ReactiveFormsModule,
    FormsModule
  ],

  declarations: [
    ShadeComponent,
    PrivacyIconComponent,
    EventActionsComponent,
    ChartsTimelineComponent,
    ChartsPieComponent,
    ChartsXYComponent,
    EventCardChartComponent,
    EventFormComponent,
    ActivityFormComponent,
    DeleteConfirmationComponent,
  ],
  providers: [],
  entryComponents: [
    EventFormComponent,
    ActivityFormComponent,
    DeleteConfirmationComponent,
  ],
  exports: [
    ShadeComponent,
    PrivacyIconComponent,
    EventActionsComponent,
    ChartsTimelineComponent,
    ChartsPieComponent,
    ChartsXYComponent,
    EventCardChartComponent,
    EventFormComponent,
    ActivityFormComponent,
    DeleteConfirmationComponent,
    ReactiveFormsModule,
    FormsModule]

})
export class SharedModule {
}
