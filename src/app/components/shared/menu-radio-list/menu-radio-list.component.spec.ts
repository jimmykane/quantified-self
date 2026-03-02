import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { describe, expect, it, vi } from 'vitest';
import { MenuRadioListComponent } from './menu-radio-list.component';

describe('MenuRadioListComponent', () => {
  let fixture: ComponentFixture<MenuRadioListComponent<string>>;
  let component: MenuRadioListComponent<string>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        BrowserAnimationsModule,
        MatIconModule,
        MatMenuModule,
      ],
      declarations: [MenuRadioListComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MenuRadioListComponent<string>);
    component = fixture.componentInstance;
    component.label = 'X Axis';
    component.value = 'duration';
    component.options = [
      { label: 'Duration', value: 'duration' },
      { label: 'Distance', value: 'distance' },
    ];
    fixture.detectChanges();
  });

  it('renders the current option as checked', () => {
    const icons = Array.from(fixture.nativeElement.querySelectorAll('mat-icon')).map((icon: HTMLElement) =>
      icon.textContent?.trim()
    );

    expect(icons).toEqual(['radio_button_checked', 'radio_button_unchecked']);
  });

  it('emits value changes when selecting a new option', () => {
    const emitSpy = vi.spyOn(component.valueChange, 'emit');
    const buttons = fixture.nativeElement.querySelectorAll('button[mat-menu-item]');

    buttons[1].click();

    expect(emitSpy).toHaveBeenCalledWith('distance');
  });
});
