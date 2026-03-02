import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

export interface MenuRadioListOption<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

@Component({
  selector: 'app-menu-radio-list',
  templateUrl: './menu-radio-list.component.html',
  styleUrls: ['./menu-radio-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class MenuRadioListComponent<T = string> {
  @Input() label = '';
  @Input() value: T | null = null;
  @Input() disabled = false;
  @Input() options: ReadonlyArray<MenuRadioListOption<T>> = [];

  @Output() valueChange = new EventEmitter<T>();

  onSelect(value: T): void {
    this.valueChange.emit(value);
  }
}
