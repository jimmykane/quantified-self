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
    const cards = fixture.nativeElement.querySelectorAll('.feature-card');
    const faqItems = fixture.nativeElement.querySelectorAll('.faq-item');
    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const hrefs = links.map(link => link.getAttribute('href') ?? '');

    expect(cards.length).toBe(6);
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

  it('renders the public MCP capabilities, boundaries, and setup links', () => {
    routeStub.snapshot.data.publicSeoPage = PUBLIC_SEO_PAGES.mcpServer;

    const mcpFixture = TestBed.createComponent(PublicSeoPageComponent);
    mcpFixture.detectChanges();

    const text = mcpFixture.nativeElement.textContent as string;
    const links = Array.from(mcpFixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const hrefs = links.map(link => link.getAttribute('href') ?? '');

    expect(text).toContain('Connect ChatGPT to your training data with a read-only MCP server');
    expect(text).toContain('Activity, body measurement, and Training analysis');
    expect(text).toContain('body measurements, individual activity details');
    expect(text).toContain('identity-free body-weight history');
    expect(text).toContain('Sleep trends, live readiness, and a daily report');
    expect(text).toContain('one bounded sleep trend');
    expect(text).toContain('Saved-route summaries and optional locations');
    expect(text).toContain('Individual activity details and charts');
    expect(text).toContain('canonical Sports Lib activity types');
    expect(text).toContain('latest run');
    expect(text).toContain('explicit IANA timezone');
    expect(text).toContain('route-name text');
    expect(text).toContain('No settings or data writes');
    expect(text).toContain('ChatGPT is an external client with its own privacy and retention practices');
    expect(mcpFixture.nativeElement.querySelectorAll('.feature-card')).toHaveLength(8);
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
    expect(calendarFixture.nativeElement.querySelectorAll('.feature-card')).toHaveLength(6);
    expect(calendarFixture.nativeElement.querySelectorAll('.faq-item')).toHaveLength(4);
    expect(hrefs).toContain('/calendar');
    expect(hrefs).toContain('/help#activity-calendar');
    expect(hrefs).toContain('/features/training-analysis');

    calendarFixture.destroy();
  });
});
