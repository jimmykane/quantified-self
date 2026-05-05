import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MaterialModule } from '../../../modules/material.module';
import { DashboardActionPromptViewModel } from '../../../helpers/dashboard-action-prompt.helper';
import { DashboardActionPromptComponent } from './dashboard-action-prompt.component';
import { ServiceNames } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-service-source-icon',
  template: '<span class="service-source-icon-stub">{{ sourceServiceName }}</span>',
  standalone: false,
})
class ServiceSourceIconStubComponent {
  @Input() sourceServiceName: string | null = null;
  @Input() showTooltip = true;
}

@Component({
  template: `
    <app-dashboard-action-prompt
      [prompt]="prompt"
      [hasControls]="hasControls"
      [hasActionControls]="hasActionControls"
      (primary)="onPrimary($event)"
      (secondary)="onSecondary($event)"
      (menuAction)="onMenuAction($event)">
      <div prompt-controls class="projected-control">Projected controls</div>
      <button prompt-actions class="projected-action">Projected action</button>
    </app-dashboard-action-prompt>
  `,
  standalone: false,
})
class DashboardActionPromptHostComponent {
  hasControls = true;
  hasActionControls = false;
  prompt: DashboardActionPromptViewModel = {
    id: 'unitSetup',
    icon: 'straighten',
    title: 'Default units',
    description: 'Choose units.',
    primaryAction: { id: 'applyUnitSetup', label: 'Apply', loadingLabel: 'Saving...' },
    secondaryAction: { id: 'dismissUnitSetup', label: 'Not now' },
    menuActions: [{ id: 'openUnitSettings', label: 'Advanced settings', icon: 'tune' }],
  };

  onPrimary = vi.fn();
  onSecondary = vi.fn();
  onMenuAction = vi.fn();
}

describe('DashboardActionPromptComponent', () => {
  let fixture: ComponentFixture<DashboardActionPromptHostComponent>;
  let host: DashboardActionPromptHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MaterialModule, NoopAnimationsModule],
      declarations: [DashboardActionPromptComponent, DashboardActionPromptHostComponent, ServiceSourceIconStubComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardActionPromptHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders prompt copy, icon, projected controls, and inline actions', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Default units');
    expect(text).toContain('Choose units.');
    expect(text).toContain('Projected controls');
    expect(text).toContain('Not now');
    expect(text).toContain('Advanced settings');
    expect(text).toContain('Apply');
    expect(fixture.nativeElement.querySelector('mat-icon')?.textContent?.trim()).toBe('straighten');
    expect(fixture.nativeElement.querySelector('[aria-label="More prompt actions"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-card')?.classList.contains('qs-glass-card-panel')).toBe(true);
    expect(fixture.nativeElement.querySelector('mat-card-title')?.classList.contains('dashboard-action-prompt__title')).toBe(true);
    expect(fixture.nativeElement.querySelector('mat-card-subtitle')?.classList.contains('dashboard-action-prompt__subtitle')).toBe(true);
  });

  it('renders projected prompt actions when action controls are enabled', () => {
    host.hasActionControls = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.projected-action')?.textContent).toContain('Projected action');
  });

  it('keeps dismissal before projected and primary actions', () => {
    host.hasActionControls = true;
    fixture.detectChanges();

    const actionsText = fixture.nativeElement
      .querySelector('.dashboard-action-prompt__actions')
      ?.textContent
      ?.replace(/\s+/g, ' ')
      .trim() || '';

    expect(actionsText.indexOf('Not now')).toBeLessThan(actionsText.indexOf('Projected action'));
    expect(actionsText.indexOf('Projected action')).toBeLessThan(actionsText.indexOf('Apply'));
  });

  it('pins the action row to the bottom of equal-height prompt cards', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/dashboard/dashboard-action-prompt/dashboard-action-prompt.component.scss'),
      'utf8',
    );

    expect(styles).toContain('flex-direction: column');
    expect(styles).toContain('margin-top: auto');
    expect(styles).toContain('font: var(--mat-sys-title-medium)');
    expect(styles).toContain('font: var(--mat-sys-body-medium)');
    expect(styles).not.toContain('surface-container-low');
  });

  it('does not render an empty content block when there are no controls or errors', () => {
    host.hasControls = false;
    host.prompt = {
      ...host.prompt,
      error: null,
    };
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.dashboard-action-prompt__content')).toBeNull();
  });

  it('renders service-source icons for provider menu actions', () => {
    host.hasControls = false;
    host.prompt = {
      id: 'connectActivityService',
      icon: 'sync',
      title: 'Connect a service',
      description: 'Connect a provider.',
      primaryAction: { id: 'connectActivityService', label: 'Connect service', menuTrigger: true },
      menuActions: [{
        id: 'connectServiceProvider',
        label: 'Garmin',
        serviceName: ServiceNames.GarminAPI,
        value: ServiceNames.GarminAPI,
      }],
    };
    fixture.detectChanges();
    const menuTrigger = fixture.debugElement.queryAll(By.css('button'))
      .find(button => button.nativeElement.textContent.includes('Connect service'));

    menuTrigger?.nativeElement.click();
    fixture.detectChanges();

    expect(document.body.querySelector('app-service-source-icon')).toBeTruthy();
  });

  it('emits primary and secondary actions with prompt context', () => {
    const buttons = fixture.debugElement.queryAll(By.css('button'));
    const secondaryButton = buttons.find(button => button.nativeElement.textContent.includes('Not now'));
    const primaryButton = buttons.find(button => button.nativeElement.textContent.includes('Apply'));

    secondaryButton?.nativeElement.click();
    primaryButton?.nativeElement.click();

    expect(host.onSecondary).toHaveBeenCalledWith(expect.objectContaining({
      promptId: 'unitSetup',
      action: expect.objectContaining({ id: 'dismissUnitSetup' }),
    }));
    expect(host.onPrimary).toHaveBeenCalledWith(expect.objectContaining({
      promptId: 'unitSetup',
      action: expect.objectContaining({ id: 'applyUnitSetup' }),
    }));
  });

  it('emits inline menu actions with prompt context', () => {
    const advancedSettingsButton = fixture.debugElement.queryAll(By.css('button'))
      .find(button => button.nativeElement.textContent.includes('Advanced settings'));

    advancedSettingsButton?.nativeElement.click();

    expect(host.onMenuAction).toHaveBeenCalledWith({
      promptId: 'unitSetup',
      action: { id: 'openUnitSettings', label: 'Advanced settings', icon: 'tune' },
    });
  });

  it('shows stable loading content and disables actions while busy', () => {
    host.prompt = {
      ...host.prompt,
      busy: true,
    };
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    const buttons = fixture.debugElement.queryAll(By.css('button'));

    expect(text).toContain('Saving...');
    expect(buttons.every(button => button.nativeElement.disabled)).toBe(true);
  });

  it('renders an error row when provided', () => {
    host.prompt = {
      ...host.prompt,
      error: 'Could not save unit preferences.',
    };
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('.dashboard-action-prompt__error');
    expect(error?.textContent).toContain('Could not save unit preferences.');
  });
});
