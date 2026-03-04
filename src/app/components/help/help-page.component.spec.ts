import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { HelpPageComponent } from './help-page.component';
import { HELP_ACTIONS, HELP_SECTIONS } from '../../shared/help.content';

describe('HelpPageComponent', () => {
  let component: HelpPageComponent;
  let fixture: ComponentFixture<HelpPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HelpPageComponent, RouterTestingModule.withRoutes([]), NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(HelpPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the hero title and all section titles', () => {
    const title = fixture.debugElement.query(By.css('.hero-title'))?.nativeElement as HTMLElement | undefined;
    expect(title?.textContent).toContain('Help for setup, uploads, billing, and integrations.');

    const renderedTitles = fixture.debugElement
      .queryAll(By.css('.section-card mat-card-title'))
      .map(node => node.nativeElement.textContent.trim());

    expect(renderedTitles).toEqual(HELP_SECTIONS.map(section => section.title));
  });

  it('should render all global support actions', () => {
    const actionButtons = fixture.debugElement.queryAll(By.css('.support-actions[aria-label="Support actions"] a'));
    expect(actionButtons).toHaveLength(HELP_ACTIONS.length);

    HELP_ACTIONS.forEach(action => {
      const matchingNode = actionButtons.find(node => node.nativeElement.textContent.includes(action.label));
      expect(matchingNode).toBeTruthy();
    });
  });

  it('should scroll to the selected section from the quick navigation list', () => {
    const scrollToSectionSpy = vi.spyOn(component, 'scrollToSection');
    const navButtons = fixture.debugElement.queryAll(By.css('.section-nav button'));

    expect(navButtons).toHaveLength(HELP_SECTIONS.length);
    navButtons[0].triggerEventHandler('click', new MouseEvent('click'));

    expect(scrollToSectionSpy).toHaveBeenCalledWith(HELP_SECTIONS[0].id);
  });

  it('should render section card ids correctly', () => {
    const sectionCards = fixture.debugElement.queryAll(By.css('.section-card'));
    expect(sectionCards).toHaveLength(HELP_SECTIONS.length);

    sectionCards.forEach((node, index) => {
      expect(node.attributes['id']).toBe(HELP_SECTIONS[index].id);
    });
  });

  it('should render internal links without target blank and external links with target blank', () => {
    const loginLink = fixture.debugElement
      .queryAll(By.css('a'))
      .find(node => node.nativeElement.textContent.includes('Login'));
    expect(loginLink?.attributes['href']).toContain('/login');
    expect(loginLink?.attributes['target']).toBeUndefined();

    const policiesLink = fixture.debugElement
      .queryAll(By.css('.support-actions[aria-label="Support actions"] a'))
      .find(node => node.nativeElement.textContent.includes('Policies'));
    expect(policiesLink?.attributes['href']).toContain('/policies');
    expect(policiesLink?.attributes['target']).toBeUndefined();

    const emailLink = fixture.debugElement
      .queryAll(By.css('.support-actions[aria-label="Support actions"] a'))
      .find(node => node.nativeElement.textContent.includes('Email Support'));
    expect(emailLink?.attributes['href']).toContain('mailto:');
    expect(emailLink?.attributes['target']).toBe('_blank');

    const bugLink = fixture.debugElement
      .queryAll(By.css('a'))
      .find(node => node.nativeElement.textContent.includes('Report a Bug'));
    expect(bugLink?.attributes['href']).toContain('github.com/jimmykane/quantified-self/issues');
    expect(bugLink?.attributes['target']).toBe('_blank');
  });

  it('should scroll to hash section on refresh render', () => {
    const targetId = HELP_SECTIONS[2].id;
    const targetElement = fixture.nativeElement.querySelector(`#${targetId}`) as HTMLElement;
    const scrollSpy = vi.fn();
    Object.defineProperty(targetElement, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback): number => {
      callback(0);
      return 0;
    });

    window.history.replaceState(null, '', `/help#${targetId}`);
    component.ngAfterViewInit();

    expect(scrollSpy).toHaveBeenCalled();

    rafSpy.mockRestore();
    window.history.replaceState(null, '', '/help');
  });
});
