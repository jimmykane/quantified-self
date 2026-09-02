import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-mcp-read-only-flow-preview',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './mcp-read-only-flow-preview.component.html',
  styleUrls: ['./mcp-read-only-flow-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class McpReadOnlyFlowPreviewComponent {}
