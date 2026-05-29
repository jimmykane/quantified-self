import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ProviderIntegrationPageComponent } from './provider-integration-page.component';
import { AppEventService } from '../../services/app.event.service';
import { IntegrationProviderKey } from './integration-pages.content';

describe('ProviderIntegrationPageComponent', () => {
  let routeStub: { snapshot: { data: { integrationProvider: IntegrationProviderKey } } };

  beforeEach(async () => {
    routeStub = {
      snapshot: {
        data: {
          integrationProvider: 'suunto',
        },
      },
    };

    await TestBed.configureTestingModule({
      imports: [
        ProviderIntegrationPageComponent,
        RouterTestingModule.withRoutes([]),
        NoopAnimationsModule,
        MatIconTestingModule,
      ],
      providers: [
        { provide: ActivatedRoute, useValue: routeStub },
        { provide: AppEventService, useValue: { getEventMetaDataKeys: vi.fn() } },
      ],
    }).compileComponents();
  });

  function renderProvider(provider: IntegrationProviderKey): ComponentFixture<ProviderIntegrationPageComponent> {
    routeStub.snapshot.data.integrationProvider = provider;
    const fixture = TestBed.createComponent(ProviderIntegrationPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('should render Garmin integration content and private dashboard search intent', () => {
    const fixture = renderProvider('garmin');
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Garmin Integration and Private Training Dashboard');
    expect(text).toContain('private training dashboard for Garmin data');
    expect(text).toContain('Garmin -> Suunto automatic sync');
    expect(text).toContain('centralize Garmin, Suunto, and COROS workout data');
  });

  it('should render Suunto integration content and sync workflows', () => {
    const fixture = renderProvider('suunto');
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Suunto Integration for Garmin and COROS Sync');
    expect(text).toContain('How to sync Garmin and COROS data to Suunto automatically');
    expect(text).toContain('FIT activity upload');
    expect(text).toContain('GPX route upload');
  });

  it('should render COROS integration content and provider limits', () => {
    const fixture = renderProvider('coros');
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('COROS Integration for Suunto Sync and Centralized Training Data');
    expect(text).toContain('COROS -> Suunto automatic sync');
    expect(text).toContain('COROS history import');
    expect(text).toContain('centralize Garmin, Suunto, and COROS workout data');
  });

  it('should expose public CTAs, support links, and the integrations hub link', () => {
    const fixture = renderProvider('garmin');
    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const hrefs = links.map(link => link.getAttribute('href') ?? '');

    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/pricing');
    expect(hrefs).toContain('/integrations');
    expect(hrefs).toContain('/features/workout-data-comparison');
    expect(hrefs).toContain('/help#service-connections');
  });
});
