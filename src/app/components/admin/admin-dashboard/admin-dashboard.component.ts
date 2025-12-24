
import { Component, OnInit, ViewChild } from '@angular/core';
import { AdminService, AdminUser } from '../../../services/admin.service';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { MatPaginator } from '@angular/material/paginator';

import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
    selector: 'app-admin-dashboard',
    templateUrl: './admin-dashboard.component.html',
    styleUrls: ['./admin-dashboard.component.css'],
    standalone: true,
    imports: [
        CommonModule,
        MatTableModule,
        MatPaginatorModule,
        MatSortModule,
        MatInputModule,
        MatFormFieldModule,
        MatIconModule,
        MatProgressSpinnerModule
    ]
})
export class AdminDashboardComponent implements OnInit {
    displayedColumns: string[] = ['photoURL', 'email', 'displayName', 'role', 'admin', 'created', 'lastLogin', 'status'];
    dataSource: MatTableDataSource<AdminUser>;

    @ViewChild(MatPaginator) paginator!: MatPaginator;
    @ViewChild(MatSort) sort!: MatSort;

    isLoading = true;
    error: string | null = null;

    constructor(private adminService: AdminService) {
        this.dataSource = new MatTableDataSource<AdminUser>([]);
    }

    ngOnInit(): void {
        this.fetchUsers();
    }

    fetchUsers() {
        this.isLoading = true;
        this.adminService.getUsers().subscribe({
            next: (users) => {
                this.dataSource.data = users;
                this.dataSource.paginator = this.paginator;
                this.dataSource.sort = this.sort;
                this.isLoading = false;
            },
            error: (err) => {
                this.error = 'Failed to load users. ' + (err.message || '');
                this.isLoading = false;
                console.error('AdminDashboard error:', err);
            }
        });
    }

    applyFilter(event: Event) {
        const filterValue = (event.target as HTMLInputElement).value;
        this.dataSource.filter = filterValue.trim().toLowerCase();

        if (this.dataSource.paginator) {
            this.dataSource.paginator.firstPage();
        }
    }

    getRole(user: AdminUser): string {
        return user.customClaims.stripeRole || 'free';
    }

    isAdmin(user: AdminUser): boolean {
        return user.customClaims.admin === true;
    }
}
