declare module 'mapbox-gl/dist/esm/mapbox-gl.js' {
    export * from 'mapbox-gl';
    import mapboxgl from 'mapbox-gl';
    export default mapboxgl;
}

declare module 'mapbox-gl/dist/mapbox-gl.css' {
    const stylesheet: string;
    export default stylesheet;
}
