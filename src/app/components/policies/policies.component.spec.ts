import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
      imports: [MatCardModule, MatIconModule, RouterTestingModule.withRoutes([]), NoopAnimationsModule],
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
    expect(component.pagePath).toBe('/policies');
    expect(component.pageTitle).toBe('Legal & Privacy');
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
    expect(sectionCopy).toContain('latest six completed conversation turns');
    expect(sectionCopy).toContain('Original FIT/GPX/TCX/JSON/SML files');
    expect(sectionCopy).toContain('unavailable to the Assistant');
    expect(sectionCopy).toContain('becomes unavailable about seven days after');
    expect(sectionCopy).toContain('displayed geographic tile area');
    expect(sectionCopy).toContain('server-advertised visual source');
    expect(sectionCopy).toContain('at most four extra minutes');
    expect(sectionCopy).toContain('Firestore TTL then deletes it asynchronously');
  });

  it('renders public controller and contact details', () => {
    const sectionCopy = fixture.nativeElement.textContent as string;

    expect(sectionCopy).toContain('Dimitrios Kanellopoulos');
    expect(sectionCopy).toContain('Kaloudi 15');
    expect(sectionCopy).toContain('45500 Ioannina');
    expect(sectionCopy).toContain('privacy@quantified-self.io');
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
