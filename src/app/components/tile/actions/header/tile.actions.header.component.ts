import { Component, EventEmitter, Output } from '@angular/core';

@Component({
    selector: 'app-tile-actions-header',
    templateUrl: './tile.actions.header.component.html',
    styleUrls: ['../tile.actions.abstract.css'],
    standalone: false
})
export class TileActionsHeaderComponent {
    @Output() add = new EventEmitter<MouseEvent>();
}
