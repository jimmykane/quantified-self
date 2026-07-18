import { Component, EventEmitter, Input, Output } from '@angular/core';

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
export class WorkspaceSectionNavigationComponent {
  @Input({ required: true }) public sections: readonly WorkspaceSectionNavigationItem[] = [];
  @Input({ required: true }) public activeSection = '';
  @Input({ required: true }) public navigationLabel = '';
  @Input({ required: true }) public navigationAriaLabel = '';
  @Input() public variant: WorkspaceSectionNavigationVariant = 'settings';
  @Output() public sectionSelected = new EventEmitter<string>();

  public selectSection(event: Event, sectionId: string): void {
    event.preventDefault();
    this.sectionSelected.emit(sectionId);
  }
}
