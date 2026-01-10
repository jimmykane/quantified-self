import 'zone.js';
import 'zone.js/testing';
import { getTestBed } from '@angular/core/testing';
import {
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';


getTestBed().initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting(),
);

// Mock Google Maps globally for component tests
(globalThis as any).google = {
    maps: {
        Map: class {
            setOptions() { }
            fitBounds() { }
            panTo() { }
            setZoom() { }
        },
        LatLng: class {
            constructor(public lat: number, public lng: number) { }
        },
        LatLngBounds: class {
            extend() { }
            getCenter() { return { lat: 0, lng: 0 }; }
        },
        Marker: class {
            setMap() { }
            addListener() { return { remove: () => { } }; }
            setPosition() { }
            setIcon() { }
            setTitle() { }
            setLabel() { }
        },
        MapTypeId: {
            ROADMAP: 'roadmap',
            SATELLITE: 'satellite',
            HYBRID: 'hybrid',
            TERRAIN: 'terrain'
        },
        SymbolPath: {
            CIRCLE: 0,
            FORWARD_CLOSED_ARROW: 1,
            FORWARD_OPEN_ARROW: 2,
            BACKWARD_CLOSED_ARROW: 3,
            BACKWARD_OPEN_ARROW: 4
        },
        visualization: {
            HeatmapLayer: class {
                setData() { }
                setMap() { }
            }
        },
        event: {
            addListener: () => ({ remove: () => { } }),
            addListenerOnce: () => ({ remove: () => { } }),
            clearInstanceListeners: () => { },
            trigger: () => { }
        }
    }
};
