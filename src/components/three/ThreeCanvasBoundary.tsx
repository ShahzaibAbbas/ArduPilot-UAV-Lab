import { useThree } from "@react-three/fiber";
import { Component, useEffect, type ReactNode } from "react";

export function ThreeCanvasUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="three-canvas-status" role="status" data-testid="three-canvas-unavailable">
      <strong>3D rendering is unavailable</strong>
      <p>Your workspace and transforms are preserved. Try the renderer again, or return to Design (2D).</p>
      <p>If this continues, enable browser hardware acceleration and reload the app.</p>
      <button type="button" onClick={onRetry}>Retry 3D renderer</button>
    </div>
  );
}

export class ThreeCanvasBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <ThreeCanvasUnavailable onRetry={this.props.onRetry} /> : this.props.children;
  }
}

export function ThreeContextMonitor({ onContextLost }: { onContextLost: () => void }) {
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    const lost = (event: Event) => {
      event.preventDefault();
      onContextLost();
    };
    canvas.addEventListener("webglcontextlost", lost);
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [canvas, onContextLost]);
  return null;
}
