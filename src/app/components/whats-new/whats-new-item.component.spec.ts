import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WhatsNewItemComponent } from './whats-new-item.component';
import { Timestamp } from 'app/firebase/firestore';
import { ChangelogPost } from '../../services/app.whats-new.service';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatExpansionPanelHeader } from '@angular/material/expansion';

describe('WhatsNewItemComponent', () => {
    let component: WhatsNewItemComponent;
    let fixture: ComponentFixture<WhatsNewItemComponent>;

    const mockPost: ChangelogPost = {
        id: 'test-1',
        title: 'Test Release',
        description: 'This is a **test** release note.',
        date: Timestamp.now(),
        type: 'minor',
        version: '1.2.3',
        published: true
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [WhatsNewItemComponent, NoopAnimationsModule]
        }).compileComponents();

        fixture = TestBed.createComponent(WhatsNewItemComponent);
        component = fixture.componentInstance;
        // set inputs
        fixture.componentRef.setInput('post', mockPost);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should display title', () => {
        const titleElement = fixture.debugElement.query(By.css('.post-title')).nativeElement;
        expect(titleElement.textContent).toContain(mockPost.title);
    });

    it('should emit postClick when card is clicked in compact mode', () => {
        fixture.componentRef.setInput('displayMode', 'compact');
        fixture.detectChanges();

        const spy = vi.spyOn(component.postClick, 'emit');
        const card = fixture.debugElement.query(By.css('.changelog-card'));
        card.triggerEventHandler('click', null);

        expect(spy).toHaveBeenCalled();
    });

    it('should apply flush content alignment only when notification layout is requested', () => {
        const panel = fixture.debugElement.query(By.css('.changelog-panel')).nativeElement as HTMLElement;
        expect(panel.classList.contains('changelog-panel-notification')).toBe(false);

        fixture.componentRef.setInput('notificationLayout', true);
        fixture.detectChanges();

        const header = fixture.debugElement.query(By.directive(MatExpansionPanelHeader));
        const headerComponent = header.componentInstance as MatExpansionPanelHeader;

        expect(panel.classList.contains('changelog-panel-notification')).toBe(true);
        expect(headerComponent.collapsedHeight).toBe('');
        expect(headerComponent.expandedHeight).toBe('');
    });

    it('should let full-mode headers grow so wrapped titles do not cover release metadata', () => {
        fixture.componentRef.setInput('post', {
            ...mockPost,
            title: 'Deeper Training Insights and a Smarter Dashboard'
        });
        fixture.detectChanges();

        const header = fixture.debugElement.query(By.directive(MatExpansionPanelHeader));
        const headerComponent = header.componentInstance as MatExpansionPanelHeader;

        expect(headerComponent.collapsedHeight).toBe('auto');
        expect(headerComponent.expandedHeight).toBe('auto');
        expect(header.query(By.css('.header-date'))).toBeTruthy();
    });

    it('should render markdown description in full mode', async () => {
        fixture.componentRef.setInput('displayMode', 'full');
        fixture.componentRef.setInput('expanded', true);
        fixture.detectChanges();

        // Wait for dynamic import and promise resolution
        await new Promise(resolve => setTimeout(resolve, 500));
        fixture.detectChanges();

        const description = fixture.debugElement.query(By.css('.description')).nativeElement;
        expect(description.innerHTML).toContain('test');
    });

    it('should show draft tag when not published', () => {
        fixture.componentRef.setInput('post', { ...mockPost, published: false });
        fixture.detectChanges();

        const draftTag = fixture.debugElement.query(By.css('.unpublished-tag'));
        expect(draftTag).toBeTruthy();
        expect(draftTag.nativeElement.textContent).toContain('Draft');
    });

    it('should normalize timestamp-like post dates for display', () => {
        fixture.componentRef.setInput('post', {
            ...mockPost,
            date: {
                seconds: Date.parse('2026-03-01T00:00:00Z') / 1000,
                nanoseconds: 0
            }
        });
        fixture.detectChanges();

        expect(component.displayDate()).toEqual(new Date('2026-03-01T00:00:00Z'));
    });

    it('should recompute the display date when the post input changes', () => {
        fixture.componentRef.setInput('post', {
            ...mockPost,
            date: new Date('2026-03-01T00:00:00Z')
        });
        fixture.detectChanges();

        expect(component.displayDate()).toEqual(new Date('2026-03-01T00:00:00Z'));

        fixture.componentRef.setInput('post', {
            ...mockPost,
            date: new Date('2026-04-01T00:00:00Z')
        });
        fixture.detectChanges();

        expect(component.displayDate()).toEqual(new Date('2026-04-01T00:00:00Z'));
    });
});
