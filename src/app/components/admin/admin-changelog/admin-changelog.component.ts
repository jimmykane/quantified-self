
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
import { Timestamp } from 'app/firebase/firestore';
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
        const previewDate = this.coerceDate(values.date);
        return {
            id: 'preview',
            title: values.title || 'Release Title',
            description: values.description || '',
            date: previewDate ? Timestamp.fromDate(previewDate) : Timestamp.now(),
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
        const normalizedDate = this.coerceDate(post.date);
        return normalizedDate ?? new Date();
    }

    private coerceDate(value: unknown): Date | null {
        if (!value) return null;

        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }

        if (value instanceof Timestamp) {
            const date = value.toDate();
            return Number.isNaN(date.getTime()) ? null : date;
        }

        if (typeof value === 'object') {
            const dateLike = value as {
                toDate?: () => Date;
                seconds?: number;
                _seconds?: number;
            };

            if (typeof dateLike.toDate === 'function') {
                const date = dateLike.toDate();
                if (!(date instanceof Date)) return null;
                return Number.isNaN(date.getTime()) ? null : date;
            }

            if (typeof dateLike.seconds === 'number') {
                const date = new Date(dateLike.seconds * 1000);
                return Number.isNaN(date.getTime()) ? null : date;
            }

            if (typeof dateLike._seconds === 'number') {
                const date = new Date(dateLike._seconds * 1000);
                return Number.isNaN(date.getTime()) ? null : date;
            }

            return null;
        }

        if (typeof value !== 'string' && typeof value !== 'number') {
            return null;
        }

        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
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

        const normalizedDate = this.coerceDate(this.form.get('date')?.value);
        if (!normalizedDate) {
            this.form.get('date')?.setErrors({ invalid: true });
            return;
        }

        this.saving = true;
        try {
            const formData = this.form.value;

            const payload: Partial<ChangelogPost> = {
                title: formData.title,
                description: formData.description,
                date: Timestamp.fromDate(normalizedDate),
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
