import * as THREE from 'three';
import type { ResolvedAtmosphere } from './types';

/**
 * Generates a rich HDR Stadium Environment Cubemap via PMREMGenerator.
 * Gives wet turf puddles, metallic goalposts, glass dugouts, cleats, and jersey sheen
 * genuine reflections of the sky horizon, stadium floodlights, and pitch bounce.
 */
export function createStadiumEnvironmentTexture(
  renderer: THREE.WebGLRenderer,
  atmo: ResolvedAtmosphere
): THREE.WebGLRenderTarget {
  const envScene = new THREE.Scene();

  const skyCol = new THREE.Color(atmo.skyTopHex);
  const horCol = new THREE.Color(atmo.skyHorizonHex);

  // Upper sky dome inside env scene
  const domeGeo = new THREE.SphereGeometry(50, 20, 14);
  const domeMat = new THREE.MeshBasicMaterial({
    color: skyCol.clone().lerp(horCol, 0.55),
    side: THREE.BackSide,
  });
  envScene.add(new THREE.Mesh(domeGeo, domeMat));

  // Green/snowy ground bounce hemisphere
  const groundMat = new THREE.MeshBasicMaterial({
    color: atmo.season === 'winter' && atmo.tempC <= -3 ? 0x6b7f8f : 0x1a4728,
    side: THREE.DoubleSide,
  });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(48, 24), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -4;
  envScene.add(ground);

  // Bright HDR floodlight panels for crisp specular highlights on wet grass & metal
  const floodBoost = atmo.isNight ? 5.2 : atmo.isSunset ? 3.8 : 2.2;
  const floodColor = new THREE.Color(atmo.isNight ? 0xeaf4ff : atmo.isSunset ? 0xffd7ad : 0xfff8ea)
    .multiplyScalar(floodBoost);
  const floodMat = new THREE.MeshBasicMaterial({ color: floodColor });
  const floodGeo = new THREE.PlaneGeometry(14, 6);

  const positions: [number, number, number][] = [
    [-26, 18, -20],
    [26, 18, -20],
    [-26, 18, 20],
    [26, 18, 20],
  ];
  for (const [x, y, z] of positions) {
    const p = new THREE.Mesh(floodGeo, floodMat);
    p.position.set(x, y, z);
    p.lookAt(0, 0, 0);
    envScene.add(p);
  }

  // Sun / Sunset HDR disc
  if (atmo.weather === 'clear' || atmo.weather === 'overcast') {
    const sunCol = new THREE.Color(atmo.sunColorHex).multiplyScalar(atmo.isNight ? 1.5 : 4.5);
    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(atmo.isNight ? 2.5 : 4.5, 16),
      new THREE.MeshBasicMaterial({ color: sunCol })
    );
    sunDisc.position.set(atmo.isSunset ? -28 : 16, atmo.isSunset ? 10 : 32, -26);
    sunDisc.lookAt(0, 0, 0);
    envScene.add(sunDisc);
  }

  // Warm perimeter LED glow ring
  const ledRing = new THREE.Mesh(
    new THREE.CylinderGeometry(32, 32, 1.5, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x2a6f4e).multiplyScalar(1.3),
      side: THREE.BackSide,
    })
  );
  ledRing.position.y = 0.5;
  envScene.add(ledRing);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromScene(envScene, 0.035);

  // Dispose temporary env scene geometries & materials
  envScene.traverse(obj => {
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      m.geometry.dispose();
      if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose());
      else m.material.dispose();
    }
  });
  pmrem.dispose();

  return target;
}

export interface PitchShaderUniforms {
  uTime: { value: number };
  uWetness: { value: number };
  uFrost: { value: number };
}

/**
 * Injects world-space micro-grass detail, specular puddle reflections,
 * animated raindrop ripples, and frost crystal glints onto MeshPhysicalMaterial.
 */
