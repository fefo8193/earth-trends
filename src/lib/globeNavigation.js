import * as THREE from 'three';

// Keep a small angular margin around the camera's vertical-axis singularities.
export const POLAR_MARGIN = THREE.MathUtils.degToRad(0.5);
export const MAX_CAMERA_LATITUDE = 90 - THREE.MathUtils.radToDeg(POLAR_MARGIN);

export function cameraLatitude(latitude) {
  return THREE.MathUtils.clamp(latitude, -MAX_CAMERA_LATITUDE, MAX_CAMERA_LATITUDE);
}

/** Cursor zoom is unstable at a tangent to the sphere or along its polar axis. */
export function canZoomToSurface(cameraPosition, surfacePoint) {
  const distance = cameraPosition.length();
  if (!surfacePoint || !Number.isFinite(distance) || distance === 0) return false;
  const polarLimit = Math.sin(THREE.MathUtils.degToRad(85));
  if (Math.abs(cameraPosition.y / distance) >= polarLimit) return false;
  const normal = surfacePoint.clone().normalize();
  if (Math.abs(normal.y) >= polarLimit) return false;
  const toCamera = cameraPosition.clone().sub(surfacePoint).normalize();
  return normal.dot(toCamera) > 0.18;
}

export function installNavigationGuard(globe) {
  const controls = globe.controls();
  const camera = globe.camera();
  const surface = controls.domElement || globe.renderer().domElement;
  const before = { min: controls.minPolarAngle, max: controls.maxPolarAngle, cursor: controls.zoomToCursor };
  controls.minPolarAngle = Math.max(before.min, POLAR_MARGIN);
  controls.maxPolarAngle = Math.min(before.max, Math.PI - POLAR_MARGIN);

  const raycaster = new THREE.Raycaster();
  const sphere = new THREE.Sphere(new THREE.Vector3(), globe.getGlobeRadius());
  const pointer = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const prepareZoom = (event) => {
    if (event.type === 'pointerdown' && event.button !== 1) return;
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
    camera.updateMatrixWorld();
    camera.getWorldPosition(eye);
    raycaster.setFromCamera(pointer, camera);
    const intersection = raycaster.ray.intersectSphere(sphere, hit);
    // Centered zoom near poles/limb; preserve cursor zoom on the rest of the globe.
    controls.zoomToCursor = before.cursor && canZoomToSurface(eye, intersection);
  };
  // Run before OrbitControls consumes the wheel/middle-button input.
  surface.addEventListener('wheel', prepareZoom, { capture: true, passive: true });
  surface.addEventListener('pointerdown', prepareZoom, { capture: true, passive: true });
  return () => {
    surface.removeEventListener('wheel', prepareZoom, true);
    surface.removeEventListener('pointerdown', prepareZoom, true);
    controls.minPolarAngle = before.min;
    controls.maxPolarAngle = before.max;
    controls.zoomToCursor = before.cursor;
  };
}
