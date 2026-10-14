# LayaAir 3D renderer bridge

The 3D Lab keeps the existing React workbench and exposes an optional LayaAir 3.x renderer bridge. This is useful when the lab is hosted beside a LayaAir build or an application shell that already loads the official engine library.

1. Obtain the matching LayaAir 3.x browser libraries from the official LayaAir distribution. The engine documentation explains that the compiled `build/libs` files can be copied into a project and that the current stable branch is versioned (for example, 3.4).
2. Load the compiled browser library before the lab entry point and expose its namespace as `window.Laya`.
3. Open **3D Lab** and choose **LayaAir** in the scene toolbar. The bridge sends the current component manifest, saved transforms, selection callback, and live telemetry attitude to the LayaAir scene.

The repository does not vendor the engine binary. This keeps the source package small and avoids coupling a React build to a specific LayaAir distribution. If `window.Laya` is absent, or if the supplied build lacks the required `Scene3D`, `Camera`, `MeshSprite3D`, and primitive mesh APIs, the toolbar reports the reason and switches to the built-in Three.js renderer. The design, telemetry, and 2D/3D selection remain usable in that fallback.

The official engine source and versioned documentation are available at [layabox/LayaAir](https://github.com/layabox/LayaAir) and [LayaAir 3.x documentation](https://layaair.com/3.x/doc-en/).
