import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Firestore, doc, runTransaction } from '../firebase/firestore';
import { DashboardChartDiscoveryService } from './dashboard-chart-discovery.service';
import type { AppUserInterface } from '../models/app-user.interface';

vi.mock('../firebase/firestore', () => ({ Firestore: 'Firestore', doc: vi.fn(), runTransaction: vi.fn() }));
const user = (uid = 'owner', seen = 1) => ({ uid, settings: { appSettings: { dashboardChartLibrarySeen: { kpi: seen } } } } as AppUserInterface);

describe('chart discovery acknowledgement', () => {
  let service: DashboardChartDiscoveryService;
  let stored: number;
  let set: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: {} }] });
    service = TestBed.inject(DashboardChartDiscoveryService);
    stored = 1; set = vi.fn();
    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => callback({
      get: async () => ({ data: () => ({ appSettings: { dashboardChartLibrarySeen: { kpi: stored } } }) }), set,
    } as never));
  });

  it('computes the badge without requests and writes only an advanced section acknowledgement', async () => {
    expect(service.seenRevision(user(), 'kpi')).toBe(1);
    await service.acknowledge(user(), 'kpi', 1);
    expect(runTransaction).not.toHaveBeenCalled();
    await service.acknowledge(user(), 'kpi', 2);
    expect(doc).toHaveBeenCalledWith({}, 'users', 'owner', 'config', 'settings');
    expect(set).toHaveBeenCalledWith(undefined, { appSettings: { dashboardChartLibrarySeen: { kpi: 2 } } }, { merge: true });
    await service.acknowledge(user(), 'kpi', 2);
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(service.seenRevision(user(), 'section:trainingState')).toBe(1);
    expect(service.seenRevision(user('other'), 'kpi')).toBe(1);
  });

  it('never overwrites a newer acknowledgement from another device', async () => {
    stored = 4;
    await service.acknowledge(user(), 'kpi', 2);
    expect(set).not.toHaveBeenCalled();
    expect(service.seenRevision(user(), 'kpi')).toBe(4);
    expect(service.seenRevision(user('owner', 5), 'kpi')).toBe(5);
  });

  it('coalesces concurrent openings and can advance again for a newer release', async () => {
    await Promise.all([service.acknowledge(user(), 'kpi', 2), service.acknowledge(user(), 'kpi', 2)]);
    expect(runTransaction).toHaveBeenCalledTimes(1);
    await service.acknowledge(user(), 'kpi', 3);
    expect(service.seenRevision(user(), 'kpi')).toBe(3);
    expect(runTransaction).toHaveBeenCalledTimes(2);
  });

  it('does not acknowledge a failed save or retry it automatically', async () => {
    vi.mocked(runTransaction).mockRejectedValueOnce(new Error('offline'));
    await expect(service.acknowledge(user(), 'kpi', 2)).rejects.toThrow('offline');
    expect(service.seenRevision(user(), 'kpi')).toBe(1);
    expect(runTransaction).toHaveBeenCalledTimes(1);
    await service.acknowledge(user(), 'kpi', 2);
    expect(service.seenRevision(user(), 'kpi')).toBe(2);
  });
});
