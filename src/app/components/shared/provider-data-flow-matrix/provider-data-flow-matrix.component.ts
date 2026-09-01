import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type {
  ProviderDataFlowMatrixRoute,
  ProviderDataFlowMatrixRow,
} from './provider-data-flow-matrix.helper';

@Component({
  selector: 'app-provider-data-flow-matrix',
  templateUrl: './provider-data-flow-matrix.component.html',
  styleUrl: './provider-data-flow-matrix.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatButtonModule, MatIconModule, NgTemplateOutlet],
})
export class ProviderDataFlowMatrixComponent {
  readonly rows = input<readonly ProviderDataFlowMatrixRow[]>([]);
  readonly caption = input('Automatic delivery routes through Quantified Self');
  readonly interactive = input(true);
  readonly compact = input(false);
  readonly showRouteState = input(true);
  readonly routeSelect = output<ProviderDataFlowMatrixRoute>();

  selectRoute(route: ProviderDataFlowMatrixRoute): void {
    if (!this.interactive()) {
      return;
    }
    this.routeSelect.emit(route);
  }
}
