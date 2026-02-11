import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppLoadingOverlayComponent } from './loading-overlay.component';
import { AppSkeletonComponent } from '../skeleton/app.skeleton.component';
import { ShadeComponent } from '../shade.component';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatIconModule } from '@angular/material/icon';
import { By } from '@angular/platform-browser';

describe('AppLoadingOverlayComponent', () => {
    let component: AppLoadingOverlayComponent;
    let fixture: ComponentFixture<AppLoadingOverlayComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [AppLoadingOverlayComponent, AppSkeletonComponent, ShadeComponent],
            imports: [MatProgressBarModule, MatIconModule]
        }).compileComponents();

        fixture = TestBed.createComponent(AppLoadingOverlayComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should show loading indicators when isLoading is true', () => {
        component.isLoading = true;
        fixture.detectChanges();

        const progressBar = fixture.debugElement.query(By.css('.overlay-progress-bar'));
        const skeleton = fixture.debugElement.query(By.css('.overlay-skeleton'));
        const shade = fixture.debugElement.query(By.directive(ShadeComponent));

        expect(progressBar).toBeTruthy();
        expect(skeleton).toBeFalsy();
        // Shade is always present in template but controlled by internal logic or separate inputs
        // The component has *ngIf="showShade" on the shade component
        expect(shade).toBeTruthy();
    });

    it('should show skeleton when showSkeleton is enabled', () => {
        component.isLoading = true;
        component.showSkeleton = true;
        fixture.detectChanges();

        const skeleton = fixture.debugElement.query(By.css('.overlay-skeleton'));
        expect(skeleton).toBeTruthy();
    });

    it('should hide loading indicators when isLoading is false', () => {
        component.isLoading = false;
        fixture.detectChanges();

        const progressBar = fixture.debugElement.query(By.css('.overlay-progress-bar'));
        const skeleton = fixture.debugElement.query(By.css('.overlay-skeleton'));

        // Shade might still be in DOM if showShade is true, but its 'isActive' input would be false.
        // The *ngIf="isLoading" is on the DIV wrapping progress bar and skeleton.

        expect(progressBar).toBeFalsy();
        expect(skeleton).toBeFalsy();
    });

    it('should apply custom height and width', () => {
        component.height = '500px';
        component.width = '50%';
        fixture.detectChanges();

        const container = fixture.debugElement.query(By.css('.loading-overlay-container'));
        expect(container.styles['height']).toBe('500px');
        expect(container.styles['width']).toBe('50%');
    });

    it('should not show shade if showShade is false', () => {
        component.showShade = false;
        fixture.detectChanges();

        const shade = fixture.debugElement.query(By.directive(ShadeComponent));
        expect(shade).toBeFalsy();
    });
});
