import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  QueryList,
  ViewChildren,
} from '@angular/core';

export interface WorkspaceSectionNavigationItem {
  id: string;
  label: string;
  description: string;
  icon?: string;
  svgIcon?: string;
}

export type WorkspaceSectionNavigationVariant = 'services' | 'settings';

@Component({
  selector: 'app-workspace-section-navigation',
  templateUrl: './workspace-section-navigation.component.html',
  styleUrls: ['./workspace-section-navigation.component.scss'],
  standalone: false,
})
export class WorkspaceSectionNavigationComponent implements AfterViewChecked {
  @Input({ required: true }) public sections: readonly WorkspaceSectionNavigationItem[] = [];
  @Input({ required: true }) public activeSection = '';
  @Input({ required: true }) public navigationLabel = '';
  @Input({ required: true }) public navigationAriaLabel = '';
  @Input() public variant: WorkspaceSectionNavigationVariant = 'settings';
  @Input() public showMobileNavigation = true;
  @Output() public sectionSelected = new EventEmitter<string>();
  @ViewChildren('mobileSectionTab', { read: ElementRef })
  private mobileSectionTabs!: QueryList<ElementRef<HTMLAnchorElement>>;

  private lastVisibleActiveSection = '';

  public ngAfterViewChecked(): void {
    if (!this.activeSection || this.activeSection === this.lastVisibleActiveSection) {
      return;
    }

    const activeIndex = this.sections.findIndex(section => section.id === this.activeSection);
    const activeTab = activeIndex >= 0 ? this.mobileSectionTabs.get(activeIndex)?.nativeElement : undefined;

    if (!activeTab || activeTab.getClientRects().length === 0 || typeof activeTab.scrollIntoView !== 'function') {
      return;
    }

    activeTab.scrollIntoView({ block: 'nearest', inline: 'center' });
    this.lastVisibleActiveSection = this.activeSection;
  }

  public selectSection(event: Event, sectionId: string): void {
    event.preventDefault();
    this.sectionSelected.emit(sectionId);
  }
}
