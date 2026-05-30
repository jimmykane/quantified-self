import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PublicSeoPageComponent } from './public-seo-page.component';
import { PUBLIC_SEO_PAGES, PublicSeoPage } from './public-seo-pages.content';

describe('PublicSeoPageComponent', () => {
  let fixture: ComponentFixture<PublicSeoPageComponent>;
  let routeStub: { snapshot: { data: { publicSeoPage: PublicSeoPage } } };

  beforeEach(async () => {
    routeStub = {
      snapshot: {
        data: {
          publicSeoPage: PUBLIC_SEO_PAGES.workoutFileComparison,
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
    expect(faqItems.length).toBe(3);
    expect(text).toContain('Compare FIT, TCX, GPX, JSON, and SML workout files');
    expect(text).toContain('Manual uploads and benchmark comparisons are available on the free plan');
    expect(text).toContain('custom exports');
    expect(text).toContain('Provider data beside files');
    expect(text).toContain('Workout File Comparison FAQ');
    expect(fixture.nativeElement.querySelector('.how-to-list')).toBeNull();
    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/features/workout-data-comparison');
    expect(hrefs).toContain('/help#uploads-and-imports');
    expect(hrefs).toContain('/features/sports-watch-benchmark');
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
});
