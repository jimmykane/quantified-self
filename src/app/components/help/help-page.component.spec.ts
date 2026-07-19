import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';
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

  it('renders the documentation home with every topic and quick action', () => {
    const title = fixture.debugElement.query(By.css('.hero-title'))?.nativeElement as HTMLElement | undefined;
    expect(title?.textContent).toContain('How can we help?');

    const topicCards = fixture.debugElement.queryAll(By.css('.topic-card'));
    expect(topicCards).toHaveLength(HELP_SECTIONS.length);

    HELP_SECTIONS.forEach(section => {
      expect(topicCards.some(card => card.nativeElement.textContent.includes(section.title))).toBe(true);
    });

    const quickActions = fixture.debugElement.queryAll(By.css('.quick-action'));
    expect(quickActions).toHaveLength(HELP_ACTIONS.length);
  });

  it('opens an article from the documentation home and updates the URL fragment', () => {
    const targetSection = HELP_SECTIONS[2];
    component.openSection(targetSection.id);
    fixture.detectChanges();

    expect(component.selectedSectionId()).toBe(targetSection.id);
    expect(component.isArticleOpen()).toBe(true);
    expect(window.location.hash).toBe(`#${targetSection.id}`);

    const selectedTitle = fixture.debugElement.query(By.css('#help-section-content mat-card-title'))?.nativeElement as HTMLElement | undefined;
    expect(selectedTitle?.textContent).toContain(targetSection.title);
  });

  it('returns from an article to the documentation home', () => {
    component.openSection('uploads-and-imports');
    component.returnToHelpCenter();
    fixture.detectChanges();

    expect(component.isArticleOpen()).toBe(false);
    expect(component.selectedSectionId()).toBeNull();
    expect(window.location.hash).toBe('');
    expect(fixture.debugElement.query(By.css('.topic-grid'))).toBeTruthy();
  });

  it('searches documentation by title and opens the matching guide', () => {
    component.onSearchQueryChange('connected services');
    fixture.detectChanges();

    expect(component.searchResults()[0]?.id).toBe('service-connections');
    expect(fixture.debugElement.queryAll(By.css('.search-result'))).not.toHaveLength(0);

    component.openSection('service-connections');
    fixture.detectChanges();

    expect(component.selectedSection().title).toBe('Connected Services');
  });

  it('renders deterministic AI FAQ guidance in the AI Insights article', async () => {
    component.openSection('ai-insights');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      fixture.detectChanges();
      if (component.renderedSectionContent()['ai-insights']) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const sectionCopy = fixture.debugElement.query(By.css('#help-section-content .section-copy'))?.nativeElement as HTMLElement | undefined;
    expect(sectionCopy?.innerHTML).toContain('Why do I get the same answer for the same prompt?');
    expect(sectionCopy?.innerHTML).toContain('mostly deterministic');
    expect(sectionCopy?.innerHTML).toContain('new activities');
    expect(sectionCopy?.innerHTML).toContain('deterministic period deltas with likely contributor series');
  });

  it('renders internal links without target blank and external links with target blank', () => {
    component.openSection('getting-started');
    fixture.detectChanges();

    const loginLink = fixture.debugElement
      .queryAll(By.css('a'))
      .find(node => node.nativeElement.textContent.includes('Login'));
    expect(loginLink?.attributes['href']).toContain('/login');
    expect(loginLink?.attributes['target']).toBeUndefined();

    const emailLink = fixture.debugElement
      .queryAll(By.css('a'))
      .find(node => node.nativeElement.textContent.includes('Email Support'));
    expect(emailLink?.attributes['href']).toContain('mailto:');
    expect(emailLink?.attributes['target']).toBe('_blank');

    component.returnToHelpCenter();
    fixture.detectChanges();
    const bugLink = fixture.debugElement
      .queryAll(By.css('.quick-action'))
      .find(node => node.nativeElement.textContent.includes('Report a Bug'));
    expect(bugLink?.attributes['href']).toContain('github.com/jimmykane/quantified-self/issues');
    expect(bugLink?.attributes['target']).toBe('_blank');
  });

  it('opens the article selected by a URL fragment on initial render', async () => {
    const targetId = HELP_SECTIONS[2].id;
    window.history.replaceState(null, '', `/help#${targetId}`);
    const secondFixture = TestBed.createComponent(HelpPageComponent);
    const secondComponent = secondFixture.componentInstance;
    secondFixture.detectChanges();
    await secondFixture.whenStable();

    expect(secondComponent.selectedSectionId()).toBe(targetId);
    expect(secondComponent.isArticleOpen()).toBe(true);

    secondFixture.destroy();
    window.history.replaceState(null, '', '/help');
  });
});
