import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, expect, it, vi } from 'vitest';
import { AiInsightsPromptPickerDialogComponent } from './ai-insights-prompt-picker-dialog.component';
import { AI_INSIGHTS_DEFAULT_PROMPT_GROUPS } from './ai-insights.prompts';

describe('AiInsightsPromptPickerDialogComponent', () => {
  async function createComponent(promptSource: 'default' | 'unsupported' = 'default'): Promise<{
    fixture: ComponentFixture<AiInsightsPromptPickerDialogComponent>;
    dialogRef: { close: ReturnType<typeof vi.fn> };
  }> {
    const dialogRef = {
      close: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [
        AiInsightsPromptPickerDialogComponent,
        NoopAnimationsModule,
      ],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            promptGroups: AI_INSIGHTS_DEFAULT_PROMPT_GROUPS,
            promptSource,
          },
        },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AiInsightsPromptPickerDialogComponent);
    fixture.detectChanges();

    return { fixture, dialogRef };
  }

  it('renders grouped prompt categories and prompts', async () => {
    const { fixture } = await createComponent();

    const groupTitles = fixture.debugElement.queryAll(By.css('.prompt-picker-dialog__group-title'))
      .map((element) => element.nativeElement.textContent.trim());
    const promptItems = fixture.debugElement.queryAll(By.css('.prompt-picker-dialog__item-copy'))
      .map((element) => element.nativeElement.textContent.trim());

    expect(groupTitles).toContain('Volume & Distance');
    expect(groupTitles).toContain('Power & Load');
    expect(promptItems).toContain('Show my total distance by activity type this year.');
    expect(promptItems).toContain('I want to know when I had my longest distance in cycling.');
  });

  it('closes with the selected prompt', async () => {
    const { fixture, dialogRef } = await createComponent();

    const promptButton = fixture.debugElement.query(By.css('.prompt-picker-dialog__item'));
    promptButton.triggerEventHandler('click');

    expect(dialogRef.close).toHaveBeenCalledWith('Show my total distance by activity type this year.');
  });

  it('switches copy for unsupported prompt suggestions', async () => {
    const { fixture } = await createComponent('unsupported');

    const title = fixture.debugElement.query(By.css('[mat-dialog-title]'))?.nativeElement as HTMLElement | undefined;
    const copy = fixture.debugElement.query(By.css('.prompt-picker-dialog__copy'))?.nativeElement as HTMLElement | undefined;

    expect(title?.textContent).toContain('Try one of these prompts');
    expect(copy?.textContent).toContain('not supported yet');
  });
});
