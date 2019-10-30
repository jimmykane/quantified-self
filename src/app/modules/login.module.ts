import { NgModule } from '@angular/core';
import {ServicesComponent} from '../components/services/services.component';
import {ServicesRoutingModule} from '../services-routing.module';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import {LoginRoutingModule} from '../login-routing.module';
import {LoginComponent} from '../components/login/login.component';
import {UserAgreementFormComponent} from '../components/user-forms/user-agreement.form.component';
import {DeleteConfirmationComponent} from '../components/delete-confirmation/delete-confirmation.component';
import {PhoneFormComponent} from '../components/login/phone-form/phone.form.component';


@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    LoginRoutingModule
  ],
  exports: [
  ],
  declarations: [
    LoginComponent,
    UserAgreementFormComponent,
    DeleteConfirmationComponent,
    PhoneFormComponent,
  ],
  entryComponents: [
    UserAgreementFormComponent,
    DeleteConfirmationComponent,
    PhoneFormComponent,
  ],
  providers: [
  ]
})



export class LoginModule { }
