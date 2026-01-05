import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { AppUserService } from '../../../services/app.user.service';
import { MatSelectionListChange } from '@angular/material/list';


@Component({
    selector: 'app-event-table-actions',
    templateUrl: 'event.table.actions.component.html',
    styleUrls: ['event.table.actions.component.css'],
    providers: [],
    standalone: false
})
export class EventTableActionsComponent implements OnInit {
  @Input() selectedDataTypes: string[];
  @Output() selectedDataTypesChange: EventEmitter<string[]> = new EventEmitter<string[]>();
  dataTypes = [
    ...AppUserService.getDefaultSelectedTableColumns().filter(a => a !== 'Start Date'),
  ]

  ngOnInit() {
  }

  selectionChange(event: MatSelectionListChange) {
    this.selectedDataTypes = event.source.selectedOptions.selected.map(option => option.value);
  }

  menuClosed() {
    this.selectedDataTypesChange.emit(this.selectedDataTypes)
  }
}

