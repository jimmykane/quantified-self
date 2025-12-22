import { NgModule } from '@angular/core';
import { MaterialModule } from './material.module';
import { SharedModule } from './shared.module';
import { CommonModule } from '@angular/common';
import { LoginRoutingModule } from '../login.routing.module';
import { LoginComponent } from '../components/login/login.component';
import { UserAgreementFormComponent } from '../components/user-forms/user-agreement.form.component';
import { DeleteConfirmationComponent } from '../components/delete-confirmation/delete-confirmation.component';



@NgModule({
    imports: [
        CommonModule,
        SharedModule,
        MaterialModule,
        LoginRoutingModule
    ],
    exports: [],
    declarations: [
        LoginComponent,
        UserAgreementFormComponent,
    ],
    providers: []
})



export class LoginModule { }
