export type LDrawPlacement = {
  part: string;
  color: number;
  position: [number, number, number];
  matrix: [number, number, number, number, number, number, number, number, number];
};

export function parseLDR(source: string): LDrawPlacement[] {
  const result: LDrawPlacement[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const token = raw.trim().split(/\s+/);
    if (token[0] !== "1" || token.length < 15) continue;
    const n = token.slice(1, 14).map(Number);
    if (n.some(Number.isNaN)) continue;
    result.push({ color:n[0], position:[n[1],n[2],n[3]], matrix:n.slice(4,13) as LDrawPlacement["matrix"], part:token.slice(14).join(" ").replace(/\\/g,"/").split("/").pop()!.replace(/\.dat$/i,"") });
  }
  return result;
}

export const makeLDR = (lines:string[]) => ["0 FILE sim-studio-model.ldr","0 Sim Studio Physics Build Lab","0 Name: sim-studio-model.ldr","0 !LDRAW_ORG Model",...lines,"0"].join("\r\n");
