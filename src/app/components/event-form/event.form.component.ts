import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, OnInit} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {FormBuilder, FormControl, FormGroup, FormGroupDirective, NgForm, Validators} from '@angular/forms';
import {ErrorStateMatcher, MAT_DIALOG_DATA} from '@angular/material';


@Component({
  selector: 'app-event-form-actions-menu',
  templateUrl: './event.form.component.html',
  styleUrls: ['./event.form.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})


export class EventFormComponent implements OnInit {

  public event: EventInterface;

  public eventFormGroup: FormGroup;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: any,
    private eventService: EventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private formBuilder: FormBuilder) {
    this.event = data.event;
  }

  ngOnInit(): void {
    this.eventFormGroup = new FormGroup({
      'name': new FormControl(this.event.name, [
        Validators.required,
        Validators.minLength(4),
      ]),
      // 'alterEgo': new FormControl(this.hero.alterEgo),
      // 'power': new FormControl(this.hero.power, Validators.required)
    });
  }

  isFieldValid(field: string) {
    return !this.eventFormGroup.get(field).valid && this.eventFormGroup.get(field).touched;
  }
}
