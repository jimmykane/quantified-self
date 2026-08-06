import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MAT_BOTTOM_SHEET_DATA,
  MatBottomSheetRef,
} from '@angular/material/bottom-sheet';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_PROMPT_EXAMPLES } from '@shared/assistant.prompts';
import { AssistantExploreBottomSheetComponent } from './assistant-explore-bottom-sheet.component';

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

  it('closes without a prompt when dismissed explicitly', () => {
    component.close();

    expect(bottomSheetRef.dismiss).toHaveBeenCalledWith();
  });
});
