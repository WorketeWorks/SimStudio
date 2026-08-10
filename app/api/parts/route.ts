type PartResult = { part:string; name:string; thumb:string; color:number; modelPart?:string };

const canonicalPartAliases:Record<string,string>={
  "32556":"32556a",
};

const familyQueries:Record<string,string[]>={
  beams:["Technic Beam 0.5","Technic Beam 1","Technic Beam 2","Technic Beam 3","Technic Beam 4","Technic Beam 5","Technic Beam 6","Technic Beam 7","Technic Beam 9","Technic Beam 11","Technic Beam 13","Technic Beam 15","Technic Beam Bent"],
  axles:["Technic Axle 1","Technic Axle 2","Technic Axle 3","Technic Axle 4","Technic Axle 5","Technic Axle 6","Technic Axle 7","Technic Axle 8","Technic Axle 10","Technic Axle 12","Technic Axle 16","Technic Axle with Stop"],
  pins:["Technic Pin","Technic Pin without Friction","Technic Pin with Friction","Technic Axle Pin"],
  gears:["Technic Gear","Technic Worm Gear","Technic Differential"],
  wheels:["Technic Wheel","Technic Tyre","Technic Tire"],
  motors:["Electric Motor","Technic Motor"],
};
const decode=(v:string)=>v.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim();
const translate=(value:string)=>value.toLowerCase()
  .replace(/\bvigas?\b/g,"Technic Beam").replace(/\bejes?\b/g,"Technic Axle")
  .replace(/\bpines?\b/g,"Technic Pin").replace(/\bengranajes?\b/g,"Technic Gear")
  .replace(/\bruedas?\b/g,"Technic Wheel").replace(/\bmotores?\b/g,"Electric Motor")
  .replace(/sin fricci[oó]n/g,"without friction").replace(/con fricci[oó]n/g,"with friction")
  .replace(/con tope/g,"with stop").replace(/\bmedia\b/g,"0.5");
const commonColor=(family:string,part:string,name:string)=>{
  if(family==="pins"||/pin/i.test(name)){
    if(part==="2780"||/friction and slots/i.test(name))return 0;
    if(/without friction/i.test(name))return 1;
    if(/axle pin.*friction|pin long with friction/i.test(name))return 1;
    if(/axle pin/i.test(name))return 19;
    return 0;
  }
  if(family==="axles"||/^Technic Axle/i.test(name))return /with stop/i.test(name)?72:0;
  if(family==="gears")return 72;
  if(family==="wheels")return 0;
  if(family==="motors")return 71;
  return 72;
};
export function parsePartSearchHtml(html:string,family:string){
  const items:PartResult[]=[];
  for(const record of html.split(/<div class="fi-ta-record-content-ctn">/i).slice(1)){
    const image=record.match(/<img[^>]+src="([^"]+?-thumb\.png[^"]*)"/i),
      file=record.match(/<div class="fi-ta-text-item[^"]*fi-font-bold[^"]*"[^>]*>\s*(parts\/(?:s\/)?([\w-]+)\.dat)\s*<\/div>/i),
      description=record.match(/<div class="fi-ta-text-item[^"]*fi-font-mono[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if(!image||!file||!description||file[1].toLowerCase().startsWith("parts/s/"))continue;
    const name=decode(description[1].replace(/<[^>]+>/g,"")),part=file[2];
    if(name.startsWith("=")||name.startsWith("~"))continue;
    items.push({part,modelPart:part,name,thumb:image[1].replace(/&amp;/g,"&"),color:commonColor(family,part,name)});
  }
  return items;
}
async function search(query:string,family:string){
  const response=await fetch(`https://library.ldraw.org/parts/list?tableSearch=${encodeURIComponent(query)}`,{headers:{"User-Agent":"Sim-Studio/0.3"}});if(!response.ok)return[];
  return parsePartSearchHtml(await response.text(),family);
}
export async function GET(request:Request){
  const url=new URL(request.url),family=url.searchParams.get("family")||"",q=url.searchParams.get("q")?.trim().slice(0,80)||"",refs=(url.searchParams.get("refs")||"").split(",").map(x=>x.trim().replace(/\.dat$/i,"")).filter(Boolean).slice(0,120);
  try{
    if(refs.length){
      const requests=refs.map(requested=>({requested,canonical:canonicalPartAliases[requested.toLowerCase()]??requested})),
        batches=await Promise.all(requests.map(({canonical})=>search(canonical,""))),seen=new Set<string>(),items:PartResult[]=[];
      requests.forEach(({requested,canonical},index)=>{
        const match=batches[index].find(item=>item.part.toLowerCase()===canonical.toLowerCase());
        const key=requested.toLowerCase();
        if(match&&!seen.has(key)){seen.add(key);items.push({...match,part:requested,modelPart:canonical})}
      });
      return Response.json({items,query:refs},{headers:{"Cache-Control":"public, max-age=3600"}})
    }
    const translated=q?translate(q):"";const queries=q?[translated]:(familyQueries[family]??["Technic Beam"]);const batches=await Promise.all(queries.map(x=>search(x,family)));const seen=new Set<string>();let items=batches.flat().filter(x=>{if(seen.has(x.part))return false;seen.add(x.part);return true});
    if(family==="beams")items=items.filter(x=>/^Technic Beam/i.test(x.name));
    if(family==="axles")items=items.filter(x=>/^Technic Axle( |$)/i.test(x.name)&&!/Connector|Hole|Ball|Gear/i.test(x.name));
    if(family==="pins")items=items.filter(x=>/^Technic (Axle )?Pin/i.test(x.name));
    if(q&&!/^\w*\d[\w-]*$/i.test(q)){if(translated.includes("technic beam"))items=items.filter(x=>/^Technic Beam/i.test(x.name));if(translated.includes("technic axle"))items=items.filter(x=>/^Technic Axle/i.test(x.name));if(translated.includes("technic pin"))items=items.filter(x=>/^Technic (Axle )?Pin/i.test(x.name));const words=translated.toLowerCase().split(/\s+/).filter(Boolean);items=items.filter(x=>words.every(word=>x.name.toLowerCase().includes(word)))}
    items.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
    return Response.json({items:items.slice(0,q?40:140),query:q||family},{headers:{"Cache-Control":"public, max-age=3600"}});
  }catch{return Response.json({items:[],error:"No se pudo consultar LDraw"},{status:502})}
}
