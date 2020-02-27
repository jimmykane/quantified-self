import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
} from '@angular/core';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import {UserService} from '../../../../../services/app.user.service';

@Component({
  selector: 'app-map-actions',
  templateUrl: './map.actions.component.html',
  styleUrls: ['./map.actions.component.css'],
  providers: [],
})

export class MapActionsComponent implements OnChanges {

  @Input() showLaps: boolean;
  @Input() showArrows: boolean;
  @Input() user: User;

  @Output() showLapsChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() showArrowsChange: EventEmitter<boolean> = new EventEmitter<boolean>();


  constructor(
    private userService: UserService) {
  }

  async checkBoxChanged(event) {
    this.showLapsChange.emit(this.showLaps);
    this.showArrowsChange.emit(this.showArrows);
  }

  ngOnChanges(simpleChanges) {
    // debugger;
  }
}
