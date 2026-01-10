import { Component, Input, OnInit } from '@angular/core';
import { rowsAnimation } from '../../animations/animations';

@Component({
  selector: 'app-shade',
  templateUrl: './shade.component.html',
  styleUrls: ['./shade.component.css'],
  animations: [
    rowsAnimation,
  ],
  standalone: false
})

export class ShadeComponent {
  @Input() isActive: boolean;
  @Input() hasError: boolean;
  @Input() errorMessage: string;
  @Input() mode: 'determinate' | 'indeterminate' | 'buffer' | 'query' = 'buffer';
}
