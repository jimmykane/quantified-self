declare module 'vis-why' {
  export default function simplify(
    polyline: [number, number][],
    limit: number,
    areaFn?: (a: [number, number], b: [number, number], c: [number, number]) => number
  ): [number, number][];
}
