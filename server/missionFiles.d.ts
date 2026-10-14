export interface MissionItem {
  seq: number;
  current: number;
  frame: number;
  command: number;
  params: number[];
  x: number;
  y: number;
  z: number;
  autocontinue: number;
}
export const MAX_MISSION_ITEMS: number;
export const MAX_MISSION_FILE_BYTES: number;
export function missionCoordinateScale(frame: number): number;
export function parseMissionText(text: string): MissionItem[];
export function missionDistanceKm(items: MissionItem[]): number | null;
