import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WhatsNewItemComponent } from './whats-new-item.component';
import { Timestamp } from '@angular/fire/firestore';
import { ChangelogPost } from '../../services/app.whats-new.service';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

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
});
