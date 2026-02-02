import { Component, EventEmitter, Output } from '@angular/core';

@Component({
    selector: 'app-tile-actions-footer',
    templateUrl: './tile.actions.footer.component.html',
    styleUrls: ['../tile.actions.abstract.css'],
    standalone: false
})
export class TileActionsFooterComponent {
    @Output() delete = new EventEmitter<MouseEvent>();
}
