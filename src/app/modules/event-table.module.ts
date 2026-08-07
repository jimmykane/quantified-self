import { NgModule } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { EventTableActionsComponent } from '../components/event-table/actions/event.table.actions.component';
import { EventTableComponent, MatPaginatorIntlFireStore } from '../components/event-table/event.table.component';
import { MergeOptionsDialogComponent } from '../components/event-table/merge-options-dialog/merge-options-dialog.component';
import { EventsExportFormComponent } from '../components/events-export-form/events-export.form.component';
import { SharedModule } from './shared.module';

@NgModule({
  imports: [SharedModule],
  declarations: [
    EventTableComponent,
    EventTableActionsComponent,
    MergeOptionsDialogComponent,
    EventsExportFormComponent,
  ],
  exports: [EventTableComponent],
  providers: [
    { provide: MatPaginatorIntl, useClass: MatPaginatorIntlFireStore },
  ],
})
export class EventTableModule {}
