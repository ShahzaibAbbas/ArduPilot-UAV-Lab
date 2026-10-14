import { Line } from "@react-three/drei";
import type { DesignEdge, ThreeTransform } from "../../domain/design";
import { threeSignalStyles } from "../../lib/three/signalStyles";

interface ConnectionPathProps {
  edge: DesignEdge;
  source: ThreeTransform;
  target: ThreeTransform;
}

export function ConnectionPath({ edge, source, target }: ConnectionPathProps) {
  const signal = edge.data?.signal ?? "mount";
  const style = threeSignalStyles[signal] ?? threeSignalStyles.mount;
  const lift = Math.max(source.position.y, target.position.y) + 0.45;
  return (
    <Line
      points={[
        [source.position.x, source.position.y, source.position.z],
        [source.position.x, lift, source.position.z],
        [target.position.x, lift, target.position.z],
        [target.position.x, target.position.y, target.position.z]
      ]}
      color={style.color}
      lineWidth={2}
      transparent
      opacity={0.82}
    />
  );
}
