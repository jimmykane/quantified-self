import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PublicSeoPageComponent } from './public-seo-page.component';
import { PUBLIC_SEO_PAGES, PublicSeoPage } from './public-seo-pages.content';
import { PublicFeaturePreviewComponent } from './public-feature-preview.component';
import { CompactFeatureRowComponent } from '../shared/compact-feature-row/compact-feature-row.component';

describe('PublicSeoPageComponent', () => {
  let fixture: ComponentFixture<PublicSeoPageComponent>;
  let routeStub: { snapshot: { data: { publicSeoPage: PublicSeoPage } } };

  beforeEach(async () => {
    routeStub = {
      snapshot: {
        data: {
          publicSeoPage: PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer,
        },
      },
    };

    await TestBed.configureTestingModule({
      imports: [
        PublicSeoPageComponent,
        RouterTestingModule.withRoutes([]),
        NoopAnimationsModule,
        MatIconTestingModule,
      ],
      providers: [
        { provide: ActivatedRoute, useValue: routeStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicSeoPageComponent);
    fixture.detectChanges();
  });

  it('renders page content, sections, FAQ items, and CTAs from route data', () => {
    const text = fixture.nativeElement.textContent as string;
    const featureRows = fixture.debugElement.queryAll(By.directive(CompactFeatureRowComponent));
    const faqItems = fixture.nativeElement.querySelectorAll('.faq-item');
    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const hrefs = links.map(link => link.getAttribute('href') ?? '');

    expect(featureRows).toHaveLength(6);
    expect(fixture.nativeElement.querySelectorAll('.feature-card')).toHaveLength(0);
    expect(fixture.nativeElement.querySelectorAll('.compact-feature-row-stack')).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('app-compact-feature-row.compact-feature-row-host--without-divider')).toHaveLength(2);
    expect(faqItems.length).toBe(4);
    expect(text).toContain('Analyze FIT, GPX, and TCX workout files');
    expect(text).toContain('maps, charts, stats, exports');
    expect(text).toContain('Workout File Analyzer FAQ');
    expect(fixture.nativeElement.querySelector('.how-to-list')).toBeNull();
    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/features/workout-data-comparison');
    expect(hrefs).toContain('/help#uploads-and-imports');
    expect(hrefs).toContain('/features/fit-gpx-route-files');
    const workoutPreview = fixture.debugElement.queryAll(By.directive(PublicFeaturePreviewComponent))
      .find(preview => preview.componentInstance.previewKey() === 'workout-analysis');
    expect(workoutPreview).toBeTruthy();
  });

  it('renders visible HowTo steps when route data includes HowTo structured data', () => {
    routeStub.snapshot.data.publicSeoPage = PUBLIC_SEO_PAGES.syncGarminToSuunto;

    const guideFixture = TestBed.createComponent(PublicSeoPageComponent);
    guideFixture.detectChanges();

    const text = guideFixture.nativeElement.textContent as string;
    const steps = Array.from(guideFixture.nativeElement.querySelectorAll('.how-to-list li')) as HTMLElement[];

    expect(text).toContain('Step-by-step workflow');
    expect(steps.length).toBe(PUBLIC_SEO_PAGES.syncGarminToSuunto.howToSteps?.length);

    for (const step of PUBLIC_SEO_PAGES.syncGarminToSuunto.howToSteps ?? []) {
      expect(text).toContain(step);
    }

    guideFixture.destroy();
  });

  it('uses the shared compact-row surface for every public feature-page section', () => {
    for (const page of Object.values(PUBLIC_SEO_PAGES)) {
      routeStub.snapshot.data.publicSeoPage = page;
      const pageFixture = TestBed.createComponent(PublicSeoPageComponent);
      pageFixture.detectChanges();

      const expectedItemCount = page.sections.reduce(
        (total, section) => total + section.items.length,
        0,
      );

      expect(pageFixture.debugElement.queryAll(By.directive(CompactFeatureRowComponent))).toHaveLength(expectedItemCount);
      expect(pageFixture.nativeElement.querySelectorAll('.compact-feature-row-stack')).toHaveLength(page.sections.length);
      expect(pageFixture.nativeElement.querySelectorAll('.feature-card')).toHaveLength(0);

      pageFixture.destroy();
    }
  });

  it('renders the public MCP capabilities, boundaries, and setup links', () => {
    routeStub.snapshot.data.publicSeoPage = PUBLIC_SEO_PAGES.mcpServer;

    const mcpFixture = TestBed.createComponent(PublicSeoPageComponent);
    mcpFixture.detectChanges();

    const text = mcpFixture.nativeElement.textContent as string;
    const links = Array.from(mcpFixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const hrefs = links.map(link => link.getAttribute('href') ?? '');

    expect(text).toContain('Connect ChatGPT or Claude to your training data');
    expect(text).toContain('Training and measurement trends');
    expect(text).toContain('training metrics, measurements, workout details');
    expect(text).toContain('body-weight history');
    expect(text).toContain('Sleep, readiness, and daily context');
    expect(text).toContain('Saved routes and optional locations');
    expect(text).toContain('Workout details and charts');
    expect(text).toContain('Find recent activities');
    expect(text).toContain('plan your next workout');
    expect(text).toContain('No settings or data writes');
    expect(text).toContain('External clients have their own privacy and retention practices');
    expect(mcpFixture.debugElement.queryAll(By.directive(CompactFeatureRowComponent))).toHaveLength(8);
    expect(mcpFixture.nativeElement.querySelectorAll('.faq-item')).toHaveLength(5);
    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/help#data-and-privacy');
    expect(hrefs).toContain('/policies#mcp-clients');

    mcpFixture.destroy();
  });

  it('renders the public Activity Calendar overview and help links', () => {
    routeStub.snapshot.data.publicSeoPage = PUBLIC_SEO_PAGES.activityCalendar;

    const calendarFixture = TestBed.createComponent(PublicSeoPageComponent);
    calendarFixture.detectChanges();

    const text = calendarFixture.nativeElement.textContent as string;
    const hrefs = Array.from(calendarFixture.nativeElement.querySelectorAll('a'))
      .map(link => (link as HTMLAnchorElement).getAttribute('href') ?? '');

    expect(text).toContain('Activity calendar for endurance training');
    expect(text).toContain('Week, Month, and Year views');
    expect(text).toContain('Duration-scaled activity circles');
    expect(text).toContain('independent from dashboard event-search filters');
    expect(calendarFixture.debugElement.queryAll(By.directive(CompactFeatureRowComponent))).toHaveLength(6);
    expect(calendarFixture.nativeElement.querySelectorAll('.faq-item')).toHaveLength(4);
    expect(hrefs).not.toContain('/calendar');
    expect(hrefs).toContain('/help#activity-calendar');
    expect(hrefs).toContain('/features/training-analysis');

    calendarFixture.destroy();
  });
});
