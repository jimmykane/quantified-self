import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';

import { ToolsHubPageComponent } from './tools-hub-page.component';

describe('ToolsHubPageComponent', () => {
  it('renders the tools hub with the compare tool link', async () => {
    await TestBed.configureTestingModule({
      imports: [ToolsHubPageComponent, RouterTestingModule.withRoutes([]), NoopAnimationsModule],
    }).compileComponents();

    const fixture: ComponentFixture<ToolsHubPageComponent> = TestBed.createComponent(ToolsHubPageComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    const compareLink = fixture.nativeElement.querySelector('a[routerlink="/tools/compare"], a[ng-reflect-router-link="/tools/compare"]');

    expect(text).toContain('Workout data tools');
    expect(text).toContain('File comparison');
    expect(compareLink).toBeTruthy();
  });
});
