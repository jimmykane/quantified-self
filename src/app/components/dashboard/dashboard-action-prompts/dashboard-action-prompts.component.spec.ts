import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MaterialModule } from '../../../modules/material.module';
import { DashboardActionPromptViewModel } from '../../../helpers/dashboard-action-prompt.helper';
import { UNIT_SETUP_PRESET_OPTIONS } from '../../../helpers/unit-setup-preset.helper';
import { DashboardActionPromptComponent } from '../dashboard-action-prompt/dashboard-action-prompt.component';
import { DashboardActionPromptsComponent } from './dashboard-action-prompts.component';

@Component({
  selector: 'app-upload-activities',
  template: '<button class="upload-activities-stub" (click)="activityUploadComplete.emit()">{{ uploadLabel }}</button>',
  standalone: false,
})
class UploadActivitiesStubComponent {
  @Input() user: unknown;
  @Input() hasProAccess: boolean | null = null;
  @Input() uploadLabel: string | null = null;
  @Input() disabled = false;
  @Input() promptAction = false;
  @Input() showUploadIcon = false;
  @Input() showRemainingCountWithCustomLabel = false;
  @Output() activityUploadComplete = new EventEmitter<void>();
}

describe('DashboardActionPromptsComponent', () => {
  let fixture: ComponentFixture<DashboardActionPromptsComponent>;
  let component: DashboardActionPromptsComponent;

  const prompts: DashboardActionPromptViewModel[] = [{
    id: 'connectActivityService',
    icon: 'sync',
    title: 'Connect a service',
    description: 'Connect Garmin, Suunto, or COROS.',
    primaryAction: { id: 'connectActivityService', label: 'Connect service', menuTrigger: true },
    secondaryAction: { id: 'dismissConnectActivityService', label: 'Not now' },
    menuActions: [{ id: 'connectServiceProvider', label: 'Garmin', value: 'Garmin API' }],
  }, {
    id: 'firstActivityUpload',
    icon: 'upload_file',
    title: 'Upload your first activities',
    description: 'Start with FIT, GPX, TCX, JSON, or SML files.',
    primaryAction: { id: 'upgradeToPro', label: 'Upgrade to Pro' },
    secondaryAction: { id: 'dismissFirstActivityUpload', label: 'Not now' },
  }, {
    id: 'unitSetup',
    icon: 'straighten',
    title: 'Default units',
    description: 'Choose units.',
    primaryAction: { id: 'applyUnitSetup', label: 'Apply' },
    secondaryAction: { id: 'dismissUnitSetup', label: 'Not now' },
  }];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MaterialModule, NoopAnimationsModule],
      declarations: [DashboardActionPromptComponent, DashboardActionPromptsComponent, UploadActivitiesStubComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardActionPromptsComponent);
    component = fixture.componentInstance;
    component.prompts = prompts;
    component.user = { uid: 'u1' } as any;
    component.unitSetupOptions = UNIT_SETUP_PRESET_OPTIONS;
    component.selectedUnitSetupPreset = 'kilometers';
    fixture.detectChanges();
  });

  it('renders prompts in deterministic order with unit setup first', () => {
    const cards = fixture.nativeElement.querySelectorAll('app-dashboard-action-prompt');

    expect(cards.length).toBe(3);
    expect(cards[0].textContent).toContain('Default units');
    expect(cards[1].textContent).toContain('Upload your first activities');
    expect(cards[2].textContent).toContain('Connect a service');
  });

  it('uses a responsive grid so prompt cards can form columns when they fit', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/dashboard/dashboard-action-prompts/dashboard-action-prompts.component.scss'),
      'utf8',
    );

    expect(styles).toContain('display: grid');
    expect(styles).toContain('repeat(auto-fit');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('renders unit setup controls through the shared prompt projection slot', () => {
    const toggleGroup = fixture.nativeElement.querySelector('.dashboard-action-prompts__unit-toggle');

    expect(toggleGroup).toBeTruthy();
    expect(toggleGroup.textContent).toContain('Kilometers');
    expect(toggleGroup.textContent).toContain('Miles');
  });

  it('emits standard prompt events', () => {
    const primarySpy = vi.fn();
    const secondarySpy = vi.fn();
    component.primary.subscribe(primarySpy);
    component.secondary.subscribe(secondarySpy);

    const promptComponents = fixture.debugElement.queryAll(By.directive(DashboardActionPromptComponent));
    promptComponents[0].componentInstance.primary.emit({
      promptId: 'unitSetup',
      action: { id: 'applyUnitSetup', label: 'Apply' },
    });
    promptComponents[2].componentInstance.secondary.emit({
      promptId: 'connectActivityService',
      action: { id: 'dismissConnectActivityService', label: 'Not now' },
    });

    expect(primarySpy).toHaveBeenCalledWith(expect.objectContaining({ promptId: 'unitSetup' }));
    expect(secondarySpy).toHaveBeenCalledWith(expect.objectContaining({ promptId: 'connectActivityService' }));
  });

  it('renders first-activity upload action through the shared prompt action slot', () => {
    const uploadActionDebug = fixture.debugElement.query(By.directive(UploadActivitiesStubComponent));
    const uploadAction = uploadActionDebug.nativeElement.querySelector('.upload-activities-stub');

    expect(uploadAction).toBeTruthy();
    expect(uploadAction.textContent).toContain('Upload first activity');
    expect(uploadActionDebug.componentInstance.promptAction).toBe(false);
    expect(uploadActionDebug.componentInstance.showUploadIcon).toBe(false);
    expect(uploadActionDebug.componentInstance.showRemainingCountWithCustomLabel).toBe(true);
  });

  it('emits a control change when the first-activity upload completes', () => {
    const controlSpy = vi.fn();
    component.controlChange.subscribe(controlSpy);

    fixture.nativeElement.querySelector('.upload-activities-stub').click();

    expect(controlSpy).toHaveBeenCalledWith({
      promptId: 'firstActivityUpload',
      value: 'activityUploaded',
    });
  });

  it('emits control changes with the prompt id', () => {
    const controlSpy = vi.fn();
    component.controlChange.subscribe(controlSpy);

    component.onControlChange('unitSetup', 'miles');

    expect(controlSpy).toHaveBeenCalledWith({
      promptId: 'unitSetup',
      value: 'miles',
    });
  });
});
