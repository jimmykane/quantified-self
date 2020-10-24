import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { AppUserService } from '../../../services/app.user.service';
import { MatSelectionListChange } from '@angular/material/list';


@Component({
  selector: 'app-event-table-actions',
  templateUrl: 'event.table.actions.component.html',
  styleUrls: ['event.table.actions.component.css'],
  providers: [],
})
export class EventTableActionsComponent implements OnInit {
  @Input() selectedDataTypes: string[];
  @Output() selectedDataTypesChange: EventEmitter<string[]> = new EventEmitter<string[]>();
  dataTypes = [
    ...AppUserService.getDefaultSelectedTableColumns(),
  ]

  ngOnInit() {
  }

  selectionChange(event: MatSelectionListChange) {
    this.selectedDataTypesChange.emit(event.source.selectedOptions.selected.map(option => option.value))
  }
}

