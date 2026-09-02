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
    const featureCards = fixture.nativeElement.querySelectorAll('.feature-card');
    const faqItems = fixture.nativeElement.querySelectorAll('.faq-item');

    expect(providerChips.length).toBe(4);
    expect(featureCards.length).toBe(4);
    expect(faqItems.length).toBe(5);
    expect(text).toContain('Compare Garmin, Suunto, COROS, and Wahoo workout data');
    expect(text).toContain('custom FIT, TCX, GPX, JSON, or SML imports');
    expect(text).toContain('Manual uploads and benchmark comparisons are available on the free plan');
    expect(text).toContain('automatic provider sync and higher limits');
    const reviewerPreview = fixture.nativeElement.querySelector(
      'app-public-feature-preview[previewkey="reviewer-benchmark"]'
    );
    expect(reviewerPreview).toBeTruthy();
    expect(reviewerPreview.hasAttribute('data-nosnippet')).toBe(true);
    expect(fixture.nativeElement.querySelector('.benchmark-preview')).toBeNull();
    expect(text).toContain('From sync to benchmark analysis');
    expect(text).toContain('Benchmark any two imported activities');
    expect(text).toContain('available on the free plan for up to 100 activities and 10 saved routes');
    expect(text).toContain('Reviewer-ready device comparisons');
    expect(text).toContain('Metric overlays for shared signals');
    expect(text).toContain('Custom FIT, TCX, GPX, JSON, and SML imports');
    expect(text).toContain('Evidence for device reviews and blog posts');
    expect(text).toContain('lab tests, beta firmware, review units, exported workouts, or unsupported services');
    expect(text).toContain('Reviewers, YouTube creators, bloggers, coaches, and testers');
    expect(text).toContain('Is workout data comparison available on the free plan?');
    expect(text).toContain('Centralize Garmin, Suunto, COROS, and Wahoo workout data');
    expect(text).toContain('Compare custom FIT, TCX, GPX, JSON, and SML files');
    expect(text).toContain('free to try on the Starter plan');
    expect(text).not.toContain('AI insights');
    expect(text).not.toContain('AI-backed');
    expect(text).not.toContain('AI analysis');
    expect(text).not.toContain('centralize Garmin Suunto and COROS workout data');
    expect(text).not.toContain('compare Garmin Suunto COROS workout data');
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
