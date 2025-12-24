
import { inject, Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface AdminUser {
    uid: string;
    email: string;
    displayName?: string;
    photoURL?: string;
    customClaims: {
        stripeRole?: string;
        admin?: boolean;
        [key: string]: any;
    };
    metadata: {
        lastSignInTime: string;
        creationTime: string;
    };
    disabled: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class AdminService {
    private functions = inject(Functions);

    getUsers(): Observable<AdminUser[]> {
        const listUsers = httpsCallable<{ users: AdminUser[] }, { users: AdminUser[] }>(this.functions, 'listUsers');
        return from(listUsers()).pipe(
            map(result => result.data.users)
        );
    }
}
