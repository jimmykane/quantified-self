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

    expect(cards.length).toBe(3);
    expect(text).toContain('Integrations for Garmin, Suunto, and COROS');
    expect(text).toContain('Garmin Integration');
    expect(text).toContain('Suunto Integration');
    expect(text).toContain('COROS Integration');
    expect(text).toContain('centralize Garmin Suunto and COROS workout data');
  });

  it('should link to each provider integration page', () => {
    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const hrefs = links.map(link => link.getAttribute('href') ?? '');

    expect(hrefs).toContain('/integrations/garmin');
    expect(hrefs).toContain('/integrations/suunto');
    expect(hrefs).toContain('/integrations/coros');
    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/help#service-connections');
  });
});
