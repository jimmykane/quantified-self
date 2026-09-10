import { DASHBOARD_TILE_PRESENTATIONS, DashboardTilePresentation } from '../../../../helpers/dashboard-tile-presentation.helper';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-tile-actions-footer',
    templateUrl: './tile.actions.footer.component.html',
    styleUrls: ['../tile.actions.abstract.css'],
    standalone: false
})
export class TileActionsFooterComponent {
    @Input() presentation: DashboardTilePresentation = DASHBOARD_TILE_PRESENTATIONS.tile;
    @Input() disabled = false;
    @Output() delete = new EventEmitter<MouseEvent>();

    onDeleteClick(event: MouseEvent): void {
        if (!this.disabled) this.delete.emit(event);
    }
}
