import { Injectable, inject } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { Functions, httpsCallable, getFunctions } from '@angular/fire/functions';
import { FunctionName, FUNCTIONS_MANIFEST } from '../../shared/functions-manifest';

@Injectable({
    providedIn: 'root'
})
export class AppFunctionsService {
    private app = inject(FirebaseApp);

    constructor() { }

    async call<RequestData = any, ResponseData = any>(
        functionKey: FunctionName,
        data?: RequestData
    ): Promise<{ data: ResponseData }> {
        const config = FUNCTIONS_MANIFEST[functionKey];
        const functionsInstance = this.getFunctionsInstance(config.region);

        const callable = httpsCallable<RequestData, ResponseData>(functionsInstance, config.name);
        return callable(data);
    }



    private getFunctionsInstance(region: string): Functions {
        return getFunctions(this.app, region);
    }
}
