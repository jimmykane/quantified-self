import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminDashboardComponent } from '../components/admin/admin-dashboard/admin-dashboard.component';
import { AdminMaintenanceComponent } from '../components/admin/admin-maintenance/admin-maintenance.component';
import { RouterModule, Routes } from '@angular/router';
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
    },
    {
        path: 'maintenance',
        component: AdminMaintenanceComponent,
        canActivate: [adminGuard]
    }
];

@NgModule({
    imports: [
        CommonModule,
        RouterModule.forChild(routes),
        AdminDashboardComponent,
        AdminMaintenanceComponent
    ]
})
export class AdminModule { }
