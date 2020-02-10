import {Component, EventEmitter, Input, OnChanges, Output, SimpleChanges} from '@angular/core';
import {Privacy} from '@sports-alliance/sports-lib/lib/privacy/privacy.class.interface';

@Component({
  selector: 'app-edit-input',
  templateUrl: './edit-input.component.html',
  styleUrls: ['./edit-input.component.css'],
})

export class EditInputComponent implements OnChanges{
  @Input() data: string | number;
  @Input() placeHolder: string;
  @Input() type: 'text' | 'number' | 'textArea' | 'select' = 'text';
  @Input() selectOptions: any;
  @Input() selectOptionsArray: string[];
  @Input() disabled: boolean;

  @Output() dataChange: EventEmitter<number|string> = new EventEmitter<number|string>();

  editMode = false;

  ngOnChanges(changes: SimpleChanges): void {
  }

  returnZero(){
    return 0;
  }

  onChange() {
    this.editMode = false;
    this.dataChange.emit(this.data);
  }
}
