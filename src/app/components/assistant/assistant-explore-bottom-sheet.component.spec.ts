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
import { ASSISTANT_PROMPT_EXAMPLES } from '@shared/assistant.prompts';
import { AssistantExploreBottomSheetComponent } from './assistant-explore-bottom-sheet.component';
import { writeFileSync, readFileSync } from 'node:fs';

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

    expect(buttons).toHaveLength(ASSISTANT_PROMPT_EXAMPLES.length);
    ASSISTANT_PROMPT_EXAMPLES.forEach((prompt, index) => {
      expect(buttons[index].textContent).toContain(prompt.shortLabel);
      expect(buttons[index].getAttribute('aria-label')).toContain(prompt.prompt);
    });
    expect(fixture.nativeElement.textContent).toContain('Your data stays in your control');
    expect(fixture.nativeElement.textContent).toContain('Precise activity locations');
    expect(fixture.nativeElement.textContent).toContain('starts a new chat');
    expect(fixture.nativeElement.textContent).toContain('MCP connections');
  });

  it('offers independent default-off Training consent with an accessible disclosure', async () => {
    const toggle = fixture.nativeElement.querySelector('[aria-describedby="assistant-training-plans-disclosure"]');
    expect(toggle).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('sensitive health or personal information');
    expect(fixture.nativeElement.textContent).toContain('choose what happens to its workouts');
    component.setTrainingPlans(false); expect(bottomSheetRef.dismiss).not.toHaveBeenCalled();
    component.setTrainingPlans(true); expect(bottomSheetRef.dismiss).toHaveBeenCalledWith({ kind: 'training_plans', enabled: true });
    // Optional rendered-component artifact for phone/desktop light/dark layout QA. No account/API data.
    if (process.env.QS_TRAINING_CONSENT_QA_HTML) {
      const styles = readFileSync('dist/browser/styles.css', 'utf8');
      const sheet = TestBed.inject(MatBottomSheet);
      sheet.open(AssistantExploreBottomSheetComponent, { data: { locationAccess: 'coordinate_free' } });
      await fixture.whenStable();
      // This component stylesheet is plain CSS. TestBed omits styleUrl processing; include it for visual QA.
      const componentStyles = readFileSync('src/app/components/assistant/assistant-explore-bottom-sheet.component.scss', 'utf8')
        .replace(':host', 'app-assistant-explore-bottom-sheet');
      writeFileSync(process.env.QS_TRAINING_CONSENT_QA_HTML, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}\n${componentStyles}</style>${document.head.innerHTML}</head><body>${document.querySelector('.cdk-overlay-container')!.outerHTML}</body></html>`);
      sheet.dismiss();
    }
  });

  it('returns a chosen prompt to the Assistant page', () => {
    const prompt = ASSISTANT_PROMPT_EXAMPLES[0].prompt;

    component.selectPrompt(prompt);

    expect(bottomSheetRef.dismiss).toHaveBeenCalledWith({
      kind: 'prompt',
      prompt,
    });
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
    expect(fixture.nativeElement.textContent).toContain('New chat turns all optional access off');
    component.setTimelineNotes(false);
    expect(bottomSheetRef.dismiss).not.toHaveBeenCalled();
    component.setTimelineNotes(true);
    expect(bottomSheetRef.dismiss).toHaveBeenCalledWith({ kind: 'timeline_notes', enabled: true });
  });

  it('closes without a prompt when dismissed explicitly', () => {
    component.close();

    expect(bottomSheetRef.dismiss).toHaveBeenCalledWith();
  });
});
