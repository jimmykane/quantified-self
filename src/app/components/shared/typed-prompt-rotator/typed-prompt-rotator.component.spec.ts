import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { By } from '@angular/platform-browser';
import { TypedPromptRotatorComponent } from './typed-prompt-rotator.component';

describe('TypedPromptRotatorComponent', () => {
  let fixture: ComponentFixture<TypedPromptRotatorComponent>;
  let component: TypedPromptRotatorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TypedPromptRotatorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TypedPromptRotatorComponent);
    component = fixture.componentInstance;
  });

  it('renders the typing prompt and caret', () => {
    fixture.componentRef.setInput('prompts', ['Show my weekly running distance.']);
    fixture.detectChanges();

    const promptText = fixture.debugElement.query(By.css('.hero-prompt-text'))?.nativeElement as HTMLElement | undefined;
    const promptCaret = fixture.debugElement.query(By.css('.hero-prompt-caret'))?.nativeElement as HTMLElement | undefined;

    expect(promptText?.textContent?.trim()).toBe('S');
    expect(promptCaret).toBeTruthy();
  });

  it('emits the active prompt when interactive rotator is clicked', () => {
    const selectedPrompts: string[] = [];
    component.promptSelect.subscribe((prompt) => {
      selectedPrompts.push(prompt);
    });

    fixture.componentRef.setInput('prompts', ['Compare pace and heart rate over 90 days.']);
    fixture.componentRef.setInput('interactive', true);
    fixture.detectChanges();

    const trigger = fixture.debugElement.query(By.css('.hero-prompt-rotator'))?.nativeElement as HTMLButtonElement | undefined;
    trigger?.click();

    expect(selectedPrompts).toEqual(['Compare pace and heart rate over 90 days.']);
  });
});
