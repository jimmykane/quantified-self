import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { ASSISTANT_STARTER_PROMPTS } from '@shared/assistant.prompts';
import { AssistantExamplePreviewComponent } from './assistant-example-preview.component';

describe('AssistantExamplePreviewComponent', () => {
  let fixture: ComponentFixture<AssistantExamplePreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AssistantExamplePreviewComponent, MatIconTestingModule],
    }).compileComponents();
    fixture = TestBed.createComponent(AssistantExamplePreviewComponent);
    fixture.detectChanges();
  });

  it('reuses the prompt rotator and exposes a compact evidence example', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(fixture.componentInstance.prompts).toBe(ASSISTANT_STARTER_PROMPTS);
    expect(fixture.nativeElement.querySelector('app-typed-prompt-rotator')).toBeTruthy();
    expect(text).toContain('Example: today’s training context');
    expect(text).toContain('Grounded in validated data');
    expect(text).toContain('Readiness 78');
  });
});
