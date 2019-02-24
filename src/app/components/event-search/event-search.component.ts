import {Component, EventEmitter, Inject, Input, Output} from '@angular/core';
import {FormControl, FormGroup, Validators} from "@angular/forms";
import {EventService} from "../../services/app.event.service";

@Component({
  selector: 'app-event-search',
  templateUrl: './event-search.component.html',
  styleUrls: ['./event-search.component.css'],
})

export class EventSearchComponent {
  @Output() searchChange: EventEmitter<{searchTerm: string, startDate: Date, endDate: Date}> = new EventEmitter<{searchTerm: string, startDate: Date, endDate: Date}>();

  public searchFormGroup: FormGroup;

  constructor(private eventService: EventService) {
  }

  ngOnInit(): void {
    this.searchFormGroup = new FormGroup({
      search: new FormControl(null, [
        // Validators.required,
        // Validators.minLength(4),
      ]),
      startDate: new FormControl(null, [
        // Validators.required,
      ]),
      endDate: new FormControl(null, [
        // Validators.required,
      ]),
    });
  }

  hasError(field: string) {
    if (!field) {
      return !this.searchFormGroup.valid;
    }
    return !(this.searchFormGroup.get(field).valid && this.searchFormGroup.get(field).touched);
  }

  async onSubmit() {
    event.preventDefault();
    if (!this.searchFormGroup.valid) {
      this.validateAllFormFields(this.searchFormGroup);
      return;
    }
    this.searchChange.emit({
      searchTerm: this.searchFormGroup.get('search').value,
      startDate: this.searchFormGroup.get('startDate').value,
      endDate: this.searchFormGroup.get('endDate').value,
    })
  }

  async reset(){
    this.clear('search');
    this.clear('startDate');
    this.clear('endDate');
    this.searchFormGroup.markAsUntouched();
    this.onSubmit();
  }


  async clear(field) {
    this.searchFormGroup.get(field).setValue(null);
  }

  validateAllFormFields(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof FormControl) {
        control.markAsTouched({onlySelf: true});
      } else if (control instanceof FormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }
}
