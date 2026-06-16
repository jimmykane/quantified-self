import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaterialModule } from '../../modules/material.module';
import { AppAuthService } from '../../authentication/app.auth.service';
import { PoliciesComponent } from './policies.component';

describe('PoliciesComponent', () => {
  let fixture: ComponentFixture<PoliciesComponent>;
  let component: PoliciesComponent;
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const scrollIntoViewMock = vi.fn();

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
      writable: true,
    });
  });

  beforeEach(async () => {
    scrollIntoViewMock.mockReset();
    window.history.replaceState(null, '', '/policies');

    await TestBed.configureTestingModule({
      declarations: [PoliciesComponent],
      imports: [MaterialModule, RouterTestingModule.withRoutes([]), NoopAnimationsModule],
      providers: [
        { provide: AppAuthService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PoliciesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
      writable: true,
    });
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders connected-services anchors and provider sections', () => {
    const anchorLinks = fixture.debugElement.queryAll(By.css('.policy-anchor-link'));
    const renderedAnchorLabels = anchorLinks.map(link => `${link.nativeElement.textContent || ''}`.trim());

    expect(renderedAnchorLabels.some(label => label.includes('Overview'))).toBe(true);
    expect(renderedAnchorLabels.some(label => label.includes('Garmin'))).toBe(true);
    expect(renderedAnchorLabels.some(label => label.includes('Suunto'))).toBe(true);
    expect(renderedAnchorLabels.some(label => label.includes('COROS'))).toBe(true);
    expect(renderedAnchorLabels.some(label => label.includes('AI & Processors'))).toBe(true);

    expect(fixture.nativeElement.querySelector('#connected-services-data')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#garmin-data')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#suunto-data')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#coros-data')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#ai-and-third-party-processing')).toBeTruthy();
  });

  it('renders connected-services anchor buttons as policies-route fragment links', () => {
    const garminLink = fixture.debugElement.queryAll(By.css('.policy-anchor-link'))
      .find(link => `${link.nativeElement.textContent || ''}`.includes('Garmin'));

    expect(garminLink?.nativeElement.getAttribute('href')).toContain('/policies#garmin-data');
  });

  it('renders the current AI provider disclosure', () => {
    const sectionCopy = fixture.nativeElement.textContent as string;

    expect(sectionCopy).toContain('Google GenAI / Gemini');
    expect(sectionCopy).toContain('uploaded FIT/GPX/TCX/JSON/SML files');
    expect(sectionCopy).toContain('not sent to the AI provider');
  });

  it('scrolls to the requested fragment on first render', async () => {
    window.history.replaceState(null, '', '/policies#garmin-data');

    const secondFixture = TestBed.createComponent(PoliciesComponent);
    secondFixture.detectChanges();
    await secondFixture.whenStable();

    expect(scrollIntoViewMock).toHaveBeenCalled();

    secondFixture.destroy();
    window.history.replaceState(null, '', '/policies');
  });
});
