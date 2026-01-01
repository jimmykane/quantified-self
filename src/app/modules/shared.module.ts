import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ShadeComponent } from '../components/loading/shade.component';
import { MaterialModule } from './material.module';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { PrivacyIconComponent } from '../components/privacy-icon/privacy-icon.component';
import { EventActionsComponent } from '../components/event-actions/event.actions.component';
import { EventFormComponent } from '../components/event-form/event.form.component';
import { ActivityFormComponent } from '../components/activity-form/activity.form.component';
import { DeleteConfirmationComponent } from '../components/delete-confirmation/delete-confirmation.component';
import { DataTypeIconComponent } from '../components/data-type-icon/data-type-icon.component';
import { UploadErrorComponent } from '../components/upload/upload-error/upload-error.component';
import { UploadInfoComponent } from '../components/upload/upload-info/upload-info.component';
import { FilesStatusListComponent } from '../components/files-status-list/files-status-list.component';
import { PromoDialogComponent } from '../components/promo-dialog/promo-dialog.component';
import { EventSearchComponent } from '../components/event-search/event-search.component';
import { ActivityTypesMultiSelectComponent } from '../components/activity-types-multi-select/activity-types-multi-select.component';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';
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
        EventFormComponent,
        PromoDialogComponent,
        ActivityFormComponent,
        DeleteConfirmationComponent,
        DataTypeIconComponent,
        UploadInfoComponent,
        UploadErrorComponent,
        FilesStatusListComponent,
        EventSearchComponent,
        ActivityTypesMultiSelectComponent,
    ],
    providers: [],
    exports: [
        ShadeComponent,
        PrivacyIconComponent,
        EventActionsComponent,
        EventFormComponent,
        ActivityFormComponent,
        ActivityFormComponent,
        DeleteConfirmationComponent,
        DataTypeIconComponent,
        ReactiveFormsModule,
        FormsModule,
        UploadInfoComponent,
        UploadErrorComponent,
        FilesStatusListComponent,
        PromoDialogComponent,
        EventSearchComponent,
        ActivityTypesMultiSelectComponent,
    ]
})

export class SharedModule {
}
