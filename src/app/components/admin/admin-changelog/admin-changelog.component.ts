
import { Component, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { TextFieldModule } from '@angular/cdk/text-field';
import { RouterModule } from '@angular/router';
import { AppWhatsNewService, ChangelogPost } from '../../../services/app.whats-new.service';
import { Timestamp } from '@angular/fire/firestore';
import { LoggerService } from '../../../services/logger.service';
import { WhatsNewItemComponent } from '../../whats-new/whats-new-item.component';

@Component({
    selector: 'app-admin-changelog',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        RouterModule,
        MatButtonModule,
        MatCardModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        MatDatepickerModule,
        MatNativeDateModule,
        MatIconModule,
        MatCheckboxModule,
        MatTooltipModule,
        MatTableModule,
        MatTabsModule,
        TextFieldModule,
        WhatsNewItemComponent
    ],
    templateUrl: './admin-changelog.component.html',
    styleUrls: ['./admin-changelog.component.scss']
})
export class AdminChangelogComponent implements OnDestroy {
    private whatsNewService = inject(AppWhatsNewService);
    private fb = inject(FormBuilder);
    private logger = inject(LoggerService);

    changelogs = this.whatsNewService.changelogs;

    editingPost: ChangelogPost | null = null;
    isNew = false;
    saving = false;

    form: FormGroup = this.fb.group({
        title: ['', Validators.required],
        description: ['', Validators.required],
        date: [new Date(), Validators.required],
        type: ['minor', Validators.required],
        version: [''],
        published: [false] // Default to draft
    });

    get previewPost(): ChangelogPost {
        const values = this.form.getRawValue();
        return {
            id: 'preview',
            title: values.title || 'Release Title',
            description: values.description || '',
            date: values.date ? Timestamp.fromDate(values.date) : Timestamp.now(),
            type: values.type || 'minor',
            version: values.version || '',
            published: values.published ?? false,
            // Keep image if editing and it exists, though currently not in form
            image: this.editingPost?.image
        } as ChangelogPost;
    }

    constructor() {
        this.whatsNewService.setAdminMode(true);
    }

    // Helper for template to handle Timestamp | Date
    postDate(post: ChangelogPost): Date {
        if (post.date instanceof Timestamp) {
            return post.date.toDate();
        }
        return post.date as unknown as Date;
    }

    ngOnDestroy() {
        this.whatsNewService.setAdminMode(false);
    }

    createNew() {
        this.isNew = true;
        this.editingPost = null;
        this.form.reset({
            title: '',
            description: '',
            date: new Date(),
            type: 'minor',
            version: '',
            published: false
        });
    }

    edit(post: ChangelogPost) {
        this.isNew = false;
        this.editingPost = post;

        // Convert Timestamp to Date for the form
        this.form.patchValue({
            title: post.title,
            description: post.description,
            date: this.postDate(post),
            type: post.type,
            version: post.version || '',
            published: post.published
        });
    }

    cancel() {
        this.editingPost = null;
        this.isNew = false;
    }

    async save() {
        if (this.form.invalid) return;

        this.saving = true;
        try {
            const formData = this.form.value;

            const payload: Partial<ChangelogPost> = {
                title: formData.title,
                description: formData.description,
                date: formData.date, // Service should handle Timestamp conversion if needed, but Firestore SDK usually handles Date objects fine
                type: formData.type,
                version: formData.version || null,
                published: formData.published
            };

            if (this.isNew) {
                await this.whatsNewService.createChangelog(payload as ChangelogPost);
            } else if (this.editingPost) {
                await this.whatsNewService.updateChangelog(this.editingPost.id, payload);
            }

            this.cancel();
        } catch (error) {
            this.logger.error('Error saving changelog', error);
            // Ideally show snackbar here
        } finally {
            this.saving = false;
        }
    }

    async delete(post: ChangelogPost) {
        if (!confirm(`Are you sure you want to delete "${post.title}"?`)) return;

        try {
            await this.whatsNewService.deleteChangelog(post.id);
        } catch (error) {
            this.logger.error('Error deleting changelog', error);
        }
    }
}
