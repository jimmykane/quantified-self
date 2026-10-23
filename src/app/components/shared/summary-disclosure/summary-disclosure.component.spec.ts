import { Component, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { SummaryDisclosureComponent } from './summary-disclosure.component';

@Component({ standalone: true, imports: [SummaryDisclosureComponent, NgTemplateOutlet], template: `
  <ng-template #overview let-detailsControl="detailsControl">
    <div class="inline-overview"><span>Source and coverage stay visible</span><ng-container [ngTemplateOutlet]="detailsControl" /></div>
  </ng-template>
  <app-summary-disclosure title="Before & after" summaryId="sample" [scopeKey]="scope()" headline="Recorded differences"
    [variant]="variant()" [headingLevel]="headingLevel()" [detailsAvailable]="details()" [plainOverviewTemplate]="inline() ? overview : null">
    <p summaryOverview>Source and coverage stay visible</p>
    <p summaryDetails>Before and after readings</p>
  </app-summary-disclosure>` })
class ProjectedSummaryHost {
  readonly scope = signal('fixture');
  readonly details = signal(true);
  readonly variant = signal<'flat' | 'rail' | 'plain'>('rail');
  readonly inline = signal(false);
  readonly headingLevel = signal<2 | 3 | 4>(2);
}

describe('shared summary disclosure shell', () => {
  async function render() {
    const haptics = { selection: vi.fn() };
    await TestBed.configureTestingModule({ imports: [ProjectedSummaryHost], providers: [
      { provide: AppHapticsService, useValue: haptics },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(ProjectedSummaryHost);
    fixture.detectChanges();
    const shell = fixture.debugElement.query(By.directive(SummaryDisclosureComponent)).componentInstance as SummaryDisclosureComponent;
    return { fixture, shell, host: fixture.nativeElement as HTMLElement, haptics };
  }
  it('projects visible evidence and hidden details under one accessible neutral heading without initial feedback', async () => {
    const { host, haptics } = await render();
    expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe('sample-title');
    expect(host.querySelector('#sample-title')?.textContent).toBe('Before & after');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Recorded differences');
    expect(host.querySelector('[summaryOverview]')?.closest('[hidden]')).toBeNull();
    expect(host.querySelector<HTMLElement>('#sample-details')?.hidden).toBe(true);
    expect(host.querySelector('section')?.getAttribute('data-tone')).toBe('neutral');
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it.each(['flat', 'rail'] as const)('keeps the %s Material disclosure in its heading with one feedback owner', async variant => {
    const { fixture, host, haptics } = await render();
    fixture.componentInstance.variant.set(variant); fixture.detectChanges();
    const button = host.querySelector('button')!;
    expect(button.closest('.summary-disclosure-heading')).not.toBeNull();
    expect(host.querySelector('.summary-disclosure-footer')).toBeNull();
    expect(button.getAttribute('aria-controls')).toBe('sample-details');
    button.click(); fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector<HTMLElement>('#sample-details')?.hidden).toBe(false);
    expect(haptics.selection).toHaveBeenCalledOnce();
    button.click(); fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });
  it('resets silently for a new owner or comparison scope', async () => {
    const { fixture, shell, host, haptics } = await render();
    shell.toggleDetails(); fixture.detectChanges();
    fixture.componentInstance.scope.set('another-owner:another-note'); fixture.detectChanges();
    expect(shell.expanded()).toBe(false);
    expect(host.querySelector<HTMLElement>('#sample-details')?.hidden).toBe(true);
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('closes unavailable details silently and ignores actions when no details exist', async () => {
    const { fixture, shell, host, haptics } = await render();
    shell.toggleDetails(); fixture.detectChanges();
    fixture.componentInstance.details.set(false); fixture.detectChanges();
    expect(shell.expanded()).toBe(false); expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('#sample-details')).toBeNull();
    shell.toggleDetails(); expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentInstance.details.set(true); fixture.detectChanges();
    expect(host.querySelector<HTMLElement>('#sample-details')?.hidden).toBe(true);
    expect(host.querySelector('#sample-details')?.textContent).toContain('Before and after readings');
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('keeps one headline in flat mode and resets the disclosure on a presentation change', async () => {
    const { fixture, shell, host, haptics } = await render();
    shell.toggleDetails(); fixture.detectChanges();
    fixture.componentInstance.variant.set('flat'); fixture.detectChanges();
    expect(shell.expanded()).toBe(false);
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(host.querySelector('section')?.hasAttribute('data-tone')).toBe(false);
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('keeps one correctly nested heading when reused within a public feature preview', async () => {
    const { fixture, host } = await render();
    fixture.componentInstance.headingLevel.set(4); fixture.detectChanges();
    expect(host.querySelector('h2')).toBeNull();
    expect(host.querySelectorAll('h4')).toHaveLength(1);
    expect(host.querySelector('h4')?.id).toBe('sample-title');
  });
  it('keeps only the disclosure control and projected readings in plain mode', async () => {
    const { fixture, host, haptics } = await render();
    fixture.componentInstance.variant.set('plain'); fixture.detectChanges();
    const section = host.querySelector('section')!;
    expect(section.classList.contains('summary-disclosure-plain')).toBe(true);
    expect(section.getAttribute('aria-label')).toBe('Before & after');
    expect(section.hasAttribute('aria-labelledby')).toBe(false);
    expect(host.querySelector('h2, h3, h4, [role="status"]')).toBeNull();
    expect(host.textContent).not.toContain('Before & after');
    expect(host.textContent).not.toContain('Recorded differences');
    expect(host.querySelector('[summaryOverview]')?.closest('[hidden]')).toBeNull();
    const button = host.querySelector('button')!;
    const overview = host.querySelector('[summaryOverview]')!;
    const details = host.querySelector('#sample-details')!;
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(section.lastElementChild).toBe(button.closest('.summary-disclosure-footer'));
    expect(overview.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.textContent).toContain('Show details');
    button.click(); fixture.detectChanges();
    expect(button.textContent).toContain('Hide details');
    expect(button.getAttribute('aria-controls')).toBe('sample-details');
    expect(host.querySelector<HTMLElement>('#sample-details')?.hidden).toBe(false);
    expect(section.lastElementChild).toBe(button.closest('.summary-disclosure-footer'));
    expect(haptics.selection).toHaveBeenCalledOnce();
    button.click(); fixture.detectChanges();
    expect(host.querySelector<HTMLElement>('#sample-details')?.hidden).toBe(true);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('reuses one accessible plain control inside the overview without a footer row', async () => {
    const { fixture, host, haptics } = await render();
    fixture.componentInstance.variant.set('plain'); fixture.componentInstance.inline.set(true); fixture.detectChanges();
    expect(host.querySelector('.summary-disclosure-footer')).toBeNull();
    expect(host.querySelectorAll('button')).toHaveLength(1);
    const button = host.querySelector<HTMLButtonElement>('.inline-overview button')!;
    expect(button.getAttribute('aria-controls')).toBe('sample-details');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(haptics.selection).not.toHaveBeenCalled();
    button.click(); fixture.detectChanges();
    expect(button.textContent).toContain('Hide details');
    expect(host.querySelector<HTMLElement>('#sample-details')?.hidden).toBe(false);
    expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentInstance.scope.set('another-recording'); fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentInstance.details.set(false); fixture.detectChanges();
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('#sample-details')).toBeNull();
  });
});
