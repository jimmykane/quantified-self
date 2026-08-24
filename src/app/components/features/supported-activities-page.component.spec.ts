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

    expect(fixture.nativeElement.textContent).toContain('Quantified Self recognizes 131 activity types.');
    expect(fixture.nativeElement.querySelectorAll('.family-card')).toHaveLength(17);
    expect(fixture.nativeElement.querySelector('[data-family-id="motorized_group"]')?.textContent).toContain('Boating');

    fixture.componentInstance.onSearchQueryChange('wheel chair');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.family-card')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[data-family-id="adaptive_mobility_group"]')?.textContent).toContain('Wheel Chair');
    expect(fixture.nativeElement.textContent).toContain('Showing 1 activity type in 1 matching group.');

    fixture.componentInstance.onSearchQueryChange('cycling');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-family-id="cycling_group"]')?.textContent).toContain('Hand Cycle');
    expect(fixture.componentInstance.searchResultSummary()).toMatch(
      /^Showing \d+ activity types in \d+ matching groups\.$/,
    );
    expect(fixture.nativeElement.textContent).not.toContain('activity types match your search.');
  });

  it('uses plain language to explain how activity groups and recorded data affect Event Details', () => {
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

    expect(text).toContain('Charts follow the activity, not just its group');
    expect(text).toContain('Groups make the catalog easy to browse');
    expect(text).toContain('Laps appear when the activity includes lap data');
    expect(text).toContain('Swim Lengths when the data includes individual pool lengths');
    expect(text).toContain('Jumps appear when the activity includes jump events');
    expect(text).toContain('We do not estimate or fill in missing dive data');
    expect(helpLink).toBeTruthy();
  });

  it('keeps the support explanation compact at the bottom of the page', () => {
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

    const providerSection = fixture.nativeElement.querySelector('.provider-section') as HTMLElement;
    const supportDetails = fixture.nativeElement.querySelector('.support-details-section') as HTMLElement;

    expect(supportDetails.querySelector('mat-expansion-panel')).toBeTruthy();
    expect(supportDetails.textContent).toContain('What “supported” means');
    expect(providerSection.compareDocumentPosition(supportDetails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
