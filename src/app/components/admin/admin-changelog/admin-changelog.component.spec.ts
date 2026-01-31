import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminChangelogComponent } from './admin-changelog.component';
import { AppWhatsNewService, ChangelogPost } from '../../../services/app.whats-new.service';
import { LoggerService } from '../../../services/logger.service';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal, WritableSignal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { vi, expect } from 'vitest';

describe('AdminChangelogComponent', () => {
    let component: AdminChangelogComponent;
    let fixture: ComponentFixture<AdminChangelogComponent>;
    let whatsNewServiceSpy: any;
    let loggerServiceSpy: any;
    let changelogsSignal: WritableSignal<ChangelogPost[]>;

    const mockChangelog: ChangelogPost = {
        id: '1',
        title: 'Test Version 1.0',
        description: 'Initial release',
        date: Timestamp.now(),
        type: 'major',
        version: '1.0.0',
        published: true
    };

    beforeEach(async () => {
        try {
            changelogsSignal = signal([mockChangelog]);

            whatsNewServiceSpy = {
                setAdminMode: vi.fn(),
                createChangelog: vi.fn(),
                updateChangelog: vi.fn(),
                deleteChangelog: vi.fn(),
                changelogs: changelogsSignal
            };

            loggerServiceSpy = {
                error: vi.fn()
            };

            await TestBed.configureTestingModule({
                imports: [AdminChangelogComponent],
                providers: [
                    provideAnimations(),
                    { provide: AppWhatsNewService, useValue: whatsNewServiceSpy },
                    { provide: LoggerService, useValue: loggerServiceSpy },
                    {
                        provide: ActivatedRoute,
                        useValue: {
                            snapshot: { paramMap: { get: () => null } },
                            params: of({})
                        }
                    }
                ]
            }).compileComponents();

            fixture = TestBed.createComponent(AdminChangelogComponent);
            component = fixture.componentInstance;
            fixture.detectChanges();
        } catch (e) {
            console.error('DEBUG TEST ERROR:', e);
            throw e;
        }
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should enable admin mode on init', () => {
        expect(whatsNewServiceSpy.setAdminMode).toHaveBeenCalledWith(true);
    });

    it('should disable admin mode on destroy', () => {
        component.ngOnDestroy();
        expect(whatsNewServiceSpy.setAdminMode).toHaveBeenCalledWith(false);
    });

    it('should list changelogs', () => {
        expect(component.changelogs().length).toBe(1);
        expect(component.changelogs()[0].title).toBe('Test Version 1.0');
    });

    it('should initialize form for new entry', () => {
        component.createNew();
        expect(component.isNew).toBe(true);
        expect(component.editingPost).toBeNull();
        expect(component.form.get('type')?.value).toBe('minor'); // Default
        expect(component.form.get('published')?.value).toBe(false);
    });

    it('should populate form for editing', () => {
        component.edit(mockChangelog);
        expect(component.isNew).toBe(false);
        expect(component.editingPost).toBe(mockChangelog);
        expect(component.form.get('title')?.value).toBe(mockChangelog.title);
        expect(component.form.get('version')?.value).toBe(mockChangelog.version);
        // Date check might need leniency depending on timezone/conversion, but roughly:
        expect(component.form.get('date')?.value).toBeTruthy();
    });

    it('should call createChangelog on save for new entry', async () => {
        component.createNew();
        component.form.patchValue({
            title: 'New Feature',
            description: 'Added something cool',
            date: new Date(),
            type: 'minor',
            version: '1.1.0',
            published: true
        });

        await component.save();

        expect(whatsNewServiceSpy.createChangelog).toHaveBeenCalled();
        const args = (whatsNewServiceSpy.createChangelog as any).mock.calls[0][0];
        expect(args.title).toBe('New Feature');
        expect(component.saving).toBe(false);
        expect(component.isNew).toBe(false); // Should reset
    });

    it('should call updateChangelog on save for existing entry', async () => {
        component.edit(mockChangelog);
        component.form.patchValue({
            title: 'Updated Title'
        });

        await component.save();

        expect(whatsNewServiceSpy.updateChangelog).toHaveBeenCalled();
        expect(whatsNewServiceSpy.updateChangelog).toHaveBeenCalledWith('1', expect.objectContaining({ title: 'Updated Title' }));
        expect(component.editingPost).toBeNull(); // Should reset
    });

    it('should validate form before saving', async () => {
        component.createNew();
        component.form.patchValue({ title: '' }); // Invalid

        await component.save();

        expect(whatsNewServiceSpy.createChangelog).not.toHaveBeenCalled();
    });

    it('should delete a changelog', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        await component.delete(mockChangelog);

        expect(whatsNewServiceSpy.deleteChangelog).toHaveBeenCalledWith('1');
    });
});
