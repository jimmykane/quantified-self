
import { NgModule } from '@angular/core';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';
import { DayjsDateAdapter } from './dayjs-date-adapter';

export const MAT_DAYJS_DATE_FORMATS = {
    parse: {
        dateInput: 'L',
    },
    display: {
        dateInput: 'L',
        monthYearLabel: 'MMM YYYY',
        dateA11yLabel: 'LL',
        monthYearA11yLabel: 'MMMM YYYY',
    },
};

@NgModule({
    providers: [
        {
            provide: DateAdapter,
            useClass: DayjsDateAdapter,
            deps: [MAT_DATE_LOCALE, MAT_DATE_FORMATS]
        },
        { provide: MAT_DATE_FORMATS, useValue: MAT_DAYJS_DATE_FORMATS },
    ],
})
export class MatDayjsDateModule { }
