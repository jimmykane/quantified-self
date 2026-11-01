import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicSeoPageComponent } from './public-seo-page.component';
import { PUBLIC_SEO_PAGES, PublicSeoPage } from './public-seo-pages.content';
import { PublicFeaturePreviewComponent } from './public-feature-preview.component';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { AppHapticsService } from '../../services/app.haptics.service';
import { ServiceNames } from '@sports-alliance/sports-lib';

describe('PublicSeoPageComponent', () => {
  let routeStub: { snapshot: { data: { publicSeoPage: PublicSeoPage } } };
  const selection = vi.fn();

  beforeEach(async () => {
    selection.mockClear();
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
        { provide: AppHapticsService, useValue: { selection } },
      ],
    }).compileComponents();

  });

  it('renders page content, sections, FAQ items, and CTAs from route data', () => {
    const fixture = TestBed.createComponent(PublicSeoPageComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    const featureRows = fixture.debugElement.queryAll(By.directive(CompactRowComponent));
    const faqItems = fixture.nativeElement.querySelectorAll('.faq-item');
    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const hrefs = links.map(link => link.getAttribute('href') ?? '');

    expect(featureRows).toHaveLength(6);
    expect(fixture.nativeElement.querySelectorAll('.feature-card')).toHaveLength(0);
    expect(fixture.nativeElement.querySelectorAll('.compact-row-stack')).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('app-compact-row.compact-row-host--without-divider')).toHaveLength(2);
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
    expect(text).toContain('connections and cross-service sync require Pro');
    expect(text).toContain('Preview sends nothing');
    const proLinks = Array.from(guideFixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    expect(proLinks.filter(link => link.textContent?.includes('See Pro Options')).map(link => link.getAttribute('href')))
      .toEqual(['/pricing', '/pricing']);
    const setupLink = proLinks.find(link => link.textContent?.includes('Start Setup'))!;
    expect(setupLink.getAttribute('href')).toBe('/services');
    expect(selection).not.toHaveBeenCalled();
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    setupLink.click();
    expect(selection).toHaveBeenCalledTimes(1);

    for (const step of PUBLIC_SEO_PAGES.syncGarminToSuunto.howToSteps ?? []) {
      expect(text).toContain(step);
    }

    guideFixture.destroy();
  });

  it.each(['importStravaToSuunto', 'importStravaToGarmin', 'importStravaToWahoo', 'importStravaToCoros'] as const)(
    'renders %s with usable official instructions and its destination boundary', key => {
      const page = PUBLIC_SEO_PAGES[key];
      routeStub.snapshot.data.publicSeoPage = page;
      const fixture = TestBed.createComponent(PublicSeoPageComponent);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('h1')?.textContent).toBe(page.h1);
      expect(root.textContent).toContain(page.accessNote);
      expect(root.querySelectorAll('.how-to-list li')).toHaveLength(5);
      const source = root.querySelector<HTMLAnchorElement>('a[href^="https://support.strava.com/"]')!;
      expect(source.textContent).toContain('Strava: export your data');
      expect(source.target).toBe('_blank');
      expect(source.rel).toBe('noopener noreferrer');
      expect(selection).not.toHaveBeenCalled();
      source.addEventListener('click', event => event.preventDefault());
      source.click();
      expect(selection).toHaveBeenCalledTimes(1);
      if (key === 'importStravaToGarmin') {
        expect(root.querySelector('a[href^="/send-activities"]')).toBeNull();
        expect(root.querySelector('a[href^="https://support.garmin.com/"]')).toBeTruthy();
        expect(root.textContent).toContain('Garmin advises exporting Strava activities individually');
      } else {
        const serviceName = page.actions[0].queryParams!['serviceName'];
        const setupLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).filter(link => link.textContent?.includes('Get Started'));
        expect(setupLinks.map(link => link.getAttribute('href'))).toEqual([
          `/services?serviceName=${encodeURIComponent(serviceName)}`,
          `/services?serviceName=${encodeURIComponent(serviceName)}`,
        ]);
        expect(root.textContent).toContain('Preview sends nothing');
        expect(root.textContent).toContain('Check status');
      }
      fixture.destroy();
    },
  );

  it('renders the Garmin-to-Wahoo guide with a paid setup path and visible transfer limits', () => {
    routeStub.snapshot.data.publicSeoPage = PUBLIC_SEO_PAGES.syncGarminToWahoo;
    const guideFixture = TestBed.createComponent(PublicSeoPageComponent);
    guideFixture.detectChanges();
    const root = guideFixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent).toBe('Sync Garmin activities to Wahoo');
    expect(root.textContent).toContain('activity sync require Pro');
    expect(root.textContent).toContain('Preview sends nothing');
    expect(root.textContent).toContain('Scheduling complete confirms queueing, not delivery');
    expect(root.querySelectorAll('.how-to-list li')).toHaveLength(4);
    expect(root.querySelector('.action-row a')?.getAttribute('href')).toBe('/pricing');
    expect(root.querySelector('a[href="/services"]')).toBeTruthy();
    guideFixture.destroy();
  });

  it.each([
    { page: PUBLIC_SEO_PAGES.syncWahooToSuunto, provider: 'Wahoo', serviceName: ServiceNames.WahooAPI },
    { page: PUBLIC_SEO_PAGES.syncCorosToSuunto, provider: 'COROS', serviceName: ServiceNames.COROSAPI },
  ])('renders the $provider-to-Suunto guide with explicit opt-in and setup actions', ({ page, provider, serviceName }) => {
    routeStub.snapshot.data.publicSeoPage = page;
    const guideFixture = TestBed.createComponent(PublicSeoPageComponent);
    guideFixture.detectChanges();
    const root = guideFixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent).toBe(`Sync ${provider} activities to Suunto`);
    expect(root.querySelector('.hero-access-note')?.textContent).toContain('require Pro');
    expect(root.textContent).toContain('Preview sends nothing');
    expect(root.textContent).toContain(`${serviceName} in Activity sources`);
    expect(root.querySelectorAll('.how-to-list li')).toHaveLength(5);
    const actions = Array.from(root.querySelectorAll<HTMLAnchorElement>('.action-row a'));
    const setupLinks = actions.filter(link => link.textContent?.includes('Get Started'));
    expect(setupLinks.map(link => link.getAttribute('href'))).toEqual([
      `/services?serviceName=${encodeURIComponent(serviceName)}`,
      `/services?serviceName=${encodeURIComponent(serviceName)}`,
    ]);
    expect(root.querySelector('a[href="/help#service-connections"]')).toBeTruthy();
    expect(root.querySelector('a[href="/pricing"]')).toBeTruthy();
    expect(selection).not.toHaveBeenCalled();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    setupLinks[0].click();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(selection).toHaveBeenCalledTimes(1);
    guideFixture.destroy();
  });

  it('uses the shared compact-row surface for every public feature-page section', () => {
    let setupLinkCount = 0;
    for (const page of Object.values(PUBLIC_SEO_PAGES)) {
      routeStub.snapshot.data.publicSeoPage = page;
      const pageFixture = TestBed.createComponent(PublicSeoPageComponent);
      pageFixture.detectChanges();

      const expectedItemCount = page.sections.reduce(
        (total, section) => total + section.items.length,
        0,
      );

      expect(pageFixture.debugElement.queryAll(By.directive(CompactRowComponent))).toHaveLength(expectedItemCount);
      expect(pageFixture.nativeElement.querySelectorAll('.compact-row-stack')).toHaveLength(page.sections.length);
      expect(pageFixture.nativeElement.querySelectorAll('.feature-card')).toHaveLength(0);
      const links = Array.from(pageFixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
      for (const link of links.filter(candidate => candidate.textContent?.includes('Start Setup'))) {
        expect(link.getAttribute('href'), page.path).toBe('/services');
        setupLinkCount++;
      }

      pageFixture.destroy();
    }
    expect(setupLinkCount).toBe(5);
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
    expect(text).toContain('training metrics, Health metrics, measurements, workout details');
    expect(text).toContain('Recorded Health metrics');
    expect(text).toContain('separate Health permission');
    expect(text).toContain('Body Battery keeps its Garmin points scale');
    expect(text).toContain('cannot change recorded activity data, Health, routes, sleep, measurements, or dashboard settings');
    expect(text).toContain('Training changes additionally use a bounded preview before a distinct apply call');
    expect(text).toContain('body-weight history');
    expect(text).toContain('Sleep, readiness, and daily context');
    expect(text).toContain('Saved routes and optional locations');
    expect(text).toContain('Workout details and charts');
    expect(text).toContain('Find recent activities');
    expect(text).toContain('exact event tag');
    expect(text).toContain('Can an MCP client find workouts by tag?');
    expect(text).toContain('Why are my Training plan tools missing?');
    expect(text).toContain('not that your plans are absent');
    expect(text).toContain('exact case-insensitive tag matches');
    expect(text).toContain('personal, health, or location context');
    expect(text).toContain('untrusted labels');
    expect(text).toContain('plan your next workout');
    expect(text).toContain('Focused, approval-gated writes');
    expect(text).toContain('External clients have their own privacy and retention practices');
    expect(mcpFixture.debugElement.queryAll(By.directive(CompactRowComponent))).toHaveLength(9);
    expect(mcpFixture.nativeElement.querySelectorAll('.faq-item')).toHaveLength(PUBLIC_SEO_PAGES.mcpServer.faqItems.length);
    expect(text).toContain('Can I analyze detailed workout samples instead of the 400-point chart?');
    expect(text).toContain('no new permission or provider reconnection is required');
    expect(text).toContain('Activity descriptions');
    expect(text).toContain('Timeline notes');
    expect(text).toContain('sensitive health or personal');
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

    expect(text).toContain('Activity calendar for workouts and plans');
    expect(text).toContain('Week, Month, and Year views');
    expect(text).toContain('Duration-scaled activity circles');
    expect(text).toContain('independent from dashboard event-search filters');
    expect(text).toContain('See the active plan’s phases');
    expect(calendarFixture.debugElement.queryAll(By.directive(CompactRowComponent))).toHaveLength(8);
    expect(calendarFixture.nativeElement.querySelectorAll('.faq-item')).toHaveLength(4);
    expect(hrefs).not.toContain('/calendar');
    expect(hrefs).toContain('/help#activity-calendar');
    expect(hrefs).toContain('/features/training-analysis');
    expect(hrefs).toContain('/features/training-plans');

    calendarFixture.destroy();
  });

  it('renders Training Plans with visible MCP and provider-delivery boundaries', () => {
    routeStub.snapshot.data.publicSeoPage = PUBLIC_SEO_PAGES.trainingPlans;

    const plansFixture = TestBed.createComponent(PublicSeoPageComponent);
    plansFixture.detectChanges();

    const text = plansFixture.nativeElement.textContent as string;
    const hrefs = Array.from(plansFixture.nativeElement.querySelectorAll('a'))
      .map(link => (link as HTMLAnchorElement).getAttribute('href') ?? '');
    const preview = plansFixture.debugElement.queryAll(By.directive(PublicFeaturePreviewComponent))
      .find(candidate => candidate.componentInstance.previewKey() === 'training-plans');

    expect(text).toContain('Plan workouts for running, cycling, swimming and more');
    expect(text).toContain('Walking, Hiking, Rowing, or Indoor Rowing workouts');
    expect(text).toContain('Standalone when that is all you need');
    expect(text).toContain('Multiple plans, one active calendar');
    expect(text).toContain('Completed totals remain unchanged');
    expect(text).toContain('Plan directly, through MCP, or with provider delivery');
    expect(text).toContain('compatible MCP client can read your schedule');
    expect(text).toContain('Workout delivery to Garmin, Suunto, and Wahoo is available to connected Pro members');
    expect(text).toContain('New COROS plan sync and standalone Send actions are coming soon in the app');
    expect(text).toContain('Connecting a provider never sends a workout by itself');
    expect(text).toContain('Can I add a workout without creating a plan?');
    expect(text).toContain('Can I use an MCP client with Training Plans?');
    expect(text).toContain('Plans and standalone structured workouts created in Quantified Self are available on the free tier');
    expect(text).toContain('Connecting a provider never sends a workout by itself');
    expect(text).not.toContain('Send to Garmin');
    expect(text).not.toContain('Send to COROS');
    expect(text).not.toContain('Send to Wahoo');
    expect(text).not.toContain('Send to Suunto');
    expect(text).toContain('Can I divide a training plan into phases?');
    expect(plansFixture.nativeElement.querySelectorAll('.faq-item')).toHaveLength(7);
    expect(preview).toBeTruthy();
    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/help#training-plans');
    expect(hrefs).toContain('/features/activity-calendar');
    expect(hrefs).toContain('/features/training-analysis');

    plansFixture.destroy();
  });
});
