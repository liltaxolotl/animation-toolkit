# Third-party assets and libraries

| What | Where | License |
|---|---|---|
| Human figures (adult man `model.glb`, adult woman `mannequin-female.glb`) and 43 animation clips | `app/assets/figures/human/` from Mesh2Motion (github.com/Mesh2Motion/mesh2motion-app, commit 1632e1a7) | CC0 1.0 (`app/assets/figures/human/LICENSE-CC0.md`). Some clips came to Mesh2Motion from Quaternius, also CC0. |
| three.js 0.186.1 (core, GLTFLoader, OrbitControls, SkeletonUtils, BufferGeometryUtils, meshopt decoder) | `app/vendor/three/` | MIT (`app/vendor/three/LICENSE`); the meshopt decoder is MIT (header of the file) |
| pdf.js 3.11.174 | `app/vendor/pdfjs/` | Apache 2.0 (`app/vendor/pdfjs/LICENSE`) |

The teen, kid, heavier, thinner and cartoon bodies are the two figures above re-proportioned in the app, not separate models.
