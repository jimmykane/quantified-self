import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, expect, it, beforeEach } from 'vitest';
import { HelpPageComponent } from './help-page.component';
import { HELP_ACTIONS, HELP_SECTIONS } from '../../shared/help.content';

describe('HelpPageComponent', () => {
  let component: HelpPageComponent;
  let fixture: ComponentFixture<HelpPageComponent>;

  beforeEach(async () => {
    window.history.replaceState(null, '', '/help');

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
    expect(title?.textContent).toContain('Help for AI Insights, setup, uploads, billing, and integrations.');

    const renderedTabLabels = fixture.debugElement
      .queryAll(By.css('.tab-label'))
      .map(node => `${node.nativeElement.textContent || ''}`.trim());

    HELP_SECTIONS.forEach(section => {
      expect(renderedTabLabels.some(label => label.includes(section.title))).toBe(true);
    });
  });

  it('should render all global support actions', () => {
    const actionButtons = fixture.debugElement.queryAll(By.css('mat-nav-list[aria-label="Support actions"] a'));
    expect(actionButtons).toHaveLength(HELP_ACTIONS.length);

    HELP_ACTIONS.forEach(action => {
      const matchingNode = actionButtons.find(node => node.nativeElement.textContent.includes(action.label));
      expect(matchingNode).toBeTruthy();
    });
  });

  it('should switch section and set URL fragment from quick navigation', () => {
    const targetSectionId = HELP_SECTIONS[1].id;
    component.onSectionTabChange(1);

    expect(component.selectedSectionId).toBe(targetSectionId);
    expect(window.location.hash).toBe(`#${targetSectionId}`);
  });

  it('should render selected section content and switch section by tab index', () => {
    const sectionCard = fixture.debugElement.query(By.css('#help-section-content'));
    expect(sectionCard).toBeTruthy();
    expect(component.selectedSection.id).toBe(HELP_SECTIONS[0].id);

    component.onSectionTabChange(2);
    fixture.detectChanges();

    expect(component.selectedSection.id).toBe(HELP_SECTIONS[2].id);
    const selectedTitle = fixture.debugElement.query(By.css('#help-section-content mat-card-title'))?.nativeElement as HTMLElement | undefined;
    expect(selectedTitle?.textContent).toContain(HELP_SECTIONS[2].title);
  });

  it('should render internal links without target blank and external links with target blank', () => {
    component.onSectionTabChange(0);
    fixture.detectChanges();

    const loginLink = fixture.debugElement
      .queryAll(By.css('a'))
      .find(node => node.nativeElement.textContent.includes('Login'));
    expect(loginLink?.attributes['href']).toContain('/login');
    expect(loginLink?.attributes['target']).toBeUndefined();

    const policiesLink = fixture.debugElement
      .queryAll(By.css('mat-nav-list[aria-label="Support actions"] a'))
      .find(node => node.nativeElement.textContent.includes('Policies'));
    expect(policiesLink?.attributes['href']).toContain('/policies');
    expect(policiesLink?.attributes['target']).toBeUndefined();

    const emailLink = fixture.debugElement
      .queryAll(By.css('mat-nav-list[aria-label="Support actions"] a'))
      .find(node => node.nativeElement.textContent.includes('Email Support'));
    expect(emailLink?.attributes['href']).toContain('mailto:');
    expect(emailLink?.attributes['target']).toBe('_blank');

    const bugLink = fixture.debugElement
      .queryAll(By.css('a'))
      .find(node => node.nativeElement.textContent.includes('Report a Bug'));
    expect(bugLink?.attributes['href']).toContain('github.com/jimmykane/quantified-self/issues');
    expect(bugLink?.attributes['target']).toBe('_blank');
  });

  it('should select section from URL fragment on refresh render', async () => {
    const targetId = HELP_SECTIONS[2].id;
    window.history.replaceState(null, '', `/help#${targetId}`);
    const secondFixture = TestBed.createComponent(HelpPageComponent);
    const secondComponent = secondFixture.componentInstance;
    secondFixture.detectChanges();
    await secondFixture.whenStable();

    expect(secondComponent.selectedSectionId).toBe(targetId);

    secondFixture.destroy();
    window.history.replaceState(null, '', '/help');
  });
});
