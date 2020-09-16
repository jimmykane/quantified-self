import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import * as Sentry from '@sentry/browser';
import { EventImporterFIT } from '@sports-alliance/sports-lib/lib/events/adapters/importers/fit/importer.fit';
import { environment } from '../../../../environments/environment';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';
import { ParamMap } from '@angular/router';


@Component({
  selector: 'app-services-suunto',
  templateUrl: './services.suunto.component.html',
  styleUrls: ['../services-abstract-component.directive.css', './services.suunto.component.css'],
})
export class ServicesSuuntoComponent extends ServicesAbstractComponentDirective implements OnInit{
  public suuntoAppLinkFormGroup: FormGroup;

  public serviceName = ServiceNames.SuuntoApp;

  isConnectedToService(): boolean {
    return !!this.serviceTokens && !!this.serviceTokens.length
  }

  buildRedirectURIFromServiceToken(token: {redirect_uri: string}): string {
    return token.redirect_uri
  }

  async requestAndSetToken() {
    const state = this.route.snapshot.queryParamMap.get('state');
    const code = this.route.snapshot.queryParamMap.get('code');
    if (state && code) {
      await this.userService.requestAndSetCurrentUserSuuntoAppAccessToken(state, code);
    }
  }

  async ngOnInit() {
    this.suuntoAppLinkFormGroup = new FormGroup({
      input: new FormControl('', [
        Validators.required,
        // Validators.minLength(4),
      ]),
    });
  }

  hasError(field: string) {
    return !(this.suuntoAppLinkFormGroup.get(field).valid && this.suuntoAppLinkFormGroup.get(field).touched);
  }

  async onImportAndOpen() {
    return this.onSubmit(true);
  }

  async onSubmit(shouldImportAndOpen?: boolean) {
    if (!this.suuntoAppLinkFormGroup.valid) {
      this.validateAllFormFields(this.suuntoAppLinkFormGroup);
      return;
    }

    if (this.isLoading) {
      return false;
    }

    this.isLoading = true;

    try {

      const parts = this.suuntoAppLinkFormGroup.get('input').value.split('?')[0].split('/');
      const activityID = parts[parts.length - 1] === '' ? parts[parts.length - 2] : parts[parts.length - 1];

      const result = await this.http.get(
        environment.functions.stWorkoutDownloadAsFit, {
          params: {
            activityID: activityID
          },
          responseType: 'arraybuffer',
        }).toPromise();

      if (!shouldImportAndOpen) {
        this.fileService.downloadFile(new Blob([new Uint8Array(result)]), activityID, 'fit');
        // .subscribe(response => this.downLoadFile(response, "application/ms-excel"));
        this.snackBar.open('Activity download started', null, {
          duration: 2000,
        });
        this.afa.logEvent('downloaded_fit_file', {method: ServiceNames.SuuntoApp});
      } else {
        const newEvent = await EventImporterFIT.getFromArrayBuffer(result);
        await this.eventService.writeAllEventData(this.user, newEvent);
        this.afa.logEvent('imported_fit_file', {method: ServiceNames.SuuntoApp});
        await this.router.navigate(['/user', this.user.uid, 'event', newEvent.getID()], {});
      }
    } catch (e) {
      this.snackBar.open('Could not open activity. Make sure that the activity is public by opening the link in a new browser tab', null, {
        duration: 5000,
      });
      Sentry.captureException(e);
    } finally {
      this.isLoading = false;
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
