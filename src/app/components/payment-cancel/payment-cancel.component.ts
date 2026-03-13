import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { RouterModule } from '@angular/router';

@Component({
    selector: 'app-payment-cancel',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatButtonModule, RouterModule],
    templateUrl: './payment-cancel.component.html',
    styleUrls: ['./payment-cancel.component.scss']
})
export class PaymentCancelComponent {
    constructor() { }
}
