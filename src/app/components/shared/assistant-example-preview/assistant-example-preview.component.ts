import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ASSISTANT_STARTER_PROMPTS } from '@shared/assistant.prompts';
import { TypedPromptRotatorComponent } from '../typed-prompt-rotator/typed-prompt-rotator.component';

@Component({
  selector: 'app-assistant-example-preview',
  standalone: true,
  imports: [MatIconModule, TypedPromptRotatorComponent],
  templateUrl: './assistant-example-preview.component.html',
  styleUrls: ['./assistant-example-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantExamplePreviewComponent {
  readonly prompts = ASSISTANT_STARTER_PROMPTS;
}
