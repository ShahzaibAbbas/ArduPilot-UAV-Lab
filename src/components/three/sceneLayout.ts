import type { DesignNode, ThreeTransform } from "../../domain/design";
import { normalizeThreeTransform, threeTransformLimits } from "../../domain/threePresentation";
import type { SceneNode } from "./sceneTypes";

function stableOffset(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 5) * 0.035;
}

function safeCoordinate(value: number) {
  return Number.isFinite(value) ? Math.max(-1_000_000, Math.min(1_000_000, value)) : 0;
}

function layoutCenter(nodes: DesignNode[]) {
  return nodes.reduce(
    (total, candidate) => ({
      x: total.x + safeCoordinate(candidate.position.x) / nodes.length,
      y: total.y + safeCoordinate(candidate.position.y) / nodes.length
    }),
    { x: 0, y: 0 }
  );
}

function transformAtCenter(node: DesignNode, center: { x: number; y: number }): ThreeTransform {
  const coordinate = (value: number, origin: number) =>
    Math.max(-threeTransformLimits.position, Math.min(threeTransformLimits.position, (safeCoordinate(value) - origin) / 145));
  return {
    position: {
      x: coordinate(node.position.x, center.x),
      y: 0.42 + stableOffset(node.id),
      z: coordinate(node.position.y, center.y)
    },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  };
}

export function automaticTransform(node: DesignNode, nodes: DesignNode[]): ThreeTransform {
  return transformAtCenter(node, layoutCenter(nodes));
}

export function resolveSceneNodes(nodes: DesignNode[]): SceneNode[] {
  const center = layoutCenter(nodes);
  return nodes.map((node) => {
    const savedTransform = normalizeThreeTransform(node.presentation3d);
    return {
      node,
      transform: savedTransform ?? transformAtCenter(node, center),
      automatic: !savedTransform
    };
  });
}
