export type PaletteFamily="beams"|"axles"|"pins"|"connectors"|"gears"|"wheels";
type Entry=[part:string,name:string,bricklinkColor:number];

const groups:Record<PaletteFamily,Entry[]>={
  connectors:[
    ["3713","Technic Bush with Two Flanges",86],["4265c","Technic Bush 1/2 Smooth",86],
    ["45590","Technic Axle Joiner Double Flexible",11],
    ["32013","Technic Angle Connector #1",86],["32034","Technic Angle Connector #2 (180°)",86],["32016","Technic Angle Connector #3 (157.5°)",86],["32192","Technic Angle Connector #4 (135°)",86],["32015","Technic Angle Connector #5 (112.5°)",86],["32014","Technic Angle Connector #6 (90°)",86],
    ["22961","Technic Axle with Perpendicular Pin Hole",86],["27940","Technic Axle 3L with Middle Pin Hole",85],["10197","Technic Axle and Pin Connector Hub 90°",85],
    ["6536","Technic Cross Block 1 x 2",86],["42003","Technic Cross Block 1 x 3 (Axle/Pin/Pin)",86],["32184","Technic Cross Block 1 x 3 (Axle/Pin/Axle)",86],["32291","Technic Cross Block 2 x 2",86],["41678","Technic Cross Block 2 x 2 Split",86],["92907","Technic Cross Block Bent 90°",86],["63869","Technic Cross Block 3 x 2",86],
    ["6538c","Technic Axle Joiner Inline Smooth",86],["26287","Technic Axle Joiner 3L",86],["48989","Technic Cross Block 1 x 3 with 4 Pins",86],["87408","Technic Toggle Joint Double",11]
  ],
  wheels:[["4185","Technic Wedge Belt Wheel",86]],
  pins:[
    ["11214","Technic Axle Pin Long with Friction, 2L Pin",85],["43093","Technic Axle Pin with Friction",7],["3749","Technic Axle Pin",2],["18651","Technic Axle Pin Long with Friction, 2L Axle",11],
    ["6558","Technic Pin Long with Friction and Slot",7],["87082","Technic Pin Long with Pin Hole",86],["32054","Technic Pin Long with Stop Bush",86],["32054","Technic Pin Long with Stop Bush",5],["32556","Technic Pin Long without Friction",2],["15100","Technic Pin with Friction and Perpendicular Hole",11],["2780","Technic Pin with Friction and Slots",11],["3673","Technic Pin without Friction",86]
  ],
  axles:[
    ["32062","Technic Axle 2 Notched",5],["4519","Technic Axle 3",86],["24316","Technic Axle 3 with Stop",88],["3705","Technic Axle 4",11],["87083","Technic Axle 4 with Stop",85],["32073","Technic Axle 5",86],["15462","Technic Axle 5 with Stop",88],["3706","Technic Axle 6",11],["44294","Technic Axle 7",86],["3707","Technic Axle 8",11],["55013","Technic Axle 8 with Stop",85],["60485","Technic Axle 9",86],["3737","Technic Axle 10",11],["23948","Technic Axle 11",86],["3708","Technic Axle 12",11]
  ],
  gears:[
    ["6589","Technic Gear 12 Tooth Bevel",2],["32270","Technic Gear 12 Tooth Double Bevel",11],["94925","Technic Gear 16 Tooth Reinforced",86],["32269","Technic Gear 20 Tooth Double Bevel",2],["3648","Technic Gear 24 Tooth",85],["46372","Technic Gear 28 Tooth Double Bevel",86],["32498","Technic Gear 36 Tooth Double Bevel",11],["10928","Technic Gear 8 Tooth Reinforced",85]
  ],
  beams:[
    ["18654","Technic Beam 1",86],["43857","Technic Beam 2",86],["60483","Technic Beam 2 Liftarm",86],["41677","Technic Beam 2 x 0.5 Liftarm",86],["32523","Technic Beam 3",86],["6632","Technic Beam 3 x 0.5 Liftarm",86],["32449","Technic Beam 4 x 0.5 Liftarm",86],["2825","Technic Beam 4 x 0.5 with Boss",86],
    ["32316","Technic Beam 5",86],["32017","Technic Beam 5 x 0.5",86],["11478","Technic Beam 5 x 0.5 with Axle Holes",86],["32063","Technic Beam 6 x 0.5",86],["32524","Technic Beam 7",86],["32065","Technic Beam 7 x 0.5",86],["40490","Technic Beam 9",86],["32271","Technic Beam 3 x 7 Bent 53.13°",86],["32525","Technic Beam 11",86],["41239","Technic Beam 13",86],["32278","Technic Beam 15",86],
    ["32140","Technic Beam 2 x 4 Bent 90°",86],["71708","Technic Beam 2 x 3 Liftarm Bent 90° Quarter Ellipse",86],["32056","Technic Beam 3 x 3 x 0.5 Bent 90°",85],["60484","Technic Beam 3 x 3 T-shaped",86],["55615","Technic Pin Connector 3 x 3 Bent 90°",86],["32526","Technic Beam 3 x 5 Bent 90°",86],["14720","Technic Beam 5 x 3 H-shaped",86],["99773","Technic Beam 5 x 3 x 0.5 Triangle",86],["15458","Technic Panel 3 x 11",86],["64179","Technic Beam 7 x 5 Open Center",86],["32251","Technic Beam 5 x 7 Bent Quarter Ellipse",85],["64178","Technic Beam 11 x 5 Open Center",86],["64782","Technic Panel 5 x 11",86]
  ]
};

