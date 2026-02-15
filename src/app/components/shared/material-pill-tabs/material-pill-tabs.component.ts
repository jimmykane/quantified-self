import {
  AfterContentInit,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  Component,
  ContentChildren,
  EventEmitter,
  Input,
  Output,
  QueryList
} from '@angular/core';
import { MaterialPillTabDirective } from './material-pill-tab.directive';

@Component({
  selector: 'app-material-pill-tabs',
  templateUrl: './material-pill-tabs.component.html',
  styleUrls: ['./material-pill-tabs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class MaterialPillTabsComponent implements AfterContentInit {
  @ContentChildren(MaterialPillTabDirective)
  projectedTabs!: QueryList<MaterialPillTabDirective>;

  @Input() selectedIndex = 0;
  @Input() animationDuration = '300ms';
  @Input() lazyContent = true;
  @Input() dynamicHeight = false;
  @Input() disablePagination = false;
  @Input() stickyHeader = false;
  @Input() topOffset = '0px';
  @Input() density: 'regular' | 'compact' = 'regular';
  @Input() ariaLabel = 'Tabs';
  @Output() selectedIndexChange = new EventEmitter<number>();

  tabs: MaterialPillTabDirective[] = [];

  constructor(private cdr: ChangeDetectorRef) {}

  ngAfterContentInit() {
    this.tabs = this.projectedTabs.toArray();
    this.cdr.markForCheck();
    this.projectedTabs.changes.subscribe((tabs) => {
      this.tabs = tabs.toArray();
      this.cdr.markForCheck();
    });
  }

  onSelectedIndexChange(index: number) {
    this.selectedIndex = index;
    this.selectedIndexChange.emit(index);
  }

  trackByIndex(index: number) {
    return index;
  }
}
