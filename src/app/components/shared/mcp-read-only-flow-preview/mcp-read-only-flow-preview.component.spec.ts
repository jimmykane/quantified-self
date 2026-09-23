import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { McpReadOnlyFlowPreviewComponent } from './mcp-read-only-flow-preview.component';

describe('McpReadOnlyFlowPreviewComponent', () => {
  let fixture: ComponentFixture<McpReadOnlyFlowPreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [McpReadOnlyFlowPreviewComponent, MatIconTestingModule],
    }).compileComponents();
    fixture = TestBed.createComponent(McpReadOnlyFlowPreviewComponent);
    fixture.detectChanges();
  });

  it('explains the external clients, approved scopes, and focused change boundary', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('ChatGPT');
    expect(text).toContain('Claude');
    expect(text).toContain('Training');
    expect(text).toContain('Activities');
    expect(text).toContain('Notes');
    expect(text).toContain('separately approved note, tag, and Training changes');
  });
});
