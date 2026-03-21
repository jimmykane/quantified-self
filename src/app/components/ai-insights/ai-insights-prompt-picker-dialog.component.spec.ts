import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, expect, it, vi } from 'vitest';
import { AiInsightsPromptPickerDialogComponent } from './ai-insights-prompt-picker-dialog.component';
import { AI_INSIGHTS_DEFAULT_PROMPT_SECTIONS } from './ai-insights.prompts';

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
            promptSections: AI_INSIGHTS_DEFAULT_PROMPT_SECTIONS,
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

    const sectionTitles = fixture.debugElement.queryAll(By.css('.prompt-picker-dialog__section-title'))
      .map((element) => element.nativeElement.textContent.trim());
    const groupTitles = fixture.debugElement.queryAll(By.css('.prompt-picker-dialog__group-title'))
      .map((element) => element.nativeElement.textContent.trim());
    const promptItems = fixture.debugElement.queryAll(By.css('.prompt-picker-dialog__item-copy'))
      .map((element) => element.nativeElement.textContent.trim());

    expect(sectionTitles).toEqual(['Popular Ways To Ask', 'Browse By Metric']);
    expect(groupTitles).toContain('Recent activity');
    expect(groupTitles).toContain('Volume & Distance');
    expect(groupTitles).toContain('Power & Load');
    expect(promptItems).toContain('Show my training time over time this year.');
    expect(promptItems).toContain('Show my total distance by activity type this year.');
  });

  it('closes with the selected prompt', async () => {
    const { fixture, dialogRef } = await createComponent();

    const promptButton = fixture.debugElement.query(By.css('.prompt-picker-dialog__item'));
    promptButton.triggerEventHandler('click');

    expect(dialogRef.close).toHaveBeenCalledWith('When was my last ride?');
  });

  it('switches copy for unsupported prompt suggestions', async () => {
    const { fixture } = await createComponent('unsupported');

    const title = fixture.debugElement.query(By.css('[mat-dialog-title]'))?.nativeElement as HTMLElement | undefined;
    const copy = fixture.debugElement.query(By.css('.prompt-picker-dialog__copy'))?.nativeElement as HTMLElement | undefined;

    expect(title?.textContent).toContain('Try a supported prompt');
    expect(copy?.textContent).toContain('not supported yet');
  });

  it('filters prompt results by search text', async () => {
    const { fixture } = await createComponent();

    const searchInput = fixture.debugElement.query(By.css('.prompt-picker-dialog__search-input'))?.nativeElement as HTMLInputElement | undefined;
    expect(searchInput).toBeTruthy();
    if (!searchInput) {
      return;
    }

    searchInput.value = 'cadence';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    const groupTitles = fixture.debugElement.queryAll(By.css('.prompt-picker-dialog__group-title'))
      .map((element) => element.nativeElement.textContent.trim());
    const promptItems = fixture.debugElement.queryAll(By.css('.prompt-picker-dialog__item-copy'))
      .map((element) => element.nativeElement.textContent.trim());

    expect(groupTitles).toEqual(['Compare & explore', 'Cardio & Speed', 'Advanced Examples']);
    expect(promptItems).toEqual([
      'Show my cadence and power over the last 3 months for cycling.',
      'Tell me my average cadence for cycling over the last 3 months.',
      'Show me avg cadence and avg power for the last 3 months for cycling.',
    ]);
  });

  it('shows an empty state when no prompts match the search', async () => {
    const { fixture } = await createComponent();

    const searchInput = fixture.debugElement.query(By.css('.prompt-picker-dialog__search-input'))?.nativeElement as HTMLInputElement | undefined;
    expect(searchInput).toBeTruthy();
    if (!searchInput) {
      return;
    }

    searchInput.value = 'zzzz-unmatched';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    const emptyState = fixture.debugElement.query(By.css('.prompt-picker-dialog__empty-state'))?.nativeElement as HTMLElement | undefined;
    const promptItems = fixture.debugElement.queryAll(By.css('.prompt-picker-dialog__item-copy'));

    expect(emptyState?.textContent).toContain('No prompts match your search.');
    expect(promptItems).toHaveLength(0);
  });
});
