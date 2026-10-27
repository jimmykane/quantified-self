import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { AppChartSharedModule } from './app-chart-shared.module';
import { CommonModule } from '@angular/common';
import { LoginRoutingModule } from '../login.routing.module';
import { LoginComponent } from '../components/login/login.component';
import { AccountLinkingDialogComponent } from '../components/login/account-linking-dialog/account-linking-dialog.component';
import { ErrorDialogComponent } from '../components/login/error-dialog/error-dialog.component';




@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        AppChartSharedModule,
        MatButtonModule,
        MatCardModule,
        MatDialogModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatSnackBarModule,
        LoginRoutingModule
    ],
    exports: [],
    declarations: [
        LoginComponent,
        AccountLinkingDialogComponent,
        ErrorDialogComponent,
    ],
    providers: []
})



export class LoginModule { }
