import { NgZone } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { MyTracksMapViewFactory } from './my-tracks-map-view.factory';

describe('MyTracksMapViewFactory', () => {
  const createFactory = () => {
    const map = {
      addControl: vi.fn(),
      remove: vi.fn(),
    };
    const mapboxgl = {
      FullscreenControl: class {},
      NavigationControl: class {},
      ScaleControl: class {},
    };
    const mapboxLoader = {
      createMap: vi.fn().mockResolvedValue(map),
      loadMapbox: vi.fn().mockResolvedValue(mapboxgl),
    };
    const autoResize = {
      bind: vi.fn(),
      unbind: vi.fn(),
    };
    const factory = new MyTracksMapViewFactory(
      { runOutsideAngular: (callback: () => unknown) => callback() } as NgZone,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      autoResize as never,
      mapboxLoader as never,
      {} as never,
    );

    return { factory, map, mapboxgl, mapboxLoader, autoResize };
  };

  it('initializes the production track manager, preview controls, resize, and cleanup once', async () => {
    const { factory, map, mapboxLoader, autoResize } = createFactory();
    const manager = { setMap: vi.fn() } as never;
    const container = document.createElement('div');
    const onResize = vi.fn();

    const handle = await factory.initialize(
      manager,
      container,
      { center: [23.7, 38], zoom: 9 },
      { controlMode: 'preview', onResize },
    );

    expect(mapboxLoader.createMap).toHaveBeenCalledWith(container, {
      center: [23.7, 38],
      zoom: 9,
    });
    expect((manager as { setMap: ReturnType<typeof vi.fn> }).setMap).toHaveBeenCalled();
    expect(autoResize.bind).toHaveBeenCalledWith(map, { container, onResize });
    expect(map.addControl).toHaveBeenCalledTimes(2);

    handle.destroy();
    handle.destroy();

    expect(autoResize.unbind).toHaveBeenCalledTimes(1);
    expect(map.remove).toHaveBeenCalledTimes(1);
  });

  it('removes a partially initialized map when the Mapbox module cannot load', async () => {
    const { factory, map, mapboxLoader } = createFactory();
    mapboxLoader.loadMapbox.mockRejectedValueOnce(new Error('module unavailable'));

    await expect(factory.initialize(
      { setMap: vi.fn() } as never,
      document.createElement('div'),
      {},
    )).rejects.toThrow('module unavailable');
    expect(map.remove).toHaveBeenCalledTimes(1);
  });

  it('unbinds resize handling when preview control setup fails', async () => {
    const { factory, map, autoResize } = createFactory();
    map.addControl
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('control failed');
      });

    await expect(factory.initialize(
      { setMap: vi.fn() } as never,
      document.createElement('div'),
      {},
      { controlMode: 'preview' },
    )).rejects.toThrow('control failed');

    expect(autoResize.unbind).toHaveBeenCalledWith(map);
    expect(map.remove).toHaveBeenCalledTimes(1);
  });

  it('unbinds a partial resize binding when resize setup throws', async () => {
    const { factory, map, autoResize } = createFactory();
    autoResize.bind.mockImplementationOnce(() => {
      throw new Error('resize binding failed');
    });

    await expect(factory.initialize(
      { setMap: vi.fn() } as never,
      document.createElement('div'),
      {},
      { controlMode: 'preview' },
    )).rejects.toThrow('resize binding failed');

    expect(autoResize.unbind).toHaveBeenCalledWith(map);
    expect(map.remove).toHaveBeenCalledTimes(1);
    expect(map.addControl).not.toHaveBeenCalled();
  });
});
