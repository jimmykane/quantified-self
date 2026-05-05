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
      { value: 'thisWeek', label: 'Week', shortLabel: 'W', menuLabel: 'This week' },
      { value: 'thisMonth', label: 'Month', shortLabel: 'M', menuLabel: 'This month' },
    ];
    component.value = 'thisWeek';
    component.ariaLabel = 'Select chart window';
  });

  it('renders the selected full and compact labels with a centered dropdown icon', () => {
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.chart-range-selector-button') as HTMLButtonElement;
    const label = fixture.nativeElement.querySelector('.chart-range-selector-label-full') as HTMLElement;
    const compactLabel = fixture.nativeElement.querySelector('.chart-range-selector-label-compact') as HTMLElement;
    const icon = fixture.nativeElement.querySelector('.chart-range-selector-icon') as HTMLElement;
    const menu = fixture.debugElement.query(By.directive(MatMenu));

    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-label')).toBe('Select chart window: This week');
    expect(button.hasAttribute('appHapticTap')).toBe(true);
    expect(button.classList.contains('qs-mat-primary')).toBe(false);
    expect(button.classList.contains('mat-mdc-button')).toBe(true);
    expect(label.textContent?.trim()).toBe('Week');
    expect(compactLabel.textContent?.trim()).toBe('W');
    expect(component.selectedShortLabel).toBe('W');
    expect(component.hasDistinctShortLabel).toBe(true);
    expect(label.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(menu).toBeTruthy();
    const menuClassList = (menu.componentInstance as MatMenu & { _classList: Record<string, boolean> })._classList;
    expect(menuClassList['qs-menu-panel']).toBe(true);
    expect(menuClassList['chart-range-selector-menu']).toBe(true);
  });

  it('emits only changed option values', () => {
    const values: string[] = [];
    component.valueChange.subscribe(value => values.push(value));

    component.selectValue('thisWeek');
    component.selectValue('thisMonth');

    expect(values).toEqual(['thisMonth']);
  });

  it('treats the first option as selected when the input value is missing or invalid', () => {
    const values: string[] = [];
    component.value = 'legacyRange';
    component.valueChange.subscribe(value => values.push(value));

    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.chart-range-selector-button') as HTMLButtonElement;
    expect(component.selectedValue).toBe('thisWeek');
    expect(button.getAttribute('aria-label')).toBe('Select chart window: This week');

    component.selectValue('thisWeek');
    component.selectValue('thisMonth');

    expect(values).toEqual(['thisMonth']);
  });
});
