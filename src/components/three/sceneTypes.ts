import type { DesignNode, ThreeTransform } from "../../domain/design";

export interface SceneNode {
  node: DesignNode;
  transform: ThreeTransform;
  automatic: boolean;
}

export interface HoveredSceneNode {
  node: DesignNode;
  automatic: boolean;
}

