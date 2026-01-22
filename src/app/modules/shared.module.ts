import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ShadeComponent } from '../components/loading/shade.component';
import { AppSkeletonComponent } from '../components/loading/skeleton/app.skeleton.component';
import { MaterialModule } from './material.module';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { PrivacyIconComponent } from '../components/privacy-icon/privacy-icon.component';
import { EventActionsComponent } from '../components/event-actions/event.actions.component';
import { EventFormComponent } from '../components/event-form/event.form.component';
import { ActivityFormComponent } from '../components/activity-form/activity.form.component';
import { DeleteConfirmationComponent } from '../components/delete-confirmation/delete-confirmation.component';
import { DataTypeIconComponent } from '../components/data-type-icon/data-type-icon.component';

import { RouterModule } from '@angular/router';

import { EventSearchComponent } from '../components/event-search/event-search.component';
import { ActivityTypesMultiSelectComponent } from '../components/activity-types-multi-select/activity-types-multi-select.component';
import { ActivityTypeIconComponent } from '../components/activity-type-icon/activity-type-icon.component';

import { ServiceSyncingStateComponent } from '../components/shared/service-syncing-state/service-syncing-state.component';
import { ServiceSourceIconComponent } from '../components/event-summary/service-source-icon/service-source-icon.component';
import { StatusInfoComponent } from '../components/shared/status-info/status-info.component';

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
        EventFormComponent,
        ActivityFormComponent,
        DeleteConfirmationComponent,
        DataTypeIconComponent,
        EventSearchComponent,
        ActivityTypesMultiSelectComponent,
        ActivityTypeIconComponent,
        AppSkeletonComponent,
        ServiceSyncingStateComponent,
        ServiceSourceIconComponent,
        StatusInfoComponent,
    ],
    providers: [],
    exports: [
        CommonModule,
        MaterialModule,
        RouterModule,
        ShadeComponent,
        AppSkeletonComponent,
        PrivacyIconComponent,
        EventActionsComponent,
        EventFormComponent,
        ActivityFormComponent,
        DeleteConfirmationComponent,
        DataTypeIconComponent,
        ReactiveFormsModule,
        FormsModule,
        EventSearchComponent,
        ActivityTypesMultiSelectComponent,
        ActivityTypeIconComponent,
        ServiceSyncingStateComponent,
        ServiceSourceIconComponent,
        StatusInfoComponent,
    ]
})


export class SharedModule {
}
