import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { AppUserService } from '../../../../services/app.user.service';
import { TileActionsAbstractDirective } from '../tile-actions-abstract.directive';

@Component({
  selector: 'app-tile-map-actions',
  templateUrl: './tile.map.actions.component.html',
  styleUrls: ['../tile.actions.abstract.css', './tile.map.actions.component.css'],
  providers: [],
  standalone: false
})
export class TileMapActionsComponent extends TileActionsAbstractDirective implements OnInit {
  @Output() editInDashboardManager = new EventEmitter<number>();

  constructor(
    userService: AppUserService) {
    super(userService);
  }


  ngOnInit(): void {
    if (!this.user) {
      throw new Error('Component needs user');
    }
  }

  openEditInDashboardManager(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.editInDashboardManager.emit(this.order);
  }
}
