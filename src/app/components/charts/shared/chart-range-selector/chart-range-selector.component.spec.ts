import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenu, MatMenuModule } from '@angular/material/menu';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChartRangeSelectorComponent } from './chart-range-selector.component';

describe('ChartRangeSelectorComponent', () => {
  let fixture: ComponentFixture<ChartRangeSelectorComponent>;
  let component: ChartRangeSelectorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ChartRangeSelectorComponent],
      imports: [MatButtonModule, MatIconModule, MatMenuModule],
    }).compileComponents();

    fixture = TestBed.createComponent(ChartRangeSelectorComponent);
    component = fixture.componentInstance;
    component.options = [
      { value: '14d', label: '14d' },
      { value: '30d', label: '30d' },
    ];
    component.value = '14d';
    component.ariaLabel = 'Select sleep range';
  });

  it('renders the selected label with a right-side dropdown icon', () => {
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.chart-range-selector-button') as HTMLButtonElement;
    const content = fixture.nativeElement.querySelector('.chart-range-selector-content') as HTMLElement;
    const label = fixture.nativeElement.querySelector('.chart-range-selector-label') as HTMLElement;
    const icon = fixture.nativeElement.querySelector('.chart-range-selector-icon') as HTMLElement;
    const menu = fixture.debugElement.query(By.directive(MatMenu));

    expect(button).toBeTruthy();
    expect(content).toBeTruthy();
    expect(button.getAttribute('aria-label')).toBe('Select sleep range');
    expect(button.hasAttribute('appHapticTap')).toBe(true);
    expect(button.textContent).toContain('14d');
    expect(label.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(menu).toBeTruthy();
  });

  it('emits only changed option values', () => {
    const values: string[] = [];
    component.valueChange.subscribe(value => values.push(value));

    component.selectValue('14d');
    component.selectValue('30d');

    expect(values).toEqual(['30d']);
  });
});
