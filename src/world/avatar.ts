import * as THREE from 'three';

/**
 * Round mascot avatar: a soft sphere with aqua ears and a very simple face (two dot eyes and a tiny mouth).
 * Local +Y is up, the face looks toward local +Z.
 */
export function createAvatar() {
  const root = new THREE.Group();
  const head = new THREE.Group(); // bobs gently
  root.add(head);

  const BODY_R = 3;
  const BODY_Y = 3.6;
  const center = new THREE.Vector3(0, BODY_Y, 0);
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(BODY_R, 48, 32),
    new THREE.MeshStandardMaterial({ color: '#eef3f5', roughness: 0.45 })
  );
  body.position.copy(center);
  head.add(body);

  const earMat = new THREE.MeshStandardMaterial({ color: '#4fb8cf', roughness: 0.4 });
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.75, 3.2, 20), earMat);
    ear.position.set(s * 1.5, 6.9, -0.2);
    ear.rotation.z = -s * 0.25;
    head.add(ear);
  }

  /** stick a flat face part onto the body surface at small yaw / pitch angles (radians) */
  const onFace = (obj: THREE.Object3D, yaw: number, pitch: number) => {
    const n = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    obj.position.copy(center).addScaledVector(n, BODY_R + 0.02);
    obj.lookAt(obj.position.clone().add(n));
    head.add(obj);
  };

  // same family as the body (soft gray), lit like the body so the face does not look pasted on
  const ink = new THREE.MeshStandardMaterial({ color: '#8f989d', roughness: 0.5 });
  const eyes: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.36, 24), ink);
    onFace(eye, s * 0.33, 0.1);
    eyes.push(eye);
  }
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.12), ink);
  onFace(mouth, 0, -0.16);

  // orbit ring around the body and a halo on the ground
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(5, 0.18, 12, 80),
    new THREE.MeshBasicMaterial({ color: '#3cc4e0', transparent: true, opacity: 0.85 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 3.2;
  head.add(ring);
  const haloMat = new THREE.MeshBasicMaterial({ color: '#58c9e0', transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  const halo = new THREE.Mesh(new THREE.RingGeometry(9, 9.4, 96), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.12;
  root.add(halo);

  root.traverse((m) => (m.raycast = () => {}));

  let nextBlink = 2 + Math.random() * 3;
  let blinkT = -1;

  /**
   * bob, spin the ring and blink. `floatHeight` = meters above the surface below
   * (the ground halo stays on that surface and fades out while floating high).
   */
  function animate(t: number, dt: number, floatHeight: number) {
    head.position.y = Math.sin(t * 2.4) * 0.35;
    ring.rotation.z = t * 0.8;
    halo.position.y = 0.12 - floatHeight;
    haloMat.opacity = (0.35 + Math.sin(t * 2) * 0.15) * Math.max(0, 1 - floatHeight / 80);
    nextBlink -= dt;
    if (nextBlink <= 0) {
      blinkT = 0;
      nextBlink = 2.5 + Math.random() * 3.5;
    }
    let sy = 1;
    if (blinkT >= 0) {
      blinkT += dt;
      const k = blinkT / 0.15;
      sy = k < 1 ? 1 - Math.sin(k * Math.PI) * 0.9 : 1;
      if (k >= 1) blinkT = -1;
    }
    for (const e of eyes) e.scale.y = sy;
  }

  return { root, animate };
}
