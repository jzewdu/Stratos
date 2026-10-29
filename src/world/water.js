import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { waterNormalTexture } from './textures.js';

export class Ocean {
  constructor(scene, renderer) {
    const geometry = new THREE.PlaneGeometry(220000, 220000);
    const normals = waterNormalTexture();
    normals.wrapS = THREE.RepeatWrapping;
    normals.wrapT = THREE.RepeatWrapping;

    this.water = new Water(geometry, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: normals,
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: 0xffffff,
      waterColor: 0x0a2734,
      distortionScale: 2.2,
      fog: true,
      alpha: 1.0,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0;
    this.water.material.uniforms.size.value = 0.75;
    this.water.renderOrder = 1;
    scene.add(this.water);
    this.scene = scene;
  }
}
