import type { SuuntoGuideClient, SuuntoGuideRequest, SuuntoGuideResponse } from '../suunto/http';
import { readGuideArchive, packageGuide } from '../suunto/archive';
import type { SuuntoGuideJsonV1 } from '../../providers/suunto-guide.serializer';

/** In-memory provider only. Not exported from or included in the Functions build. */
export class SuuntoHttpFixture {
  readonly guides = new Map<string, { guide: SuuntoGuideJsonV1; pinned: boolean }>();
  readonly calls: SuuntoGuideRequest[] = [];
  afterHandle: ((request: SuuntoGuideRequest) => Promise<void>) | null = null;
  private sequence = 0;
  request: SuuntoGuideClient = async (request, guard) => {
    await guard(); this.calls.push(request);
    const response = await this.handle(request);
    await this.afterHandle?.(request); return response;
  };
  private meta(id: string) {
    const row = this.guides.get(id)!;
    return { ...row.guide, id, username: 'fixture-account', pinned: row.pinned };
  }
  private async handle(request: SuuntoGuideRequest): Promise<SuuntoGuideResponse> {
    if (request.path.startsWith('/v2/guides/items?')) {
      const offset = Number(new URL(`https://fixture.test${request.path}`).searchParams.get('offset'));
      return { status: 200, body: [...this.guides.keys()].slice(offset, offset + 50).map(id => this.meta(id)) };
    }
    const id = request.path.split('/')[4];
    if (request.method === 'GET') return this.guides.has(id)
      ? { status: 200, body: await packageGuide(this.guides.get(id)!.guide) } : { status: 404, body: null };
    if (request.method === 'DELETE') return { status: this.guides.delete(id) ? 200 : 404, body: null };
    const guide = await readGuideArchive(request.body) as unknown as SuuntoGuideJsonV1;
    if (request.method === 'POST') {
      if ([...this.guides.values()].some(row => row.guide.externalId === guide.externalId)) return { status: 409, body: null };
      const createdId = `guide-${++this.sequence}`; this.guides.set(createdId, { guide, pinned: false });
      return { status: 201, body: this.meta(createdId) };
    }
    if (!this.guides.has(id)) return { status: 404, body: null };
    this.guides.set(id, { ...this.guides.get(id)!, guide }); return { status: 200, body: this.meta(id) };
  }
}
