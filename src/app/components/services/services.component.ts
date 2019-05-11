import {Component, HostListener} from '@angular/core';
import {FormControl, FormGroup, Validators} from "@angular/forms";
import {MatSnackBar} from "@angular/material";
import * as Raven from "raven-js";
import {HttpClient} from "@angular/common/http";
import {take} from "rxjs/operators";
import {FileService} from "../../services/app.file.service";

declare function require(moduleName: string): any;

const {version: appVersion} = require('../../../../package.json');


@Component({
  selector: 'app-home',
  templateUrl: './services.component.html',
  styleUrls: ['./services.component.css'],
})
export class ServicesComponent {
  public appVersion = appVersion;
  public eventFormGroup: FormGroup;


  constructor(private http: HttpClient, private fileService: FileService,
              private snackBar: MatSnackBar) {
  }


  ngOnInit(): void {
    this.eventFormGroup = new FormGroup({
      input: new FormControl('', [
        Validators.required,
        // Validators.minLength(4),
      ]),
    });
  }

  @HostListener('window:resize', ['$event'])
  getColumnsToDisplayDependingOnScreenSize(event?) {
    return window.innerWidth < 600 ? 1 : 2;
  }


  hasError(field: string) {
    return !(this.eventFormGroup.get(field).valid && this.eventFormGroup.get(field).touched);
  }

  async onSubmit() {
    event.preventDefault();
    if (!this.eventFormGroup.valid) {
      this.validateAllFormFields(this.eventFormGroup);
      return;
    }

    const parts = this.eventFormGroup.get('input').value.split('?')[0].split('/');
    const activityID = parts[parts.length - 1] === '' ? parts[parts.length - 2] : parts[parts.length - 1]
    try {
      const result = await this.http.get(
        `https://us-central1-quantified-self-io.cloudfunctions.net/cors`, {
          params: {
            activityID: activityID
          },
          responseType: 'blob',
        }).toPromise();

      this.fileService.downloadFile(result, activityID, 'fit');
      // .subscribe(response => this.downLoadFile(response, "application/ms-excel"));
      this.snackBar.open('Activity download started', null, {
        duration: 2000,
      });
    } catch (e) {
      this.snackBar.open('Could not download activity. Make sure that the activity is public!', null, {
        duration: 5000,
      });
      Raven.captureException(e);
    }
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
