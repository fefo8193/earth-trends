// Efectos visuales del globo: relieve, brillo del océano, luces nocturnas (modo cinemático),
// atmósfera propia, cielo de estrellas 3D y luz que acompaña a la cámara.
import * as THREE from 'three';
import { configureEarthTexture } from './textureQuality.js';

const ASSETS = `${import.meta.env.BASE_URL}assets/`;
const R = 100; // radio del globo en three-globe

function load(url, srgb = true) {
  const t = new THREE.TextureLoader().load(ASSETS + url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return configureEarthTexture(t);
}

/** Punto subsolar actual (lat, lng) aproximado: suficiente para el día/noche visual. */
function subsolar(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date - start) / 86400000;
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const lng = -15 * (hours - 12);
  return { lat: decl, lng };
}

/** Misma convención que three-globe (polar2Cartesian). */
function toVec(lat, lng, r = 1) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  return new THREE.Vector3(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/** Material del globo: textura de datos + relieve + brillo del agua + noche con luces de ciudades. */
export function createGlobeMaterial(baseTexture, overlayTexture) {
  const uniforms = {
    climateOverlay: { value: overlayTexture },
    climatePremultiplied: { value: overlayTexture?.userData.premultipliedField ? 1 : 0 },
    nightMap: { value: load('earth-night.jpg') },
    sunDirView: { value: new THREE.Vector3(0, 0, 1) },
    cinematic: { value: 0 },
    rimColor: { value: new THREE.Color('#5fc8ff') },
    reliefStrength: { value: 2.2 },
  };
  const material = new THREE.MeshPhongMaterial({
    map: baseTexture,
    emissive: new THREE.Color('#ffffff'),
    emissiveMap: baseTexture,
    emissiveIntensity: 0.14,
    // Relieve "falso" pero barato: mapa de normales precalculado del modelo de elevación (sin geometría extra)
    normalMap: load('earth-normal.jpg', false),
    normalScale: new THREE.Vector2(1.15, 1.15),
    specularMap: load('earth-water.png', false),
    specular: new THREE.Color('#27466c'),
    shininess: 70,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D nightMap;
uniform sampler2D climateOverlay;
uniform float climatePremultiplied;
uniform vec3 sunDirView;
uniform float cinematic;
uniform vec3 rimColor;
uniform float reliefStrength;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  // Match the previous Canvas2D sRGB blend while keeping the base upload static.
  vec4 climateColor = texture2D(climateOverlay, vMapUv);
  vec3 earthBaseSRGB = sRGBTransferOETF(vec4(sampledDiffuseColor.rgb, 1.0)).rgb;
  // Transparent texels must not interpolate black into neighboring colors.
  vec3 climateSRGB = climatePremultiplied > 0.5
    ? climateColor.rgb / max(climateColor.a, 0.00001)
    : sRGBTransferOETF(vec4(climateColor.rgb, 1.0)).rgb;
  vec3 earthSurfaceColor = sRGBTransferEOTF(vec4(mix(earthBaseSRGB, climateSRGB, climateColor.a), 1.0)).rgb;
  diffuseColor.rgb = diffuse * earthSurfaceColor;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `totalEmissiveRadiance *= earthSurfaceColor;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace(
          'mapN.xy *= normalScale;',
          `// The water mask is sampled by specularmap_fragment before normals.
          // Fade the perturbation itself, so lighting, hillshade and fresnel all
          // see a flat ocean instead of amplified coastal/JPEG normal-map blocks.
          float landRelief = 1.0 - smoothstep(0.05, 0.8, specularStrength);
          mapN.xy *= normalScale * landRelief;`,
        ),
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  vec3 nrm = normalize(normal);
  // Sombreado de relieve: luz rasante fija (arriba-izquierda de la pantalla) aplicada solo a la
  // diferencia entre la normal con relieve y la normal lisa de la esfera -> montañas siempre legibles.
  vec3 geoN = normalize(vNormal);
  vec3 reliefL = normalize(vec3(-0.6, 0.65, 0.45));
  float relief = dot(nrm, reliefL) - dot(geoN, reliefL);
  outgoingLight *= clamp(1.0 + relief * reliefStrength, 0.55, 1.45);
  // Día / noche (solo en modo cinemático)
  float ndl = dot(nrm, normalize(sunDirView));
  float day = smoothstep(-0.10, 0.25, ndl);
  vec3 lights = texture2D(nightMap, vMapUv).rgb;
  lights = pow(lights, vec3(1.35)) * vec3(1.0, 0.82, 0.55) * 1.8;
  vec3 cine = outgoingLight * (0.05 + 0.95 * day) + lights * (1.0 - day);
  outgoingLight = mix(outgoingLight, cine, cinematic);
  // Borde luminoso (fresnel) para dar volumen
  float fres = pow(1.0 - max(dot(nrm, normalize(vViewPosition)), 0.0), 3.0);
  outgoingLight += rimColor * fres * 0.3;
}
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'earthtrends-globe-v6-premultiplied-field';
  return { material, uniforms };
}

function createAtmosphere() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      inner: { value: new THREE.Color('#6fd3ff') },
      outer: { value: new THREE.Color('#1d4fd6') },
    },
    vertexShader: `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
uniform vec3 inner;
uniform vec3 outer;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  // Cara trasera de la cáscara: |N·V| = 0 en el borde exterior y crece hacia el limbo del planeta
  float d = abs(dot(normalize(vNormal), normalize(vView)));
  float x = clamp(d / 0.45, 0.0, 1.0);
  float i = pow(x, 2.6);
  vec3 c = mix(outer, inner, i);
  gl_FragColor = vec4(c, 1.0) * i * 0.6;
}`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(R * 1.15, 96, 96), mat);
}

/** Tiempo sidéreo medio de Greenwich (grados). */
function gmstDeg(date = new Date()) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  return (((280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360) + 360) % 360;
}

/** Color aproximado de una estrella a partir de su índice B−V. */
function bvColor(bv) {
  const t = Math.max(-0.4, Math.min(2.0, bv));
  if (t < 0) return new THREE.Color().setRGB(0.66, 0.78, 1.0);
  if (t < 0.4) return new THREE.Color().setRGB(0.8 + t * 0.4, 0.87 + t * 0.2, 1.0);
  if (t < 0.8) return new THREE.Color().setRGB(1.0, 0.95, 0.85 - (t - 0.4) * 0.4);
  if (t < 1.4) return new THREE.Color().setRGB(1.0, 0.85 - (t - 0.8) * 0.25, 0.65 - (t - 0.8) * 0.4);
  return new THREE.Color().setRGB(1.0, 0.68, 0.42);
}

/**
 * Cielo real: estrellas del Yale Bright Star Catalog (mag ≤ 6) y líneas de constelaciones,
 * en la esfera celeste alineada con el eje terrestre. El grupo gira con el tiempo sidéreo real.
 */
function createStarSky() {
  const group = new THREE.Group();
  group.renderOrder = -10;
  const RS = R * 110;
  fetch(`${ASSETS}sky.json`)
    .then((r) => r.json())
    .then((sky) => {
      const n = sky.stars.length;
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const size = new Float32Array(n);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sky.stars.forEach(([ra, dec, mag, bv], i) => {
        // Ascensión recta = "longitud celeste": se ubica como lat = dec, lng = ra (el grupo resta el GMST)
        toVec(dec, ra, RS).toArray(pos, i * 3);
        bvColor(bv).toArray(col, i * 3);
        // En pantallas de baja densidad, un punto de ~1 px desaparece: piso de 2.2 px físicos
        size[i] = Math.max(2.2, Math.max(1.1, Math.min(5.2, 4.6 - 0.62 * mag)) * dpr);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('size', new THREE.BufferAttribute(size, 1));
      const m = new THREE.ShaderMaterial({
        vertexShader: `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
varying float vSize;
void main() {
  vColor = color;
  vSize = size;
  gl_PointSize = size;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: `
varying vec3 vColor;
varying float vSize;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(1.0, 0.0, d);
  float a = pow(core, 1.35) * clamp(vSize / 3.0, 0.6, 1.0);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(g, m);
      pts.renderOrder = -10;
      group.add(pts);

      // Líneas de constelaciones (tenues)
      const seg = [];
      for (const [, line] of sky.lines) {
        for (let k = 0; k < line.length - 1; k++) {
          seg.push(...toVec(line[k][1], line[k][0], RS * 0.999).toArray(), ...toVec(line[k + 1][1], line[k + 1][0], RS * 0.999).toArray());
        }
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      const lines = new THREE.LineSegments(
        lg,
        new THREE.LineBasicMaterial({ color: '#7fa8e8', transparent: true, opacity: 0.16, depthWrite: false }),
      );
      lines.renderOrder = -11;
      group.add(lines);
    })
    .catch(() => {});
  const orient = () => {
    group.rotation.y = (-gmstDeg() * Math.PI) / 180;
  };
  orient();
  return { group, orient };
}

/**
 * Instala los efectos en una instancia de react-globe.gl.
 * Devuelve { setCinematic(bool), dispose() }.
 */
export function installGlobeFx(globe, uniforms) {
  const scene = globe.scene();
  const camera = globe.camera();

  const atmosphere = createAtmosphere();
  const sky = createStarSky();
  scene.add(atmosphere, sky.group);
  const skyTimer = setInterval(sky.orient, 60000); // el cielo gira con la hora sidérea real

  // Luces: ambiente suave + "llave" que acompaña a la cámara (arriba a la izquierda) o al Sol en modo cinemático
  const ambient = new THREE.AmbientLight(0xbfd4ff, 1.05);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  globe.lights([ambient, key]);

  const sunWorld = toVec(subsolar().lat, subsolar().lng).normalize();
  let target = 0;
  let cin = 0;
  let raf = 0;
  const tmp = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const camLight = new THREE.Vector3();

  const tick = () => {
    raf = requestAnimationFrame(tick);
    cin += (target - cin) * 0.04;
    if (Math.abs(target - cin) < 0.001) cin = target;
    uniforms.cinematic.value = cin;

    // Luz de cámara: desde la cámara, desplazada arriba-izquierda
    const dist = camera.position.length();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    camLight.copy(camera.position).addScaledVector(right, -0.75 * dist).addScaledVector(up, 0.6 * dist).normalize();
    tmp.copy(camLight).lerp(sunWorld, cin).normalize();
    key.position.copy(tmp).multiplyScalar(R * 10);
    ambient.intensity = 1.05 - 0.8 * cin;
    key.intensity = 1.6 + 0.3 * cin;

    // Dirección del Sol en espacio de vista (para el shader día/noche)
    uniforms.sunDirView.value.copy(sunWorld).transformDirection(camera.matrixWorldInverse);
  };
  tick();

  return {
    setCinematic(on) {
      target = on ? 1 : 0;
    },
    dispose() {
      cancelAnimationFrame(raf);
      clearInterval(skyTimer);
      scene.remove(atmosphere, sky.group);
    },
  };
}
