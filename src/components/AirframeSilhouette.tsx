import { airframeOption } from "../domain/airframes";

export function AirframeSilhouette({ frame }: { frame: string }) {
  const model = airframeOption(frame);
  const kind = model.visualKind;
  const flyingWing = kind === "flying-wing";
  const wheelsPerSide = (model.wheelCount ?? 4) / 2;
  return <svg className="airframe-silhouette" viewBox="0 0 200 140" aria-hidden="true">
    <g fill="#9cbdd0" stroke="#44768e" strokeWidth="2" strokeLinejoin="round">
      {model.vehicle === "Rover" ? <>
        {kind === "tracked" ? [-1, 1].map(side => <rect key={side} x={side < 0 ? 40 : 137} y="22" width="23" height="96" rx="10" fill="#375266" />)
          : [-1, 1].flatMap(side => Array.from({ length: wheelsPerSide }, (_, index) =>
            <rect key={`${side}-${index}`} x={side < 0 ? 40 : 140} y={wheelsPerSide === 1 ? 56 : 23 + index * 70 / (wheelsPerSide - 1)} width="20" height="27" rx="6" fill="#375266" />))}
        <rect x="62" y={kind === "balancebot" ? 51 : 22} width="76" height={kind === "balancebot" ? 38 : 97} rx="9" />
        <rect x="77" y="46" width="46" height="41" rx="4" fill="#dfeaf0" />
        {kind === "buggy" ? <path d="M69 35L131 101M131 35L69 101" fill="none" /> : null}
        <path d="M89 28L100 18L111 28" fill="none" stroke="#0284c7" strokeWidth="3" />
      </> : <>
        {flyingWing ? <path d="M100 22L190 94L185 111L113 91L100 102L87 91L15 111L10 94Z" /> : <>
          <path d={kind === "glider" ? "M100 47L7 61L7 76L100 69L193 76L193 61Z" : "M100 43L13 65L17 88L100 72L183 88L187 65Z"} />
          {kind === "twin-boom" ? <><path d="M63 69L63 115M137 69L137 115" strokeWidth="5" /><path d="M59 107H141V118H59Z" /></> :
            <path d={kind === "vtail" ? "M100 99L71 115L71 126L100 112L129 126L129 115Z" : "M100 101L65 111L65 121L100 115L135 121L135 111Z"} />}
        </>}
        <path d={kind === "twin-boom" || flyingWing ? "M100 25Q85 35 91 82Q100 95 109 82Q115 35 100 25Z" : "M100 13Q87 25 94 94L100 123L106 94Q113 25 100 13Z"} fill="#dfebf1" />
        {kind === "quadplane" ? [-1, 1].flatMap(x => [-1, 1].map(z => <g key={`${x}-${z}`}><path d={`M${100 + x * 45} 39V102`} strokeWidth="3" /><ellipse cx={100 + x * 45} cy={z < 0 ? 37 : 103} rx="20" ry="6" fill="#375266" /></g>)) : null}
      </>}
    </g>
  </svg>;
}
