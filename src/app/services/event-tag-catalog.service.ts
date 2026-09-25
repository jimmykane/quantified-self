import { inject, Injectable } from '@angular/core';
import { AppFunctionsService } from './app.functions.service';

@Injectable({ providedIn: 'root' })
export class EventTagCatalogService {
  private functionsService = inject(AppFunctionsService);

  async listAllTags(): Promise<string[]> {
    const response = await this.functionsService.call<undefined, { tags: string[] }>('listEventTags');
    return response.data.tags;
  }
}
