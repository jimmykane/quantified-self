import {
  ApplicationRef,
  ComponentRef,
  EnvironmentInjector,
  Injectable,
  createComponent,
} from '@angular/core';
import { User } from '@sports-alliance/sports-lib';
import { Subscription } from 'rxjs';
import { AppMapStyleName } from '../../models/app-user.interface';
import { MyTracksMapLayersControlComponent } from '../../components/map/my-tracks-map-layers-control/my-tracks-map-layers-control.component';

export interface MapboxLayersControlInputs {
  user?: User;
  disabled?: boolean;
  mapStyle?: AppMapStyleName;
  is3D?: boolean;
  showJumpHeatmap?: boolean;
  showLaps?: boolean;
  showArrows?: boolean;
  enableJumpHeatmapToggle?: boolean;
  enableLapsToggle?: boolean;
  enableArrowsToggle?: boolean;
  enable3DToggle?: boolean;
  analyticsEventName?: string;
}

export interface MapboxLayersControlOutputs {
  mapStyleChange?: (style: AppMapStyleName) => void;
  is3DChange?: (value: boolean) => void;
  showJumpHeatmapChange?: (value: boolean) => void;
  showLapsChange?: (value: boolean) => void;
  showArrowsChange?: (value: boolean) => void;
}

export interface MapboxLayersControlInstance {
  onAdd(map: unknown): HTMLElement;
  onRemove(): void;
}

export interface MapboxLayersControlHandle {
  control: MapboxLayersControlInstance;
  instance: MyTracksMapLayersControlComponent;
  updateInputs(inputs: Partial<MapboxLayersControlInputs>): void;
  destroy(): void;
}

@Injectable({ providedIn: 'root' })
export class MapboxLayersControlService {
  constructor(
    private applicationRef: ApplicationRef,
    private environmentInjector: EnvironmentInjector,
  ) { }

  public create(config: {
    inputs?: Partial<MapboxLayersControlInputs>;
    outputs?: MapboxLayersControlOutputs;
  } = {}): MapboxLayersControlHandle {
    const container = document.createElement('div');
    const subscriptions = new Subscription();
    let destroyed = false;

    container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';

    const componentRef = createComponent(MyTracksMapLayersControlComponent, {
      environmentInjector: this.environmentInjector,
      hostElement: container,
    });

    this.applicationRef.attachView(componentRef.hostView);

    this.bindOutputs(componentRef, subscriptions, config.outputs);
    this.applyInputs(componentRef, config.inputs || {});

    const destroy = () => {
      if (destroyed) {
        return;
      }

      destroyed = true;
      subscriptions.unsubscribe();

      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }

      this.applicationRef.detachView(componentRef.hostView);
      componentRef.destroy();
    };

    const control: MapboxLayersControlInstance = {
      onAdd: () => {
        return container;
      },
      onRemove: () => {
        destroy();
      },
    };

    return {
      control,
      instance: componentRef.instance,
      updateInputs: (inputs: Partial<MapboxLayersControlInputs>) => {
        if (destroyed) {
          return;
        }

        this.applyInputs(componentRef, inputs);
      },
      destroy,
    };
  }

  private bindOutputs(
    componentRef: ComponentRef<MyTracksMapLayersControlComponent>,
    subscriptions: Subscription,
    outputs?: MapboxLayersControlOutputs,
  ): void {
    if (!outputs) {
      return;
    }

    if (outputs.mapStyleChange) {
      subscriptions.add(componentRef.instance.mapStyleChange.subscribe(outputs.mapStyleChange));
    }

    if (outputs.is3DChange) {
      subscriptions.add(componentRef.instance.is3DChange.subscribe(outputs.is3DChange));
    }

    if (outputs.showJumpHeatmapChange) {
      subscriptions.add(componentRef.instance.showJumpHeatmapChange.subscribe(outputs.showJumpHeatmapChange));
    }

    if (outputs.showLapsChange) {
      subscriptions.add(componentRef.instance.showLapsChange.subscribe(outputs.showLapsChange));
    }

    if (outputs.showArrowsChange) {
      subscriptions.add(componentRef.instance.showArrowsChange.subscribe(outputs.showArrowsChange));
    }
  }

  private applyInputs(
    componentRef: ComponentRef<MyTracksMapLayersControlComponent>,
    inputs: Partial<MapboxLayersControlInputs>,
  ): void {
    const inputKeys = Object.keys(inputs) as (keyof MapboxLayersControlInputs)[];
    for (const inputKey of inputKeys) {
      componentRef.setInput(inputKey, inputs[inputKey] as never);
    }
    componentRef.changeDetectorRef.detectChanges();
  }
}
