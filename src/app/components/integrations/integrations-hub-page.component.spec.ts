import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { IntegrationsHubPageComponent } from './integrations-hub-page.component';
import { AppEventService } from '../../services/app.event.service';

describe('IntegrationsHubPageComponent', () => {
  let fixture: ComponentFixture<IntegrationsHubPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        IntegrationsHubPageComponent,
        RouterTestingModule.withRoutes([]),
        NoopAnimationsModule,
        MatIconTestingModule,
      ],
      providers: [
        { provide: AppEventService, useValue: { getEventMetaDataKeys: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IntegrationsHubPageComponent);
    fixture.detectChanges();
  });

  it('should render the integration hub headline and provider cards', () => {
    const text = fixture.nativeElement.textContent as string;
    const cards = fixture.nativeElement.querySelectorAll('.integration-card');

    expect(cards.length).toBe(4);
    expect(text).toContain('Integrations for Garmin, Suunto, COROS, and Wahoo');
    expect(text).toContain('Garmin Integration');
    expect(text).toContain('Suunto Integration');
    expect(text).toContain('COROS Integration');
    expect(text).toContain('Wahoo Integration');
    expect(text).toContain('centralize Garmin, Suunto, COROS, and Wahoo workout data');
    expect(text).toContain('Compare workout data across devices');
    expect(text).toContain('benchmark reports, metric overlays, source files, and reviewer-ready exports');
    expect(text).toContain('Set up the connection you need');
    expect(text).toContain('Garmin to Suunto activity sync, COROS to Suunto');
    expect(text).toContain('Private dashboard, history import, and Suunto sync');
    expect(text).toContain('Activity sync, route imports, and sending routes to Garmin');
    expect(text).toContain('Send Suunto routes to Garmin');
    expect(text).toContain('sending Suunto routes to Garmin');
    expect(text).toContain('Recent history import and Suunto sync');
  });

  it('should link to each provider integration page', () => {
    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const hrefs = links.map(link => link.getAttribute('href') ?? '');

    expect(hrefs).toContain('/integrations/garmin');
    expect(hrefs).toContain('/integrations/suunto');
    expect(hrefs).toContain('/integrations/coros');
    expect(hrefs).toContain('/integrations/wahoo');
    expect(hrefs).toContain('/features');
    expect(hrefs).toContain('/features/workout-data-comparison');
    expect(hrefs).toContain('/features/workout-file-comparison');
    expect(hrefs).toContain('/features/fit-gpx-tcx-file-analyzer');
    expect(hrefs).toContain('/features/sports-watch-benchmark');
    expect(hrefs).toContain('/guides');
    expect(hrefs).toContain('/guides/sync-garmin-to-suunto');
    expect(hrefs).toContain('/guides/sync-coros-to-suunto');
    expect(hrefs).toContain('/guides/sync-suunto-routes-to-garmin-courses');
    expect(hrefs).toContain('/guides/centralize-garmin-suunto-coros-workout-data');
    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/help#service-connections');
  });
});
