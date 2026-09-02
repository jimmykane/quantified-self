import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEventService } from '../../services/app.event.service';
import { WorkoutDataComparisonPageComponent } from './workout-data-comparison-page.component';

describe('WorkoutDataComparisonPageComponent', () => {
  let fixture: ComponentFixture<WorkoutDataComparisonPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        WorkoutDataComparisonPageComponent,
        RouterTestingModule.withRoutes([]),
        NoopAnimationsModule,
        MatIconTestingModule,
      ],
      providers: [
        { provide: AppEventService, useValue: { getEventMetaDataKeys: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkoutDataComparisonPageComponent);
    fixture.detectChanges();
  });

  it('renders the comparison feature page content and provider chips', () => {
    const text = fixture.nativeElement.textContent as string;
    const providerChips = fixture.nativeElement.querySelectorAll('.provider-chip');
    const compactRows = fixture.nativeElement.querySelectorAll('app-compact-feature-row');
    const faqItems = fixture.nativeElement.querySelectorAll('.faq-item');

    expect(providerChips.length).toBe(4);
    expect(compactRows.length).toBe(11);
    expect(fixture.nativeElement.querySelector('.feature-card')).toBeNull();
    expect(fixture.nativeElement.querySelector('.tool-row')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.compact-feature-row-host--without-divider').length).toBe(3);
    expect(faqItems.length).toBe(5);
    expect(text).toContain('Compare workout files, providers, and sports devices');
    expect(text).toContain('Garmin, Suunto, COROS, Wahoo, FIT, TCX, GPX, JSON, and SML recordings');
    const reviewerPreview = fixture.nativeElement.querySelector(
      'app-public-feature-preview[previewkey="reviewer-benchmark"]'
    );
    expect(reviewerPreview).toBeTruthy();
    expect(reviewerPreview.hasAttribute('data-nosnippet')).toBe(true);
    expect(fixture.nativeElement.querySelector('.benchmark-preview')).toBeNull();
    expect(text).toContain('Compare and benchmark any two recordings');
    expect(text).toContain('assign reference and test roles');
    expect(text).toContain('Connected provider activities');
    expect(text).toContain('Uploaded workout files');
    expect(text).toContain('Synchronized metric overlays');
    expect(text).toContain('GNSS and route disagreement');
    expect(text).toContain('Stable device colors and review tags');
    expect(text).toContain('Copy, share, or download the result');
    expect(text).toContain('sports watch and bike-computer reviews');
    expect(text).toContain('Is workout data comparison available on the free plan?');
    expect(text).toContain('Upload FIT, TCX, GPX, JSON, and SML activities');
    expect(text).toContain('free to try on the Starter plan');
    expect(text).not.toContain('AI insights');
    expect(text).not.toContain('AI-backed');
    expect(text).not.toContain('AI analysis');
    expect(text).not.toContain('centralize Garmin Suunto and COROS workout data');
    expect(text).not.toContain('compare Garmin Suunto COROS workout data');
  });

  it('starts the feature content with workout-file uploads', () => {
    const sections = Array.from(
      fixture.nativeElement.querySelectorAll('main > section')
    ) as HTMLElement[];

    expect(sections[0].classList.contains('hero-section')).toBe(true);
    expect(sections[1].id).toBe('files');
    expect(sections[1].querySelector('h2')?.textContent?.trim()).toBe(
      'Upload FIT, TCX, GPX, JSON, and SML activities'
    );
  });

  it('exposes public CTAs and support links', () => {
    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const hrefs = links.map(link => link.getAttribute('href') ?? '');

    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/integrations');
    expect(hrefs).toContain('/features/fit-gpx-tcx-file-analyzer');
    expect(hrefs).toContain('/help#service-connections');
  });
});
