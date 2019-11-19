import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ShadeComponent} from '../components/loading/shade.component';
import {MaterialModule} from './material.module';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import {PrivacyIconComponent} from '../components/privacy-icon/privacy-icon.component';
import {EventActionsComponent} from '../components/event-actions/event.actions.component';
import {ChartsTimelineComponent} from '../components/charts/timeline/charts.timeline.component';
import {ChartsPieComponent} from '../components/charts/pie/charts.pie.component';
import {ChartsXYComponent} from '../components/charts/xy/charts.xy.component';
import {EventCardChartComponent} from '../components/cards/event/chart/event.card.chart.component';
import {EventFormComponent} from '../components/event-form/event.form.component';
import {ActivityFormComponent} from '../components/activity-form/activity.form.component';
import {DeleteConfirmationComponent} from '../components/delete-confirmation/delete-confirmation.component';
import {EditInputComponent} from '../components/edit-input/edit-input.component';
import {DataTypeIconComponent} from '../components/data-type-icon/data-type-icon.component';


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
    EditInputComponent,
    DataTypeIconComponent,
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
    EditInputComponent,
    DataTypeIconComponent,
    ReactiveFormsModule,
    FormsModule
  ]
})
export class SharedModule {
}
