import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminDashboardComponent } from '../components/admin/admin-dashboard/admin-dashboard.component';
import { AdminMaintenanceComponent } from '../components/admin/admin-maintenance/admin-maintenance.component';
import { AdminUserManagementComponent } from '../components/admin/admin-user-management/admin-user-management.component';
import { RouterModule, Routes } from '@angular/router';
import { adminGuard } from '../authentication/admin.guard';
import { adminResolver } from '../resolvers/admin.resolver';

const routes: Routes = [
    {
        path: '',
        component: AdminDashboardComponent,
        canActivate: [adminGuard]
    },
    {
        path: 'maintenance',
        component: AdminMaintenanceComponent,
        canActivate: [adminGuard]
    },
    {
        path: 'users',
        component: AdminUserManagementComponent,
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
        AdminDashboardComponent,
        AdminMaintenanceComponent,
        AdminUserManagementComponent
    ]
})
export class AdminModule { }