const ldrawColor:Record<number,number>={2:19,5:4,7:1,11:0,85:72,86:71,88:70};
const defaultColorOverride:Record<string,number>={"4265c":14,"15458":72};
const invalidGeometry=new Set<string>();
const modelAlias:Record<string,string>={"4265c":"32123b","4185":"4185b","6538c":"59443","3648":"3648b"};
export const paletteRequestAliases:Record<string,string>={"32123a":"4265c"};
const thumbAlias:Record<string,string>={"32556":"32556b"};
const thumbId:Record<string,number>={
  "3713":6784,"32123b":5579,"4185b":8129,"11214":388,"43093":8530,"3749":6834,"32062":5541,"18651":1221,"4519":8934,"24316":2294,"3705":6762,"87083":13103,"32073":5553,"15462":851,"3706":6765,"44294":8683,"3707":6767,"55013":10160,"60485":10650,"3737":6803,"23948":2182,"3708":6769,
  "45590":9043,"32013":5501,"32034":5526,"32016":5504,"32192":5624,"32015":5503,"32014":5502,"22961":2013,"27940":3116,"10197":242,"6536":11777,"42003":8199,"32184":5614,"32291":5697,"41678":7992,"92907":13823,"63869":11564,"59443":10458,"26287":2850,
  "6589":11864,"32270":5668,"94925":14043,"32269":5667,"3648b":6672,"46372":25167,"32498":5794,"10928":312,"18654":1223,"43857":8641,"60483":10647,"41677":7991,"32523":5796,"6632":11881,"32449":5752,"2825":3162,"32316":5721,"32017":5505,"11478":461,"32063":5542,"32524":5798,"32065":5548,"40490":7552,"32271":5669,"32525":5799,"41239":7796,"32278":5679,"32140":5590,"71708":26188,"32056":5533,"60484":10649,"55615":10189,"32526":5800,"14720":688,"99773":15141,"15458":847,"64179":11590,"32251":5666,"64178":11589,"64782":11701,
  "6558":11816,"87082":13102,"32054":5532,"32556":43906,"48989":9789,"87408":13112,"15100":782,"2780":3099,"3673":6706
};

export const paletteParts=Object.entries(groups).flatMap(([family,entries])=>entries.map(([part,name,bricklinkColor])=>{const modelPart=modelAlias[part]??part,id=thumbId[modelPart],thumbPart=thumbAlias[part]??modelPart,sourceColor=ldrawColor[bricklinkColor]??71,color=defaultColorOverride[part]??sourceColor;return{
  part,name,family:family as PaletteFamily,color,sourceColor,kind:(family==="gears"||family==="wheels"?"wheel":"beam") as "beam"|"wheel"|"motor",gear:family==="gears",modelPart,rawThumb:true,
  origin:"default-palette" as const,sourceKind:(invalidGeometry.has(part)?"ldraw-network":"packaged-cache") as "ldraw-network"|"packaged-cache",requestedPart:part,catalogReturnedPart:part,resolvedPart:modelPart,
  geometry:invalidGeometry.has(part)?undefined:`catalog/geometry/${part}-${sourceColor}.json`,
  thumb:id?`catalog/renders/${modelPart}.png`:undefined,
  sourceThumb:id?`https://library.ldraw.org/media/parts/${id}/conversions/${thumbPart}-thumb.png`:undefined
}}));
