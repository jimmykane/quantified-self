import { Component, Input } from '@angular/core';
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
  @Input() allowErrorPassthrough: boolean = false;
  @Input() errorMessage: string;
  @Input() hint?: string;
  @Input() icon: string = 'insights';
  @Input() showProgressBar: boolean = true;
  @Input() mode: 'determinate' | 'indeterminate' | 'buffer' | 'query' = 'indeterminate';
}
