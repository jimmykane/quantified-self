import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppUserUtilities } from '../../../utils/app.user.utilities';
import { MatSelectionListChange } from '@angular/material/list';


@Component({
  selector: 'app-event-table-actions',
  templateUrl: 'event.table.actions.component.html',
  styleUrls: ['event.table.actions.component.css'],
  providers: [],
  standalone: false
})
export class EventTableActionsComponent implements OnInit {
  private readonly haptics = inject(AppHapticsService);
  @Input() selectedDataTypes: string[];
  @Input() icon = 'more_vert';
  @Input() disabled = false;
  @Output() selectedDataTypesChange: EventEmitter<string[]> = new EventEmitter<string[]>();
  @Input() dataTypes = [
    ...AppUserUtilities.getDefaultSelectedTableColumns().filter(a => a !== 'Start Date'),
  ]

  ngOnInit() {
  }

  selectionChange(event: MatSelectionListChange) {
    if (this.disabled) return;
    const next = event.source.selectedOptions.selected.map(option => option.value);
    if (next.length === this.selectedDataTypes.length && next.every((value, index) => value === this.selectedDataTypes[index])) return;
    this.selectedDataTypes = next;
    this.haptics.selection();
  }

  menuClosed() {
    this.selectedDataTypesChange.emit(this.selectedDataTypes)
  }
}

