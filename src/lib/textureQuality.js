import * as THREE from 'three';

// Keep surface textures sharp at grazing angles.
// Three.js also clamps this request to the device limit during texture upload.
export function configureEarthTexture(texture, anisotropy = 16) {
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.max(1, anisotropy);
  // Longitude is periodic; latitude must stay clamped at the poles.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

export function adaptEarthTextures(renderer, material, nightTexture, overlayTexture) {
  const anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const textures = new Set([
    material.map, material.emissiveMap, material.normalMap,
    material.specularMap, nightTexture, overlayTexture,
  ]);
  for (const texture of textures) {
    if (!texture) continue;
    const previous = texture.anisotropy;
    configureEarthTexture(texture, anisotropy);
    if (texture.anisotropy !== previous) texture.needsUpdate = true;
  }
}

// A short-lived capability probe runs before react-globe.gl creates its renderer.
// Keep constrained devices on the existing 4K asset, without downloading 8K first.
export function earthBaseWidth({ maxTextureSize, coarsePointer, deviceMemory } = {}) {
  return maxTextureSize >= 8192 && !coarsePointer && !(deviceMemory > 0 && deviceMemory <= 4)
    ? 8192 : 4096;
}

export function detectEarthBaseWidth() {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2');
  if (!gl) return 4096;
  try {
    return earthBaseWidth({
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      coarsePointer: window.matchMedia('(pointer: coarse)').matches,
      deviceMemory: navigator.deviceMemory,
    });
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
