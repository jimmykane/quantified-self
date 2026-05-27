/// <reference lib="webworker" />

import {
  buildEventChartPanelsFromSnapshot,
  collectEventChartPanelTransferables,
} from '../helpers/event-echarts-data.helper';
import type {
  EventChartPanelWorkerRequest,
  EventChartPanelWorkerResponse,
} from '../helpers/event-echarts-data.helper';

addEventListener('message', (event: MessageEvent<EventChartPanelWorkerRequest>) => {
  const requestID = Number(event.data?.requestID);

  try {
    const panels = buildEventChartPanelsFromSnapshot(event.data.input);
    const response: EventChartPanelWorkerResponse = { requestID, panels };
    postMessage(response, collectEventChartPanelTransferables(panels));
  } catch (error) {
    const response: EventChartPanelWorkerResponse = {
      requestID,
      error: error instanceof Error ? error.message : `${error}`,
    };
    postMessage(response);
  }
});
