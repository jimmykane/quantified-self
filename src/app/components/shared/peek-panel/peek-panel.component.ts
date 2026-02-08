import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, signal } from '@angular/core';

@Component({
  selector: 'app-peek-panel',
  templateUrl: './peek-panel.component.html',
  styleUrls: ['./peek-panel.component.css'],
  standalone: false
})
export class PeekPanelComponent implements OnInit, OnChanges {
  @Input() position: 'top' | 'left' | 'right' = 'left';
  @Input() topAnchor: 'left' | 'center' | 'right' = 'center';
  @Input() expanded?: boolean;
  @Input() defaultExpanded = false;
  @Input() expandedSizePx = 320;
  @Input() collapsedSizePx = 44;
  @Input() ariaLabelExpand = 'Expand panel';
  @Input() ariaLabelCollapse = 'Collapse panel';
  @Input() title = '';
  @Input() icon?: string;

  @Output() expandedChange = new EventEmitter<boolean>();

  private uncontrolledExpanded = signal(false);

  public ngOnInit(): void {
    this.uncontrolledExpanded.set(this.defaultExpanded);
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if (this.expanded !== undefined) {
      return;
    }

    if (changes['defaultExpanded'] && !changes['defaultExpanded'].firstChange) {
      this.uncontrolledExpanded.set(!!this.defaultExpanded);
    }
  }

  public isExpanded(): boolean {
    return this.expanded !== undefined ? this.expanded : this.uncontrolledExpanded();
  }

  public togglePanel(): void {
    const nextValue = !this.isExpanded();

    if (this.expanded === undefined) {
      this.uncontrolledExpanded.set(nextValue);
    }

    this.expandedChange.emit(nextValue);
  }

  public getAriaLabel(): string {
    return this.isExpanded() ? this.ariaLabelCollapse : this.ariaLabelExpand;
  }

  public getToggleIcon(): string {
    if (this.position === 'top') {
      return this.isExpanded() ? 'expand_less' : 'expand_more';
    }

    if (this.position === 'right') {
      return this.isExpanded() ? 'chevron_right' : 'chevron_left';
    }

    return this.isExpanded() ? 'chevron_left' : 'chevron_right';
  }
}
