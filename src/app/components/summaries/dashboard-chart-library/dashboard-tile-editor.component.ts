import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { ActivityTypes } from '@sports-alliance/sports-lib';
import type { AppDashboardTileEventFilterRange } from '../../../models/app-user.interface';
import { DashboardTileConfiguration } from './dashboard-tile-configuration';
@Component({ selector: 'app-dashboard-tile-editor', standalone: false, templateUrl: './dashboard-tile-editor.component.html', styleUrls: ['./dashboard-tile-editor.component.css'] })
export class DashboardTileEditorComponent {
  @Input() showCategorySelector = true;
  @Input() disabled = false;
  @Input({ required: true }) configuration: DashboardTileConfiguration;
  async changeRange(target: 'custom' | 'map', range: AppDashboardTileEventFilterRange): Promise<void> {
    if (target === 'custom') await this.configuration.onCustomEventRangeChange(range);
    else await this.configuration.onMapEventRangeChange(range);
    this.changed.emit();
  }
  changeSports(target: 'custom' | 'map', sports: ActivityTypes[]): void {
    if (this.disabled) return;
    if (target === 'custom') this.configuration.onCustomEventActivityTypesChange(sports);
    else this.configuration.onMapEventActivityTypesChange(sports);
    this.changed.emit();
  }
  @Output() changed = new EventEmitter<void>();
}
