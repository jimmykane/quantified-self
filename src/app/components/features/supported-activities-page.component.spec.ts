import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';
import { SupportedActivitiesPageComponent } from './supported-activities-page.component';

describe('SupportedActivitiesPageComponent', () => {
  it('renders all activity families and filters the expanded catalog by activity type', () => {
    TestBed.configureTestingModule({
      imports: [
        SupportedActivitiesPageComponent,
        RouterTestingModule.withRoutes([]),
        NoopAnimationsModule,
        MatIconTestingModule,
      ],
    });

    const fixture: ComponentFixture<SupportedActivitiesPageComponent> = TestBed.createComponent(SupportedActivitiesPageComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('131 canonical activity types');
    expect(fixture.nativeElement.querySelectorAll('.family-card')).toHaveLength(17);
    expect(fixture.nativeElement.querySelector('[data-family-id="motorized_group"]')?.textContent).toContain('Boating');

    fixture.componentInstance.onSearchQueryChange('wheel chair');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.family-card')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[data-family-id="adaptive_mobility_group"]')?.textContent).toContain('Wheel Chair');
    expect(fixture.nativeElement.textContent).toContain('1 activity type in 1 family match your search.');
  });

  it('explains that family membership does not replace exact chart recommendations', () => {
    TestBed.configureTestingModule({
      imports: [
        SupportedActivitiesPageComponent,
        RouterTestingModule.withRoutes([]),
        NoopAnimationsModule,
        MatIconTestingModule,
      ],
    });

    const fixture: ComponentFixture<SupportedActivitiesPageComponent> = TestBed.createComponent(SupportedActivitiesPageComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    const helpLink = fixture.nativeElement.querySelector('a[routerlink="/help"], a[ng-reflect-router-link="/help"]');

    expect(text).toContain('Boating is organized in Motorized');
    expect(text).toContain('Wheel Chair is organized in Adaptive Mobility');
    expect(text).toContain('never creates, names, associates, or calculates missing gas and tank data');
    expect(helpLink).toBeTruthy();
  });
});
