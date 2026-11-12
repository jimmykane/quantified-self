import * as THREE from 'three';
import { createTerrainGeometry } from './onboarding-terrain.geometry';
import type {
  TerrainController,
  TerrainOptions
} from './onboarding-terrain.types';

// Decorative scenery, not a metric chart. This fictional landscape has no axes
// or readable training values. WebGL supplies lit 3D relief and contour occlusion
// that the shared ECharts product-chart renderer cannot represent.
export function createTerrainRenderer(
  canvas: HTMLCanvasElement,
  stage: HTMLElement,
  options: TerrainOptions
): TerrainController {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power'
  });
  const resources: { dispose(): void }[] = [renderer];
  let cleanup: (() => void) | undefined;
  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.setClearColor(0x142126, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const fog = new THREE.Fog(0x223239, 28, 78);
    scene.fog = fog;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    const target = new THREE.Vector3(-1, 2.6, -16),
      baseCamera = new THREE.Vector3(5.4, 9.7, 17.5);
    camera.position.copy(baseCamera);
    camera.lookAt(target);
    const hemisphere = new THREE.HemisphereLight();
    scene.add(hemisphere);
    const key = new THREE.DirectionalLight();
    key.position.set(-18, 18, 8);
    scene.add(key);
    const fill = new THREE.DirectionalLight();
    fill.position.set(14, 8, -10);
    scene.add(fill);
    const terrain = new THREE.Group();
    scene.add(terrain);
    const model = createTerrainGeometry();
    const geo = new THREE.BufferGeometry();
    resources.push(geo);
    geo.setAttribute('position', new THREE.BufferAttribute(model.vertices, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(model.uvs, 2));
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(model.vertices.length), 3)
    );
    geo.setIndex(new THREE.BufferAttribute(model.indices, 1));
    geo.computeVertexNormals();
    // Small deterministic bump texture adds stone grain without changing the silhouette.
    const grain = new Uint8Array(256 * 256);
    let seed = 7621;
    for (let i = 0; i < grain.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      grain[i] = 96 + (seed >>> 26);
    }
    const surface = new THREE.DataTexture(grain, 256, 256, THREE.RedFormat);
    resources.push(surface);
    surface.wrapS = surface.wrapT = THREE.RepeatWrapping;
    surface.repeat.set(6, 9);
    surface.magFilter = THREE.LinearFilter;
    surface.minFilter = THREE.LinearMipmapLinearFilter;
    surface.generateMipmaps = true;
    surface.needsUpdate = true;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.04,
      roughness: 0.88,
      bumpMap: surface,
      bumpScale: 0.12
    });
    resources.push(material);
    terrain.add(new THREE.Mesh(geo, material));
    const contourGeo = new THREE.BufferGeometry();
    resources.push(contourGeo);
    contourGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(model.contours, 3)
    );
    const contourMaterial = new THREE.LineBasicMaterial({
      transparent: true,
      depthWrite: false
    });
    resources.push(contourMaterial);
    terrain.add(new THREE.LineSegments(contourGeo, contourMaterial));
    const profileGeo = new THREE.BufferGeometry();
    resources.push(profileGeo);
    profileGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(model.highlight, 3)
    );
    profileGeo.setAttribute(
      'progress',
      new THREE.BufferAttribute(model.progress, 1)
    );
    const profileMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          accent: { value: new THREE.Color(0x92b2bc) },
          strength: { value: 0.52 },
          center: { value: model.startProgress },
          span: { value: model.span },
          closed: { value: model.closed ? 1 : 0 }
        }
      ]),
      vertexShader: `
      attribute float progress;
      varying float vProgress;
      #include <fog_pars_vertex>
      void main(){
        vProgress=progress;
        vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
      fragmentShader: `
      uniform vec3 accent;
      uniform float strength,center,span,closed;
      varying float vProgress;
      #include <fog_pars_fragment>
      void main(){
        float d=abs(vProgress-center);
        if(closed>0.5)d=min(d,1.0-d);
        float feather=1.0-smoothstep(span*0.15,span,d);
        gl_FragColor=vec4(accent,feather*strength);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
      transparent: true,
      depthWrite: false,
      fog: true
    });
    const profile = new THREE.Line(profileGeo, profileMaterial);
    terrain.add(profile);
    resources.push(profileMaterial);
    let frame = 0,
      visible = true,
      disposed = false,
      rendered = false;
    let reduced = options.reducedMotion;
    // The entry glide eases into a small, seamless orbit rather than coming to rest.
    const entryDuration = 4500;
    const driftDuration = 24000 / 1.1;
    let entryTime = reduced ? entryDuration : 0;
    let driftTime = 0;
    let lastTime: number | undefined;
    let lastPaint = -Infinity;
    let pointerX = 0,
      pointerY = 0,
      currentX = 0,
      currentY = 0,
      dirty = true;
    const cancel = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = undefined;
    };
    function schedule() {
      if (!frame && !disposed && visible && !document.hidden)
        frame = requestAnimationFrame(draw);
    }
    function draw(time: number) {
      frame = 0;
      if (disposed || !visible || document.hidden) return;
      const dt = lastTime === undefined ? 0 : Math.max(0, time - lastTime);
      lastTime = time;
      if (!reduced) {
        entryTime = Math.min(entryDuration, entryTime + dt);
        driftTime = (driftTime + dt) % driftDuration;
        // Passive scenery needs only 30 paints per second; pointer input remains responsive.
        if (time - lastPaint >= 1000 / 30 - 0.5) dirty = true;
      }
      const dx = pointerX - currentX,
        dy = pointerY - currentY;
      const settling = Math.abs(dx) + Math.abs(dy) > 0.0005;
      if (settling) {
        const ease = 1 - Math.exp(-Math.min(dt, 50) * 0.006);
        currentX += dx * ease;
        currentY += dy * ease;
        dirty = true;
      }
      if (dirty) {
        const progress = entryTime / entryDuration;
        const entryOffset = 1 - progress * progress * (3 - 2 * progress);
        const phase = driftTime / driftDuration * Math.PI * 2;
        const drift = Math.sin(phase);
        camera.position.set(
          baseCamera.x + currentX - entryOffset * 2.2 + drift * 2.4,
          baseCamera.y + currentY + entryOffset * 0.22 + drift * 0.12,
          // Keep moving in depth as the lateral pan turns around, avoiding a perceived pause.
          baseCamera.z + entryOffset * 0.45 + (1 - Math.cos(phase)) * 1.2
        );
        camera.lookAt(target);
        try {
          renderer.render(scene, camera);
          lastPaint = time;
        } catch {
          unavailable();
          return;
        }
        dirty = false;
        if (!rendered) {
          rendered = true;
          options.onReady();
        }
      }
      if (!reduced || settling) schedule();
    }
    function resize() {
      if (disposed) return;
      const b = stage.getBoundingClientRect();
      if (!b.width || !b.height) return;
      renderer.setSize(b.width, b.height, false);
      camera.aspect = b.width / b.height;
      camera.fov = camera.aspect > 0.8 ? 42 : 38;
      camera.updateProjectionMatrix();
      dirty = true;
      schedule();
    }
    function setTheme(dark: boolean) {
      if (disposed) return;
      // These colors belong to the illustration; UI foregrounds and seams use Material tokens.
      const light = !dark,
        palette = light
          ? ['#98a8b1', '#b9c4ca', '#dde4e8']
          : ['#242c32', '#65737b', '#bdc8cc'];
      const low = new THREE.Color(palette[0]),
        mid = new THREE.Color(palette[1]),
        high = new THREE.Color(palette[2]);
      const color = new THREE.Color(),
        attribute = geo.attributes.color;
      for (let i = 0; i < attribute.count; i++) {
        const a = Math.max(
          0,
          Math.min(1, (model.vertices[i * 3 + 1] + 0.4) / 9.1)
        );
        if (a < 0.57) color.copy(low).lerp(mid, a / 0.57);
        else color.copy(mid).lerp(high, (a - 0.57) / 0.43);
        attribute.setXYZ(i, color.r, color.g, color.b);
      }
      attribute.needsUpdate = true;
      fog.color.set(light ? 0xecf1f5 : 0x1a2932);
      hemisphere.color.set(light ? 0xf2f6fa : 0xd4dde2);
      hemisphere.groundColor.set(light ? 0xa3b2be : 0x182128);
      hemisphere.intensity = light ? 1.5 : 1.2;
      key.color.set(light ? 0xeef6fc : 0xe6ecee);
      key.intensity = light ? 2.2 : 2.8;
      fill.color.set(light ? 0xc9d6df : 0x91a4af);
      fill.intensity = light ? 0.6 : 0.45;
      contourMaterial.color.set(light ? 0x778e9a : 0x93aab7);
      contourMaterial.opacity = light ? 0.09 : 0.06;
      profileMaterial.uniforms.accent.value.set(light ? 0x6a899b : 0x9ec3d4);
      profileMaterial.uniforms.strength.value = light ? 0.18 : 0.22;
      renderer.toneMappingExposure = light ? 1.03 : 1.0;
      dirty = true;
      schedule();
    }
    function replayEntry() {
      if (disposed || reduced) return;
      cancel();
      entryTime = 0;
      driftTime = 0;
      dirty = true;
      schedule();
    }
    function setReducedMotion(reduce: boolean) {
      if (disposed) return;
      cancel();
      reduced = reduce;
      if (reduced) {
        entryTime = entryDuration;
        driftTime = 0;
        pointerX = pointerY = currentX = currentY = 0;
        dirty = true;
      }
      schedule();
    }
    const move = (event: PointerEvent) => {
      if (reduced || event.pointerType === 'touch') return;
      const b = stage.getBoundingClientRect();
      if (!b.width || !b.height) return;
      pointerX = ((event.clientX - b.left) / b.width - 0.5) * 1.4;
      pointerY = ((event.clientY - b.top) / b.height - 0.5) * 0.5;
      schedule();
    };
    const leave = () => {
      pointerX = pointerY = 0;
      schedule();
    };
    const visibility = () => {
      cancel();
      if (!document.hidden) schedule();
    };
    function unavailable() {
      dispose();
      options.onUnavailable();
    }
    const contextLost = (event: Event) => {
      event.preventDefault();
      unavailable();
    };
    const resizer = options.resizeObserver
      ? new ResizeObserver(resize)
      : undefined;
    const observer = options.intersectionObserver
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? false;
          cancel();
          if (visible) schedule();
        })
      : undefined;
    function dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      resizer?.disconnect();
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('webglcontextlost', contextLost);
      for (const resource of resources) resource.dispose();
    }
    cleanup = dispose;
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerleave', leave);
    canvas.addEventListener('webglcontextlost', contextLost);
    document.addEventListener('visibilitychange', visibility);
    if (resizer) resizer.observe(stage);
    else window.addEventListener('resize', resize);
    observer?.observe(stage);
    setTheme(options.dark);
    resize();
    return { setTheme, setReducedMotion, replayEntry, dispose };
  } catch (error) {
    if (cleanup) cleanup();
    else for (const resource of resources) resource.dispose();
    throw error;
  }
}
