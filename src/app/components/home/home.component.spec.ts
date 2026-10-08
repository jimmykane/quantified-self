import { ComponentFixture, DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { SpyLocation } from '@angular/common/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MatSelect } from '@angular/material/select';
import { RouterTestingModule } from '@angular/router/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { MatTooltip } from '@angular/material/tooltip';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BehaviorSubject } from 'rxjs';
import { ASSISTANT_REQUEST_LIMITS, USAGE_LIMITS, ROUTE_USAGE_LIMITS } from '@shared/limits';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { PublicFeaturePreviewComponent } from '../public-seo/public-feature-preview.component';
import { HomeComponent } from './home.component';

describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;
  let userSubject: BehaviorSubject<{ uid: string } | null>;
  let router: Router;
  let location: SpyLocation;
  const selection = vi.fn();

  beforeEach(async () => {
    userSubject = new BehaviorSubject<{ uid: string } | null>(null);
    selection.mockClear();
    await TestBed.configureTestingModule({
      deferBlockBehavior: DeferBlockBehavior.Manual,
      imports: [HomeComponent, RouterTestingModule.withRoutes([]), MatIconTestingModule, NoopAnimationsModule],
      providers: [
        { provide: AppAuthService, useValue: { user$: userSubject.asObservable() } },
        { provide: AppHapticsService, useValue: { selection } },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    location = TestBed.inject(Location) as SpyLocation;
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  });

  it('keeps anonymous visitors on home and redirects authenticated users to Dashboard', () => {
    expect(router.navigate).not.toHaveBeenCalled();
    userSubject.next({ uid: 'test-user' });
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    vi.mocked(router.navigate).mockClear();
    fixture.destroy();
    userSubject.next({ uid: 'another-user' });
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('pairs a concise hero with the shared Training overview and real analysis/signup links', async () => {
    const hero = fixture.nativeElement.querySelector('.hero-section') as HTMLElement;
    expect(hero.querySelector('h1')?.textContent).toBe('Your training, connected and understood.');
    expect(hero.querySelector('.hero-preview')?.textContent).toContain('Sample data');
    expect(hero.querySelector('.preview-placeholder--training')).toBeTruthy();
    expect(hero.querySelector('app-training-summary-cards')).toBeNull();
    const [heroBlock] = await fixture.getDeferBlocks();
    await heroBlock.render(DeferBlockState.Complete);
    fixture.detectChanges();
    expect(hero.querySelector('app-training-summary-cards')).toBeTruthy();
    expect(hero.querySelectorAll('app-training-metric-grid')).toHaveLength(2);
    expect(hero.querySelector('a[href="/login"]')?.textContent).toContain('Get Started Free');
    expect(hero.querySelector('a[href="/features/training-analysis"]')?.textContent).toContain('Explore Training Analysis');
    expect(fixture.nativeElement.textContent).not.toMatch(/explore the demo|try the demo/i);
    expect(selection).not.toHaveBeenCalled();
  });

  it('links only to existing public discovery, membership and onboarding destinations', () => {
    const paths = Array.from(fixture.nativeElement.querySelectorAll('a[href]'))
      .map((link: Element) => link.getAttribute('href')!);
    expect(paths.every(path => path === '/login' || path === '/integrations' || path === '/pricing'
      || path === '/help' || path === '/help#data-and-privacy'
      || fixture.componentInstance.features.some(feature => path === '#home-' + feature.id)
      || path.startsWith('/features/'))).toBe(true);
    expect(paths).not.toContain('/demo');
    expect(fixture.nativeElement.querySelector('nav[aria-label="Homepage features"]')).toBeTruthy();
  });

  it('exposes every supported provider logo and its name to assistive technology', () => {
    const logos = Array.from(fixture.nativeElement.querySelectorAll('.logos-container [role="img"]')) as HTMLElement[];
    expect(logos.map(logo => logo.getAttribute('aria-label'))).toEqual(['Garmin', 'Suunto', 'COROS', 'Wahoo']);
    expect(logos.every(logo => logo.getAttribute('aria-hidden') === 'false')).toBe(true);
  });

  it('retains every shared product visual and detailed feature section', () => {
    const sections = Array.from(fixture.nativeElement.querySelectorAll('.landing-page > section'))
      .map((section: Element) => section.className);
    expect(sections).toEqual(['hero-section', 'getting-started-section', 'membership-section',
      'sovereignty-section', 'faq-section', 'final-cta-section']);
    const featureSections = Array.from(fixture.nativeElement.querySelectorAll('.home-feature-panels > section'))
      .map((section: Element) => section.id);
    expect(featureSections).toEqual(fixture.componentInstance.features.map(feature => 'home-' + feature.id));
    const previews = fixture.debugElement.queryAll(By.directive(PublicFeaturePreviewComponent));
    expect(previews.map(preview => preview.componentInstance.previewKey()))
      .toEqual(['training-snapshot', 'training-readiness', 'training-signals',
        'training-explorer', 'dashboard', 'workout-analysis', 'training-plans',
        'health-sleep', 'health-hrv', 'health-weight', 'assistant-example', 'mcp-flow',
        'activity-map', 'reviewer-benchmark', 'provider-flow']);
    expect(previews.every(preview => !!preview.nativeElement.querySelector(':scope > div[data-nosnippet]'))).toBe(true);
    expect(fixture.nativeElement.querySelector('app-training-explorer-preview')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-workout-profile')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/features/workout-data-comparison"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('a[href="/features/activity-map"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('a[href="/features/mcp-server"]')).toBeTruthy();
    const copy = fixture.nativeElement.textContent as string;
    expect(copy).toContain('Charts Behind Every Signal');
    expect(copy).toContain('Curated, KPI, Custom, and Map tiles');
    expect(copy).toContain('aerobic durability, and cadence versus power');
    expect(copy).toContain('blood pressure, weight, body composition');
    expect(copy).toContain('reference and test devices');
    expect(copy).toContain('location access remains separate');
    expect(fixture.nativeElement.querySelectorAll('.training-plans-section app-compact-row')).toHaveLength(6);
    expect(fixture.nativeElement.querySelector('#home-plans-example-title')?.textContent)
      .toContain("Create Today's Workout");
  });

  it('uses shared tier limits and clearly distinguishes free uploads from Pro connections', () => {
    const memberships = fixture.componentInstance.memberships;
    expect(memberships[0].features).toContain(`Up to ${USAGE_LIMITS.free} activities`);
    expect(memberships[0].features).toContain(`Up to ${ROUTE_USAGE_LIMITS.free} saved routes`);
    expect(memberships[1].features).toContain('Up to 1,000 activities');
    expect(memberships[1].features).toContain(`Up to ${ROUTE_USAGE_LIMITS.basic} saved routes`);
    expect(memberships[1].features).toContain(`Up to ${ASSISTANT_REQUEST_LIMITS.basic} Assistant requests per billing period`);
    expect(fixture.nativeElement.querySelectorAll('.membership-grid mat-card')).toHaveLength(3);
    expect(Array.from(fixture.nativeElement.querySelectorAll('.membership-grid h3'))
      .map((heading: Element) => heading.textContent)).toEqual(['Starter', 'Basic', 'Pro']);
    const steps = fixture.nativeElement.querySelector('.getting-started-steps');
    expect(steps.querySelectorAll('li')).toHaveLength(3);
    expect(steps.textContent).toContain('connect a supported provider with Pro');
    expect(fixture.nativeElement.querySelector('.membership-note').textContent).toContain('Paid prices');
  });

  it('opens and closes FAQ answers with one feedback owner and valid control targets', () => {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.faq-row button')) as HTMLButtonElement[];
    expect(buttons.every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(buttons.every(button => !!fixture.nativeElement.querySelector('#' + button.getAttribute('aria-controls')))).toBe(true);
    buttons[0].click();
    fixture.detectChanges();
    expect(buttons[0].getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('#home-faq-watch').hidden).toBe(false);
    expect(selection).toHaveBeenCalledOnce();
    buttons[1].click();
    fixture.detectChanges();
    expect(buttons[0].getAttribute('aria-expanded')).toBe('false');
    expect(buttons[1].getAttribute('aria-expanded')).toBe('true');
    buttons[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.expandedFaq()).toBeNull();
    expect(selection).toHaveBeenCalledTimes(3);
    fixture.componentInstance.toggleFaq('invalid');
    expect(selection).toHaveBeenCalledTimes(3);
  });

  it('defaults to Training with one complete feature visible and the other content retained', () => {
    const sections = Array.from(fixture.nativeElement.querySelectorAll('.home-feature-panels > section')) as HTMLElement[];
    expect(sections.filter(section => !section.hidden).map(section => section.id)).toEqual(['home-training']);
    expect(fixture.nativeElement.querySelector('#home-training').textContent).toContain('Build the Dashboard You Need');
    expect(fixture.nativeElement.querySelector('#home-training').textContent).not.toContain('Analyze Every Workout');
    expect(fixture.nativeElement.querySelector('#home-workouts').textContent).toContain('aerobic durability, and cadence versus power');
    expect(fixture.nativeElement.querySelector('#home-feature-panel .membership-section')).toBeNull();
    expect(selection).not.toHaveBeenCalled();
  });

  it.each(['training', 'workouts', 'plans', 'health', 'assistant', 'maps', 'comparisons', 'integrations'])(
    'selects %s from the desktop tabs and synchronizes the mobile control', async id => {
      const previews = fixture.nativeElement.querySelectorAll('app-public-feature-preview');
      fixture.nativeElement.querySelector(`.home-feature-tabs a[href="#home-${id}"]`).click();
      fixture.detectChanges();
      await fixture.whenStable();
      const sections = Array.from(fixture.nativeElement.querySelectorAll('.home-feature-panels > section')) as HTMLElement[];
      expect(sections.filter(section => !section.hidden).map(section => section.id)).toEqual(['home-' + id]);
      expect(fixture.debugElement.query(By.directive(MatSelect)).componentInstance.value).toBe(id);
      expect(fixture.nativeElement.querySelector(`a[href="#home-${id}"]`).getAttribute('aria-selected')).toBe('true');
      expect(Array.from(fixture.nativeElement.querySelectorAll('app-public-feature-preview'))).toEqual(Array.from(previews));
      expect(fixture.debugElement.queryAll(By.directive(PublicFeaturePreviewComponent))[0].componentInstance.activate()).toBe(true);
      if (id === 'training') expect(selection).not.toHaveBeenCalled();
      else {
        expect(selection).toHaveBeenCalledOnce();
        expect(location.path(true)).toBe('/#home-' + id);
      }
    },
  );

  it('uses the Material phone dropdown to select a complete feature with one haptic owner', async () => {
    const combobox = fixture.nativeElement.querySelector('.home-feature-select [role="combobox"]') as HTMLElement;
    combobox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const options = Array.from(overlay.querySelectorAll('[role="option"]')) as HTMLElement[];
    expect(options).toHaveLength(8);
    options.find(option => option.textContent?.trim() === 'Health')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(combobox.textContent).toContain('Health');
    expect(fixture.componentInstance.selectedFeature()).toBe('health');
    expect(fixture.nativeElement.querySelector('#home-health').hidden).toBe(false);
    expect(fixture.nativeElement.querySelectorAll('#home-health app-public-feature-preview')).toHaveLength(3);
    expect(selection).toHaveBeenCalledOnce();
  });

  it('restores direct feature links, query parameters and browser history without selection haptics', () => {
    fixture.destroy();
    location.go('/?source=homepage#home-plans');
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedFeature()).toBe('plans');
    expect(fixture.nativeElement.querySelector('#home-plans').hidden).toBe(false);
    expect(selection).not.toHaveBeenCalled();
    fixture.componentInstance.selectFeature('comparisons');
    fixture.detectChanges();
    expect(location.path(true)).toBe('/?source=homepage#home-comparisons');
    expect(selection).toHaveBeenCalledOnce();
    location.simulateUrlPop('/?source=homepage#home-plans');
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedFeature()).toBe('plans');
    location.simulateUrlPop('/?source=homepage#home-comparisons');
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedFeature()).toBe('comparisons');
    expect(selection).toHaveBeenCalledOnce();
  });

  it('keeps initialization, invalid and unchanged selections silent and cleans up history listeners', () => {
    const component = fixture.componentInstance;
    component.selectFeature('training');
    component.selectFeature('invalid');
    expect(location.path(true)).toBe('');
    expect(selection).not.toHaveBeenCalled();
    location.simulateUrlPop('/#unknown');
    fixture.detectChanges();
    expect(component.selectedFeature()).toBe('training');
    fixture.destroy();
    location.simulateUrlPop('/#home-health');
    expect(component.selectedFeature()).toBe('training');
  });

  it('preserves modified feature links and leaves public-route haptics to the shell', () => {
    const event = new MouseEvent('click', { ctrlKey: true, cancelable: true });
    fixture.componentInstance.selectFeature('health', event);
    expect(event.defaultPrevented).toBe(false);
    expect(fixture.componentInstance.selectedFeature()).toBe('training');
    expect(selection).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('a[href="/features/training-analysis"]').hasAttribute('appHapticTap')).toBe(false);
    expect(fixture.debugElement.queryAll(By.directive(MatTooltip))
      .every(host => host.injector.get(MatTooltip).touchGestures === 'off')).toBe(true);
  });

  it('waits for the shared overview to render before scrolling to a selected feature', async () => {
    const panel = fixture.nativeElement.querySelector('#home-feature-panel') as HTMLElement;
    const scrollIntoView = vi.fn();
    panel.scrollIntoView = scrollIntoView;
    fixture.componentInstance.selectFeature('comparisons');
    fixture.detectChanges();
    expect(scrollIntoView).not.toHaveBeenCalled();
    const [heroBlock] = await fixture.getDeferBlocks();
    await heroBlock.render(DeferBlockState.Complete);
    fixture.detectChanges();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
    expect(selection).toHaveBeenCalledOnce();
  });
});
