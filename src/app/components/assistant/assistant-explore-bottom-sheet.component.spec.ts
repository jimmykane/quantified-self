import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MAT_BOTTOM_SHEET_DATA,
  MatBottomSheet,
  MatBottomSheetRef,
} from '@angular/material/bottom-sheet';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASSISTANT_CREATE_TODAYS_WORKOUT_PROMPT,
  ASSISTANT_LATEST_TRAINING_IMPACT_PROMPT,
  ASSISTANT_PROMPT_CARDS,
  ASSISTANT_YESTERDAY_TRAINING_IMPACT_PROMPT,
} from '@shared/assistant.prompts';
import { ASSISTANT_MAX_MESSAGE_CHARS } from '@shared/assistant.types';
import { AssistantExploreBottomSheetComponent } from './assistant-explore-bottom-sheet.component';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { compile } from 'sass';

describe('AssistantExploreBottomSheetComponent', () => {
  let fixture: ComponentFixture<AssistantExploreBottomSheetComponent>;
  let component: AssistantExploreBottomSheetComponent;
  const bottomSheetRef = {
    dismiss: vi.fn(),
  };

  beforeEach(async () => {
    bottomSheetRef.dismiss.mockReset();

    await TestBed.configureTestingModule({
      imports: [
        AssistantExploreBottomSheetComponent,
        RouterTestingModule.withRoutes([]),
        NoopAnimationsModule,
        MatIconTestingModule,
      ],
      providers: [
        { provide: MatBottomSheetRef, useValue: bottomSheetRef },
        {
          provide: MAT_BOTTOM_SHEET_DATA,
          useValue: { locationAccess: 'coordinate_free' },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AssistantExploreBottomSheetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders every supported example as an accessible prompt choice', () => {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.assistant-explore-prompts button'),
    ) as HTMLButtonElement[];

    expect(buttons).toHaveLength(ASSISTANT_PROMPT_CARDS.length);
    ASSISTANT_PROMPT_CARDS.forEach((prompt, index) => {
      expect(buttons[index].textContent).toContain(prompt.shortLabel);
      expect(buttons[index].getAttribute('aria-label')).toContain(prompt.prompt);
    });
    expect(buttons.at(-1)?.textContent).toContain("Today's workout");
    expect(buttons.at(-1)?.getAttribute('aria-label')).toContain(
      ASSISTANT_CREATE_TODAYS_WORKOUT_PROMPT,
    );
    expect(buttons.some(button => button.getAttribute('aria-label')?.includes(
      ASSISTANT_LATEST_TRAINING_IMPACT_PROMPT,
    ))).toBe(true);
    expect(buttons.some(button => button.getAttribute('aria-label')?.includes(
      ASSISTANT_YESTERDAY_TRAINING_IMPACT_PROMPT,
    ))).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Your data stays in your control');
    expect(fixture.nativeElement.textContent).toContain('Precise activity locations');
    expect(fixture.nativeElement.textContent).toContain('starts a new chat');
    expect(fixture.nativeElement.textContent).toContain('MCP connections');
  });

  it('offers independent default-off Training consent with an accessible disclosure', async () => {
    const toggle = fixture.nativeElement.querySelector('[aria-label^="Training plans access"]');
    expect(toggle).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('sensitive health or personal information');
    expect(fixture.nativeElement.textContent).toContain('choose whether to keep its workouts as standalone or delete them');
    expect(fixture.nativeElement.textContent).toContain('Workout deletion is recoverable');
    expect(fixture.nativeElement.textContent).toContain('Plan deletion is permanent');
    expect(fixture.nativeElement.textContent).toContain('With Plan and workout changes also on');
    expect(fixture.nativeElement.textContent).toContain('older, uncompleted service copies');
    expect(fixture.nativeElement.textContent).toContain('Sending needs Pro; removing copies does not');
    expect(fixture.nativeElement.textContent).toContain('valid service access and provider support');
    expect(fixture.nativeElement.textContent).toContain('Turn on Training plans before allowing changes');
    expect(fixture.nativeElement.querySelectorAll('.assistant-training-access app-compact-row')).toHaveLength(3);
    const changeToggles = Array.from(fixture.nativeElement.querySelectorAll(
      '[aria-label^="Training plan changes"], [aria-label^="Training delivery changes"]',
    )) as HTMLButtonElement[];
    expect(changeToggles).toHaveLength(2);
    expect(changeToggles.every(changeToggle => changeToggle.disabled)).toBe(true);
    for (const trainingToggle of Array.from(fixture.nativeElement.querySelectorAll(
      '[aria-label^="Training"]',
    )) as HTMLElement[]) {
      const descriptionId = trainingToggle.getAttribute('aria-describedby');
      expect(descriptionId).toBeTruthy();
      expect(fixture.nativeElement.querySelector(`#${descriptionId}`)).not.toBeNull();
    }
    component.setTrainingPlans(false); expect(bottomSheetRef.dismiss).not.toHaveBeenCalled();
    component.setTrainingPlans(true); expect(bottomSheetRef.dismiss).toHaveBeenCalledWith({ kind: 'training_plans', enabled: true });
    // Optional rendered-component artifact for phone/desktop light/dark layout QA. No account/API data.
    if (process.env.QS_TRAINING_CONSENT_QA_HTML) {
      const styleFile = readdirSync('dist/browser').find(name => /^styles(?:-[A-Z0-9]+)?\.css$/i.test(name));
      if (!styleFile) throw new Error('Build the frontend before rendered consent QA.');
      const styles = readFileSync(`dist/browser/${styleFile}`, 'utf8');
      const sheet = TestBed.inject(MatBottomSheet);
      sheet.open(AssistantExploreBottomSheetComponent, {
        data: { locationAccess: 'coordinate_free', trainingPlansEnabled: true, measurementChangesEnabled: true },
      });
      await fixture.whenStable();
      // This component stylesheet is plain CSS. TestBed omits styleUrl processing; include it for visual QA.
      const componentStyles = readFileSync('src/app/components/assistant/assistant-explore-bottom-sheet.component.scss', 'utf8')
        .replace(':host', 'app-assistant-explore-bottom-sheet');
      const rowStyles = compile('src/app/components/shared/compact-row/compact-row.component.scss').css
        .replace(/:host\(([^)]+)\)/g, 'app-compact-row$1').replaceAll(':host', 'app-compact-row');
      writeFileSync(process.env.QS_TRAINING_CONSENT_QA_HTML, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}\n${componentStyles}\n${rowStyles}</style>${document.head.innerHTML}</head><body>${document.querySelector('.cdk-overlay-container')!.outerHTML}<script>if(location.hash==='#dark'){document.body.classList.add('dark-theme');document.querySelector('.cdk-overlay-container').classList.add('dark-theme')}</script></body></html>`);
      sheet.dismiss();
    }
  });

  it('returns a chosen prompt to the Assistant page', () => {
    const prompt = ASSISTANT_PROMPT_CARDS[0].prompt;

    component.selectPrompt(prompt);

    expect(bottomSheetRef.dismiss).toHaveBeenCalledWith({
      kind: 'prompt',
      prompt,
    });
  });

  it('selects today\'s workout without enabling optional data or change access', () => {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.assistant-explore-prompts button'),
    ) as HTMLButtonElement[];

    buttons.at(-1)!.click();

    expect(bottomSheetRef.dismiss).toHaveBeenCalledExactlyOnceWith({
      kind: 'prompt',
      prompt: ASSISTANT_CREATE_TODAYS_WORKOUT_PROMPT,
    });
    expect(ASSISTANT_CREATE_TODAYS_WORKOUT_PROMPT.length).toBeLessThanOrEqual(ASSISTANT_MAX_MESSAGE_CHARS);
    expect(component.data.trainingPlansEnabled ?? false).toBe(false);
    expect(component.data.trainingPlanChangesEnabled ?? false).toBe(false);
    expect(component.data.timelineNotesEnabled ?? false).toBe(false);
  });

  it('returns explicit precise activity-location consent to the Assistant page', () => {
    component.setPreciseActivityLocations(true);

    expect(bottomSheetRef.dismiss).toHaveBeenCalledWith({
      kind: 'location_access',
      locationAccess: 'precise_activity',
    });
  });

  it('starts with notes off, describes the full-text disclosure and ignores unchanged choices', () => {
    expect(component.data.timelineNotesEnabled ?? false).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('full private note titles and details');
    expect(fixture.nativeElement.textContent).toContain('hidden from charts');
    expect(fixture.nativeElement.textContent).toContain('manual measurement changes start on');
    component.setTimelineNotes(false);
    expect(bottomSheetRef.dismiss).not.toHaveBeenCalled();
    component.setTimelineNotes(true);
    expect(bottomSheetRef.dismiss).toHaveBeenCalledWith({ kind: 'timeline_notes', enabled: true });
  });

  it('keeps tag and note writes separate and disables note writes without note reads', () => {
    const tagToggle = fixture.nativeElement.querySelector('[aria-label^="Activity tag changes"]') as HTMLButtonElement;
    const noteWriteToggle = fixture.nativeElement.querySelector('[aria-label^="Timeline note changes"]') as HTMLButtonElement;
    expect(tagToggle).not.toBeNull();
    expect(noteWriteToggle.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Nothing changes until you approve it');
    expect(fixture.nativeElement.textContent).toContain('permanently delete');
    component.setActivityTagChanges(true);
    expect(bottomSheetRef.dismiss).toHaveBeenLastCalledWith({ kind: 'activity_tag_changes', enabled: true });
    component.setTimelineNoteChanges(true);
    expect(bottomSheetRef.dismiss).toHaveBeenLastCalledWith({ kind: 'timeline_note_changes', enabled: true });
  });

  it('closes without a prompt when dismissed explicitly', () => {
    component.close();

    expect(bottomSheetRef.dismiss).toHaveBeenCalledWith();
  });
});
