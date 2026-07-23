import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  QueryList,
  ViewChild,
  ViewChildren,
} from '@angular/core';

export interface WorkspaceSectionNavigationItem {
  id: string;
  label: string;
  description: string;
  icon?: string;
  svgIcon?: string;
}

@Component({
  selector: 'app-workspace-section-navigation',
  templateUrl: './workspace-section-navigation.component.html',
  styleUrls: ['./workspace-section-navigation.component.scss'],
  standalone: false,
})
export class WorkspaceSectionNavigationComponent implements AfterViewChecked, OnDestroy {
  @Input({ required: true }) public sections: readonly WorkspaceSectionNavigationItem[] = [];
  @Input({ required: true }) public activeSection = '';
  @Input({ required: true }) public navigationAriaLabel = '';
  @Output() public sectionSelected = new EventEmitter<string>();
  @ViewChild('mobileNavigation', { read: ElementRef })
  private mobileNavigation?: ElementRef<HTMLElement>;
  @ViewChildren('mobileSectionTab', { read: ElementRef })
  private mobileSectionTabs!: QueryList<ElementRef<HTMLAnchorElement>>;

  private lastVisibleActiveSection = '';
  private activeSectionScrollFrameId: number | null = null;
  public canScrollMobileBackward = false;
  public canScrollMobileForward = false;

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
    this.updateMobileNavigationScrollState();
    this.scheduleActiveSectionScroll();
  }

  public ngOnDestroy(): void {
    if (this.activeSectionScrollFrameId === null || typeof cancelAnimationFrame !== 'function') {
      return;
    }

    cancelAnimationFrame(this.activeSectionScrollFrameId);
  }

  @HostListener('window:resize')
  public handleViewportResize(): void {
    this.lastVisibleActiveSection = '';
    this.updateMobileNavigationScrollState();
  }

  public selectSection(event: Event, sectionId: string): void {
    event.preventDefault();
    this.sectionSelected.emit(sectionId);
  }

  public scrollMobileNavigation(direction: -1 | 1): void {
    const navigation = this.mobileNavigation?.nativeElement;
    if (!navigation) {
      return;
    }

    navigation.scrollBy({
      left: direction * Math.max(120, navigation.clientWidth * 0.7),
      behavior: 'smooth',
    });
  }

  public updateMobileNavigationScrollState(): void {
    const navigation = this.mobileNavigation?.nativeElement;
    if (!navigation) {
      const activeIndex = this.sections.findIndex(section => section.id === this.activeSection);
      this.canScrollMobileBackward = activeIndex > 0;
      this.canScrollMobileForward = activeIndex >= 0 && activeIndex < this.sections.length - 1;
      return;
    }

    const maximumScrollLeft = Math.max(0, navigation.scrollWidth - navigation.clientWidth);
    this.canScrollMobileBackward = navigation.scrollLeft > 1;
    this.canScrollMobileForward = navigation.scrollLeft < maximumScrollLeft - 1;
  }

  private scheduleActiveSectionScroll(): void {
    if (this.activeSectionScrollFrameId !== null || typeof requestAnimationFrame !== 'function') {
      return;
    }

    this.activeSectionScrollFrameId = requestAnimationFrame(() => {
      this.activeSectionScrollFrameId = null;

      const activeIndex = this.sections.findIndex(section => section.id === this.activeSection);
      const activeTab = activeIndex >= 0 ? this.mobileSectionTabs.get(activeIndex)?.nativeElement : undefined;
      if (!activeTab || activeTab.getClientRects().length === 0 || typeof activeTab.scrollIntoView !== 'function') {
        return;
      }

      activeTab.scrollIntoView({ block: 'nearest', inline: 'center' });
      this.updateMobileNavigationScrollState();
    });
  }
}
