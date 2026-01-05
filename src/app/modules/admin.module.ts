
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminDashboardComponent } from '../components/admin/admin-dashboard/admin-dashboard.component';
import { RouterModule, Routes } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { adminGuard } from '../authentication/admin.guard';
import { adminResolver } from '../resolvers/admin.resolver';

const routes: Routes = [
    {
        path: '',
        component: AdminDashboardComponent,
        canActivate: [adminGuard],
        resolve: {
            adminData: adminResolver
        }
    }
];

@NgModule({
    imports: [
        CommonModule,
        RouterModule.forChild(routes),
        AdminDashboardComponent
    ]
})
export class AdminModule { }
