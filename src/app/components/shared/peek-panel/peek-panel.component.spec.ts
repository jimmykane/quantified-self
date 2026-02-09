import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PeekPanelComponent } from './peek-panel.component';

@Component({
  template: `
    <app-peek-panel
      [position]="position"
      [topAnchor]="topAnchor"
      [toggleThicknessSize]="toggleThicknessSize"
      [toggleLengthSize]="toggleLengthSize"
      [toggleSize]="toggleSize"
      [borderMode]="borderMode"
      [expanded]="expanded"
      [defaultExpanded]="defaultExpanded"
      [expandedSizePx]="expandedSizePx"
      [collapsedSizePx]="collapsedSizePx"
      [ariaLabelExpand]="ariaLabelExpand"
      [ariaLabelCollapse]="ariaLabelCollapse"
      (expandedChange)="onExpandedChange($event)"
    >
      <div peek-header class="header-content">Header</div>
      <div class="body-content">Body</div>
    </app-peek-panel>
  `,
  standalone: false
})
class HostComponent {
  position: 'top' | 'left' | 'right' = 'left';
  topAnchor: 'left' | 'center' | 'right' = 'center';
  toggleThicknessSize: 'auto' | 'small' | 'medium' | 'large' = 'auto';
  toggleLengthSize: 'auto' | 'small' | 'medium' | 'large' = 'auto';
  toggleSize: 'auto' | 'small' | 'medium' | 'large' = 'auto';
  borderMode: 'panel' | 'content' | 'none' = 'panel';
  expanded: boolean | undefined = undefined;
  defaultExpanded = false;
  expandedSizePx = 320;
  collapsedSizePx = 44;
  ariaLabelExpand = 'Open panel';
  ariaLabelCollapse = 'Close panel';
  expandedEvents: boolean[] = [];

  onExpandedChange(next: boolean): void {
    this.expandedEvents.push(next);
  }
}

describe('PeekPanelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [PeekPanelComponent, HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('toggles internal state in uncontrolled mode', () => {
    host.expanded = undefined;
    host.defaultExpanded = false;
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.peek-toggle') as HTMLButtonElement;
    const panel = fixture.nativeElement.querySelector('.peek-panel') as HTMLElement;

    expect(panel.classList.contains('collapsed')).toBe(true);
    toggle.click();
    fixture.detectChanges();

    expect(panel.classList.contains('expanded')).toBe(true);
    expect(host.expandedEvents).toEqual([true]);
  });

  it('emits changes without mutating visual state in controlled mode', () => {
    host.expanded = false;
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.peek-toggle') as HTMLButtonElement;
    const panel = fixture.nativeElement.querySelector('.peek-panel') as HTMLElement;

    expect(panel.classList.contains('collapsed')).toBe(true);
    toggle.click();
    fixture.detectChanges();

    expect(host.expandedEvents).toEqual([true]);
    expect(panel.classList.contains('collapsed')).toBe(true);
  });

  it('applies position classes', () => {
    const panel = fixture.nativeElement.querySelector('.peek-panel') as HTMLElement;

    host.position = 'left';
    fixture.detectChanges();
    expect(panel.classList.contains('position-left')).toBe(true);

    host.position = 'right';
    fixture.detectChanges();
    expect(panel.classList.contains('position-right')).toBe(true);

    host.position = 'top';
    fixture.detectChanges();
    expect(panel.classList.contains('position-top')).toBe(true);
  });

  it('applies top anchor class', () => {
    const panel = fixture.nativeElement.querySelector('.peek-panel') as HTMLElement;

    host.position = 'top';
    host.topAnchor = 'center';
    fixture.detectChanges();

    expect(panel.classList.contains('top-anchor-center')).toBe(true);
  });

  it('uses shared glass-card styling class', () => {
    const panel = fixture.nativeElement.querySelector('.peek-panel') as HTMLElement;
    expect(panel.classList.contains('glass-card')).toBe(true);
  });

  it('supports optional border mode for content border rendering', () => {
    const panel = fixture.nativeElement.querySelector('.peek-panel') as HTMLElement;

    host.borderMode = 'content';
    fixture.detectChanges();
    expect(panel.classList.contains('border-mode-content')).toBe(true);
    expect(panel.classList.contains('border-mode-panel')).toBe(false);

    host.borderMode = 'panel';
    fixture.detectChanges();
    expect(panel.classList.contains('border-mode-panel')).toBe(true);
    expect(panel.classList.contains('border-mode-content')).toBe(false);
  });

  it('supports no-border rendering mode', () => {
    const panel = fixture.nativeElement.querySelector('.peek-panel') as HTMLElement;

    host.borderMode = 'none';
    fixture.detectChanges();
    expect(panel.classList.contains('border-mode-none')).toBe(true);
    expect(panel.classList.contains('border-mode-panel')).toBe(false);
    expect(panel.classList.contains('border-mode-content')).toBe(false);
  });

  it('supports toggle thickness size presets', () => {
    const panel = fixture.nativeElement.querySelector('.peek-panel') as HTMLElement;

    host.toggleThicknessSize = 'small';
    fixture.detectChanges();
    expect(panel.classList.contains('toggle-thickness-small')).toBe(true);
    expect(panel.style.getPropertyValue('--peek-collapsed-size')).toBe('18px');

    host.toggleThicknessSize = 'large';
    fixture.detectChanges();
    expect(panel.classList.contains('toggle-thickness-large')).toBe(true);
    expect(panel.style.getPropertyValue('--peek-collapsed-size')).toBe('40px');
  });

  it('supports toggle length size presets', () => {
    const panel = fixture.nativeElement.querySelector('.peek-panel') as HTMLElement;

    host.toggleLengthSize = 'small';
    fixture.detectChanges();
    expect(panel.classList.contains('toggle-length-small')).toBe(true);

    host.toggleLengthSize = 'large';
    fixture.detectChanges();
    expect(panel.classList.contains('toggle-length-large')).toBe(true);
  });

  it('keeps backward compatibility with toggleSize alias', () => {
    const panel = fixture.nativeElement.querySelector('.peek-panel') as HTMLElement;

    host.toggleThicknessSize = 'auto';
    host.toggleSize = 'small';
    fixture.detectChanges();
    expect(panel.style.getPropertyValue('--peek-collapsed-size')).toBe('18px');
  });

  it('updates aria-expanded and aria-label based on state', () => {
    host.expanded = undefined;
    host.defaultExpanded = false;
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.peek-toggle') as HTMLButtonElement;

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Open panel');

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Close panel');
  });
});