export function enhancePitchMaterialWithRtxShader(
  mat: THREE.MeshPhysicalMaterial,
  atmo: ResolvedAtmosphere
): PitchShaderUniforms {
  const isWet = atmo.weather === 'rain' || atmo.weather === 'storm';
  const isFrost = atmo.weather === 'snow' || atmo.weather === 'blizzard' || (atmo.season === 'winter' && atmo.tempC <= -1);
  const uniforms: PitchShaderUniforms = {
    uTime: { value: 0 },
    uWetness: { value: isWet ? 1.0 : atmo.weather === 'fog' ? 0.28 : 0.0 },
    uFrost: { value: isFrost ? 0.85 : 0.0 },
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWetness = uniforms.uWetness;
    shader.uniforms.uFrost = uniforms.uFrost;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vPitchWorldPos;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vPitchWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vPitchWorldPos;
        uniform float uTime;
        uniform float uWetness;
        uniform float uFrost;

        float pitchHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float pitchNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(pitchHash(i + vec2(0.0, 0.0)), pitchHash(i + vec2(1.0, 0.0)), u.x),
            mix(pitchHash(i + vec2(0.0, 1.0)), pitchHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float microBlade = pitchNoise(vPitchWorldPos.xz * 22.0);
        float puddleMask = smoothstep(0.56, 0.78, pitchNoise(vPitchWorldPos.xz * 0.16) * 0.7 + pitchNoise(vPitchWorldPos.xz * 0.42) * 0.3);
        float activePuddle = puddleMask * uWetness;
        roughnessFactor = mix(roughnessFactor, 0.92 - microBlade * 0.18, 0.35);
        roughnessFactor = mix(roughnessFactor, 0.05, activePuddle);
        if (uFrost > 0.05) {
          float sparkle = smoothstep(0.92, 0.995, pitchHash(floor(vPitchWorldPos.xz * 14.0)));
          roughnessFactor = mix(roughnessFactor, 0.16, sparkle * uFrost);
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float bladeTone = pitchNoise(vPitchWorldPos.xz * 16.0);
        diffuseColor.rgb *= (0.93 + bladeTone * 0.14);
        if (uWetness > 0.05) {
          float pM = smoothstep(0.56, 0.78, pitchNoise(vPitchWorldPos.xz * 0.16) * 0.7 + pitchNoise(vPitchWorldPos.xz * 0.42) * 0.3);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.72, pM * uWetness * 0.65);
          // Subtle raindrop ripple glint
          vec2 rCell = floor(vPitchWorldPos.xz * 1.4);
          vec2 rFract = fract(vPitchWorldPos.xz * 1.4) - 0.5;
          float rAge = fract(uTime * 1.15 + pitchHash(rCell) * 6.28);
          float rDist = length(rFract);
          float ripple = smoothstep(0.04, 0.0, abs(rDist - rAge * 0.42)) * (1.0 - rAge);
          diffuseColor.rgb += vec3(0.16, 0.22, 0.28) * ripple * pM * uWetness;
        }`
      );
  };
  mat.customProgramCacheKey = () => `rtx_pitch_${isWet ? 'w' : 'd'}_${isFrost ? 'f' : 'n'}`;
  return uniforms;
}

export interface GrassLayerRig {
  mesh: THREE.InstancedMesh;
  update: (elapsed: number) => void;
  dispose: () => void;
}

/**
 * 3D Instanced volumetric grass blades across the pitch with GLSL wind sway.
 */
export function buildVolumetricGrassLayer(
  atmo: ResolvedAtmosphere,
  isSoftwareGl: boolean
): GrassLayerRig {
  const count = isSoftwareGl ? 6000 : 20000;
  const bladeH = atmo.season === 'winter' ? 0.095 : 0.115;

  // Tapered 3-segment curved grass blade geometry
  const bladeGeo = new THREE.PlaneGeometry(0.055, bladeH, 1, 2);
  bladeGeo.translate(0, bladeH / 2, 0);
  const posAttr = bladeGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    const t = y / bladeH;
    // Taper width toward tip and add gentle natural forward curve
    posAttr.setX(i, posAttr.getX(i) * (1 - t * 0.78));
    posAttr.setZ(i, t * t * 0.032);
  }
  bladeGeo.computeVertexNormals();

  const timeUniform = { value: 0 };
  const windStrength = { value: Math.min(2.4, 0.45 + atmo.windMs * 0.14) };

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: atmo.weather === 'rain' || atmo.weather === 'storm' ? 0.36 : 0.78,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uWind = windStrength;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWind;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float hFrac = clamp(position.y / ${bladeH.toFixed(4)}, 0.0, 1.0);
        vec4 instPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float wave = sin(uTime * 2.6 + instPos.x * 0.28 + instPos.z * 0.18) * 0.5
                   + cos(uTime * 4.1 + instPos.x * 0.65 - instPos.z * 0.35) * 0.5;
        transformed.x += wave * hFrac * hFrac * 0.045 * uWind;
        transformed.z += wave * hFrac * hFrac * 0.025 * uWind;`
      );
  };

  const mesh = new THREE.InstancedMesh(bladeGeo, mat, count);
  mesh.receiveShadow = !isSoftwareGl;
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const isSnow = atmo.weather === 'snow' || atmo.weather === 'blizzard';
  const baseEven = new THREE.Color(
    isSnow ? '#497d5a' : atmo.season === 'autumn' ? '#3f763d' : atmo.season === 'winter' ? '#3d704d' : '#2d8244'
  );
  const baseOdd = new THREE.Color(
    isSnow ? '#3d6b4c' : atmo.season === 'autumn' ? '#346333' : atmo.season === 'winter' ? '#336142' : '#246d38'
  );
  const frostTint = new THREE.Color('#dbeafe');

  const stripes = 18;
  for (let i = 0; i < count; i++) {
    // Deterministic Halton-like stratified distribution across pitch
    const u = ((Math.sin(i * 12.9898 + 1.23) * 43758.5453) % 1 + 1) % 1;
    const v = ((Math.sin(i * 78.233 + 4.56) * 24634.6345) % 1 + 1) % 1;
    const r = ((Math.sin(i * 37.719 + 7.89) * 19283.412) % 1 + 1) % 1;

    const x = (u - 0.5) * 105.0;
    const z = (v - 0.5) * 68.0;
    const sc = 0.78 + r * 0.5;

    dummy.position.set(x, 0.004, z);
    dummy.rotation.set((r - 0.5) * 0.2, r * Math.PI * 2, (u - 0.5) * 0.16);
    dummy.scale.set(0.85 + r * 0.4, sc, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    const stripeIdx = Math.floor(((x + 52.5) / 105.0) * stripes);
    color.copy(stripeIdx % 2 === 0 ? baseEven : baseOdd);
    color.offsetHSL((r - 0.5) * 0.015, (u - 0.5) * 0.04, (v - 0.5) * 0.04);
    if (isSnow && i % 4 === 0) color.lerp(frostTint, 0.45);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return {
    mesh,
    update: (elapsed: number) => {
      timeUniform.value = elapsed;
    },
    dispose: () => {
      bladeGeo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Volumetric additive god-ray light shafts from the stadium floodlights.
 */
export function buildVolumetricFloodlightBeams(atmo: ResolvedAtmosphere): {
  group: THREE.Group;
  update: (elapsed: number) => void;
  dispose: () => void;
} {
  const group = new THREE.Group();
  const isVisible = atmo.isNight || atmo.isSunset || atmo.weather === 'fog' || atmo.weather === 'rain' || atmo.weather === 'storm';
  if (!isVisible) {
    return { group, update: () => {}, dispose: () => {} };
  }

  const beamIntensity = atmo.isNight
    ? (atmo.weather === 'fog' ? 0.22 : 0.15)
    : atmo.isSunset
      ? 0.11
      : 0.10;
  const beamColor = new THREE.Color(atmo.isSunset ? 0xffdfb0 : 0xdceeff);

  const timeUniform = { value: 0 };
  const coneGeo = new THREE.ConeGeometry(28, 74, 24, 1, true);
  coneGeo.translate(0, -37, 0);

  const beamMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: beamColor },
      uOpacity: { value: beamIntensity },
      uTime: timeUniform,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      varying vec2 vUv;
      void main() {
        float edge = pow(abs(dot(normalize(vNormalView), normalize(vViewDir))), 2.2);
        float lenFade = smoothstep(0.0, 0.85, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
        float shimmer = 0.92 + 0.08 * sin(uTime * 1.4 + vUv.x * 18.0);
        float alpha = edge * lenFade * uOpacity * shimmer;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  const towers: [number, number, number, number][] = [
    [-68, 35, -48, -22],
    [68, 35, -48, 22],
    [-68, 35, 48, -22],
    [68, 35, 48, 22],
  ];

  const targetObj = new THREE.Vector3();
  const upVec = new THREE.Vector3(0, -1, 0);
  const dirVec = new THREE.Vector3();

  for (const [tx, ty, tz, aimX] of towers) {
    const beam = new THREE.Mesh(coneGeo, beamMat);
    beam.position.set(tx, ty, tz);
    targetObj.set(aimX, 0, 0);
    dirVec.subVectors(targetObj, beam.position).normalize();
    beam.quaternion.setFromUnitVectors(upVec, dirVec);
    group.add(beam);
  }

  return {
    group,
    update: (elapsed: number) => {
      timeUniform.value = elapsed;
    },
    dispose: () => {
      coneGeo.dispose();
      beamMat.dispose();
    },
  };
}

/**
 * DLSS-style Contrast Adaptive Sharpening (CAS) + subtle broadcast lens grading.
 * Keeps player kits, grass blades, lines, and stadium architecture razor sharp.
 */
export const BroadcastCasVignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uSharpness: { value: 0.72 },
    uVignette: { value: 0.28 },
    uContrast: { value: 1.06 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uSharpness;
    uniform float uVignette;
    uniform float uContrast;
    varying vec2 vUv;

    float luma(vec3 c) {
      return dot(c, vec3(0.299, 0.587, 0.114));
    }

    void main() {
      vec2 texel = 1.0 / max(uResolution, vec2(1.0));
      vec3 cCenter = texture2D(tDiffuse, vUv).rgb;
      vec3 cN = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
      vec3 cS = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
      vec3 cE = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
      vec3 cW = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;

      // Contrast Adaptive Sharpening (CAS-inspired) without haloing
      float lC = luma(cCenter);
      float lMin = min(lC, min(min(luma(cN), luma(cS)), min(luma(cE), luma(cW))));
      float lMax = max(lC, max(max(luma(cN), luma(cS)), max(luma(cE), luma(cW))));
      float localContrast = clamp(1.0 - (lMax - lMin) * 2.2, 0.0, 1.0);
      vec3 blur = (cN + cS + cE + cW) * 0.25;
      vec3 sharp = cCenter + (cCenter - blur) * (uSharpness * localContrast * 0.85);
      sharp = clamp(sharp, 0.0, 10.0);

      // Broadcast lens subtle contrast & edge vignette
      sharp = (sharp - 0.5) * uContrast + 0.5;
      vec2 centered = vUv - 0.5;
      float vig = 1.0 - dot(centered, centered) * uVignette;
      sharp *= clamp(vig, 0.55, 1.0);

      gl_FragColor = vec4(max(sharp, 0.0), 1.0);
    }
  `,
};
