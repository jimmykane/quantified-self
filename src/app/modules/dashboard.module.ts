import { DashboardActionPromptsComponent } from '../components/dashboard/dashboard-action-prompts/dashboard-action-prompts.component';
import { UploadActivitiesComponent } from '../components/upload/upload-activities/upload-activities.component';
import { EventTableModule } from './event-table.module';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from './shared.module';
import { MaterialModule } from './material.module';
import { DashboardLibraryModule } from './dashboard-library.module';
import { DashboardRoutingModule } from '../dashboard.routing.module';
import { DashboardComponent } from '../components/dashboard/dashboard.component';
@NgModule({
  imports: [
    CommonModule, SharedModule, MaterialModule, DashboardLibraryModule,
    DashboardRoutingModule, UploadActivitiesComponent, EventTableModule,
  ],
  declarations: [DashboardComponent, DashboardActionPromptsComponent],
})
export class DashboardModule {}
