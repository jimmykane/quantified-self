import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminDashboardComponent } from '../components/admin/admin-dashboard/admin-dashboard.component';
import { AdminMaintenanceComponent } from '../components/admin/admin-maintenance/admin-maintenance.component';
import { AdminUserManagementComponent } from '../components/admin/admin-user-management/admin-user-management.component';
import { AdminChangelogComponent } from '../components/admin/admin-changelog/admin-changelog.component';
import { AdminQueueMonitorComponent } from '../components/admin/admin-queue-monitor/admin-queue-monitor.component';
import { RouterModule, Routes } from '@angular/router';
import { adminGuard } from '../authentication/admin.guard';
import { adminResolver } from '../resolvers/admin.resolver';

export const adminRoutes: Routes = [
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
    },
    {
        path: 'changelog',
        component: AdminChangelogComponent,
        canActivate: [adminGuard]
    },
    {
        path: 'queues/workout',
        component: AdminQueueMonitorComponent,
        canActivate: [adminGuard],
        data: {
            queueView: 'workout'
        }
    },
    {
        path: 'queues/activity-sync',
        component: AdminQueueMonitorComponent,
        canActivate: [adminGuard],
        data: {
            queueView: 'activity-sync'
        }
    },
    {
        path: 'queues/sleep-sync',
        component: AdminQueueMonitorComponent,
        canActivate: [adminGuard],
        data: {
            queueView: 'sleep-sync'
        }
    },
    {
        path: 'queues/reparse',
        component: AdminQueueMonitorComponent,
        canActivate: [adminGuard],
        data: {
            queueView: 'reparse'
        }
    },
    {
        path: 'queues/route-reparse',
        component: AdminQueueMonitorComponent,
        canActivate: [adminGuard],
        data: {
            queueView: 'route-reparse'
        }
    },
    {
        path: 'queues/derived-metrics',
        component: AdminQueueMonitorComponent,
        canActivate: [adminGuard],
        data: {
            queueView: 'derived'
        }
    }
];

@NgModule({
    imports: [
        CommonModule,
        RouterModule.forChild(adminRoutes),
        AdminDashboardComponent,
        AdminMaintenanceComponent,
        AdminUserManagementComponent,
        AdminChangelogComponent,
        AdminQueueMonitorComponent
    ]
})
export class AdminModule { }
