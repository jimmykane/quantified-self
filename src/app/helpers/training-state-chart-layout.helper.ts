// Keep the plot baseline independent of label measurement and tile height.
// Chart layouts reserve a further 8px below the canvas.
export const TRAINING_STATE_PLOT_BOTTOM = 24;
export const TRAINING_STATE_AXIS_LABEL = {
  margin: 3,
  lineHeight: 14,
  fontSize: 11,
  fontWeight: 'normal',
} as const;

export function trainingStateChartGrid() {
  return {
    bottom: TRAINING_STATE_PLOT_BOTTOM,
    outerBoundsMode: 'auto' as const,
    outerBounds: { left: 6, right: 6, top: 0, bottom: 6 },
    outerBoundsContain: 'axisLabel' as const,
  };
}
