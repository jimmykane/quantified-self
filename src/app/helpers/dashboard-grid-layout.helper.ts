export interface DashboardGridSizedItem {
  size?: {
    columns?: number | string | null;
    rows?: number | string | null;
  } | null;
}

export interface SparseEqualWidthDashboardGridLayout {
  columns: number;
  itemColumns: number;
}

export function getSparseEqualWidthDashboardGridLayout(
  itemCountValue: number | string | null | undefined,
  columnCount: number | string | null | undefined,
): SparseEqualWidthDashboardGridLayout | null {
  const itemCount = normalizePositiveInteger(itemCountValue, 0);
  const maxColumns = normalizePositiveInteger(columnCount, 1);
  if (itemCount < 2 || maxColumns <= 1 || itemCount > maxColumns) {
    return null;
  }

  const itemColumns = Math.floor(maxColumns / itemCount);
  if (itemColumns < 1) {
    return null;
  }

  return {
    columns: itemColumns * itemCount,
    itemColumns,
  };
}

export function getTrailingDashboardGridPlaceholderCount(
  items: readonly DashboardGridSizedItem[],
  columnCount: number | string | null | undefined,
): number {
  const maxColumns = normalizePositiveInteger(columnCount, 1);
  if (maxColumns <= 1 || !items.length) {
    return 0;
  }

  const occupiedCells = new Set<string>();
  let cursorRow = 0;
  let cursorColumn = 0;

  items.forEach((item) => {
    const itemColumns = Math.min(normalizePositiveInteger(item.size?.columns, 1), maxColumns);
    const itemRows = normalizePositiveInteger(item.size?.rows, 1);
    const placement = findNextGridPlacement(
      occupiedCells,
      maxColumns,
      cursorRow,
      cursorColumn,
      itemColumns,
      itemRows,
    );

    for (let row = placement.row; row < placement.row + itemRows; row += 1) {
      for (let column = placement.column; column < placement.column + itemColumns; column += 1) {
        occupiedCells.add(getGridCellKey(row, column));
      }
    }

    cursorRow = placement.row;
    cursorColumn = placement.column + itemColumns;
    if (cursorColumn >= maxColumns) {
      cursorRow += 1;
      cursorColumn = 0;
    }
  });

  const currentRowHasContent = Array.from({ length: maxColumns }, (_, column) => column)
    .some(column => occupiedCells.has(getGridCellKey(cursorRow, column)));
  if (!currentRowHasContent) {
    return 0;
  }

  const lastOccupiedRow = getLastOccupiedRow(occupiedCells);
  let placeholderCount = 0;
  let placeholderCursorRow = cursorRow;
  let placeholderCursorColumn = cursorColumn;

  while (placeholderCursorRow <= lastOccupiedRow) {
    const placement = findNextGridPlacement(
      occupiedCells,
      maxColumns,
      placeholderCursorRow,
      placeholderCursorColumn,
      1,
      1,
    );
    if (placement.row > lastOccupiedRow) {
      break;
    }

    occupiedCells.add(getGridCellKey(placement.row, placement.column));
    placeholderCount += 1;
    placeholderCursorRow = placement.row;
    placeholderCursorColumn = placement.column + 1;
    if (placeholderCursorColumn >= maxColumns) {
      placeholderCursorRow += 1;
      placeholderCursorColumn = 0;
    }
  }

  return placeholderCount;
}

function findNextGridPlacement(
  occupiedCells: Set<string>,
  maxColumns: number,
  startRow: number,
  startColumn: number,
  itemColumns: number,
  itemRows: number,
): { row: number; column: number } {
  let row = startRow;
  let column = startColumn;

  while (!canPlaceGridItem(occupiedCells, maxColumns, row, column, itemColumns, itemRows)) {
    column += 1;
    if (column >= maxColumns) {
      row += 1;
      column = 0;
    }
  }

  return { row, column };
}

function canPlaceGridItem(
  occupiedCells: Set<string>,
  maxColumns: number,
  row: number,
  column: number,
  itemColumns: number,
  itemRows: number,
): boolean {
  if (column + itemColumns > maxColumns) {
    return false;
  }

  for (let rowOffset = 0; rowOffset < itemRows; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < itemColumns; columnOffset += 1) {
      if (occupiedCells.has(getGridCellKey(row + rowOffset, column + columnOffset))) {
        return false;
      }
    }
  }

  return true;
}

function getGridCellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function getLastOccupiedRow(occupiedCells: Set<string>): number {
  let lastRow = 0;
  occupiedCells.forEach((cellKey) => {
    const [rowValue] = cellKey.split(':');
    const row = Number(rowValue);
    if (Number.isFinite(row) && row > lastRow) {
      lastRow = row;
    }
  });

  return lastRow;
}

function normalizePositiveInteger(value: number | string | null | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.floor(parsed);
}
