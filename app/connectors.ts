import * as THREE from "three";

export type MeshConnector={local:THREE.Vector3;axis:THREE.Vector3;kind:"round"|"axle";role:"socket"|"shaft";diameter:number;length?:number};
type Loop={axisIndex:number;plane:number;u:number;v:number;du:number;dv:number;points:number};
const coord=(v:THREE.Vector3,i:number)=>i===0?v.x:i===1?v.y:v.z;
const vector=(axis:number,a:number,b:number,c:number)=>axis===0?new THREE.Vector3(a,b,c):axis===1?new THREE.Vector3(b,a,c):new THREE.Vector3(b,c,a);

export function objectLocalBounds(root:THREE.Object3D){root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),box=new THREE.Box3();root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;o.geometry.computeBoundingBox();if(o.geometry.boundingBox)box.union(o.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld)))});return box}

export type LocalTrimesh={vertices:Float32Array;indices:Uint32Array};

export function objectLocalTrimesh(root:THREE.Object3D):LocalTrimesh{
  root.updateMatrixWorld(true);
  const inverse=root.matrixWorld.clone().invert(),vertices:number[]=[],indices:number[]=[];
  const point=new THREE.Vector3();
  root.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    const position=object.geometry.getAttribute("position");if(!position)return;
    const matrix=inverse.clone().multiply(object.matrixWorld),base=vertices.length/3;
    for(let i=0;i<position.count;i++){point.fromBufferAttribute(position,i).applyMatrix4(matrix);vertices.push(point.x,point.y,point.z)}
    const index=object.geometry.index;
    if(index)for(let i=0;i<index.count;i++)indices.push(base+index.getX(i));
    else for(let i=0;i<position.count;i++)indices.push(base+i);
  });
  return{vertices:new Float32Array(vertices),indices:new Uint32Array(indices)};
}

export function detectConnectorHoles(root:THREE.Object3D):MeshConnector[]{
  root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),loops:Loop[]=[];
  for(let axis=0;axis<3;axis++){
    const planes=new Map<number,{a:THREE.Vector3;b:THREE.Vector3}[]>();
    root.traverse(object=>{
      if(!(object instanceof THREE.LineSegments))return;const position=object.geometry.getAttribute("position");if(!position)return;const matrix=inverse.clone().multiply(object.matrixWorld);
      for(let i=0;i+1<position.count;i+=2){const a=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(matrix),b=new THREE.Vector3().fromBufferAttribute(position,i+1).applyMatrix4(matrix);if(Math.abs(coord(a,axis)-coord(b,axis))>.012)continue;const key=Math.round(((coord(a,axis)+coord(b,axis))/2)/.02);const list=planes.get(key)??[];list.push({a,b});planes.set(key,list)}
    });
    for(const [key,edges] of planes){const parent=new Map<string,string>(),pointMap=new Map<string,THREE.Vector3>();const id=(p:THREE.Vector3)=>`${Math.round(p.x/.012)},${Math.round(p.y/.012)},${Math.round(p.z/.012)}`;const find=(x:string):string=>{const p=parent.get(x)??x;if(p===x){parent.set(x,x);return x}const r=find(p);parent.set(x,r);return r};const union=(a:string,b:string)=>{const ra=find(a),rb=find(b);if(ra!==rb)parent.set(rb,ra)};
      for(const edge of edges){const a=id(edge.a),b=id(edge.b);pointMap.set(a,edge.a);pointMap.set(b,edge.b);union(a,b)}
      const groups=new Map<string,THREE.Vector3[]>();for(const [idKey,p] of pointMap){const rootKey=find(idKey),group=groups.get(rootKey)??[];group.push(p);groups.set(rootKey,group)}
      const other=[0,1,2].filter(i=>i!==axis);for(const points of groups.values()){if(points.length<6)continue;const us=points.map(p=>coord(p,other[0])),vs=points.map(p=>coord(p,other[1])),umin=Math.min(...us),umax=Math.max(...us),vmin=Math.min(...vs),vmax=Math.max(...vs),du=umax-umin,dv=vmax-vmin;if(du<.32||dv<.32||du>.86||dv>.86||Math.min(du,dv)/Math.max(du,dv)<.68)continue;loops.push({axisIndex:axis,plane:key*.02,u:(umin+umax)/2,v:(vmin+vmax)/2,du,dv,points:points.length})}
    }
  }
  const result:MeshConnector[]=[];
  for(let i=0;i<loops.length;i++)for(let j=i+1;j<loops.length;j++){const a=loops[i],b=loops[j];if(a.axisIndex!==b.axisIndex)continue;const depth=Math.abs(a.plane-b.plane);if(depth<.15||depth>1.25||Math.hypot(a.u-b.u,a.v-b.v)>.09||Math.abs(a.du-b.du)>.14||Math.abs(a.dv-b.dv)>.14)continue;const axis=new THREE.Vector3();axis.setComponent(a.axisIndex,1);const center=vector(a.axisIndex,(a.plane+b.plane)/2,(a.u+b.u)/2,(a.v+b.v)/2),diameter=(a.du+a.dv+b.du+b.dv)/4,kind:MeshConnector["kind"]=(a.points+b.points)<18?"axle":"round";if(!result.some(c=>c.local.distanceTo(center)<.12&&Math.abs(c.axis.dot(axis))>.9))result.push({local:center,axis,kind,role:"socket",diameter})}
  return result;
}

export function fallbackBeamConnectors(root:THREE.Object3D,name:string):MeshConnector[]{
  const match=name.match(/^Technic Beam\s+(\d+)/i);if(!match)return[];const count=Math.max(1,Math.min(15,+match[1])),center=objectLocalBounds(root).getCenter(new THREE.Vector3());return Array.from({length:count},(_,i)=>({local:new THREE.Vector3(center.x,center.y,center.z+i-(count-1)/2),axis:new THREE.Vector3(1,0,0),kind:"round" as const,role:"socket" as const,diameter:.6}))
}

export function rodConnectors(root:THREE.Object3D,kind:"round"|"axle"):MeshConnector[]{
  const bounds=objectLocalBounds(root),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),dimensions=[size.x,size.y,size.z],axisIndex=dimensions.indexOf(Math.max(...dimensions)),axis=new THREE.Vector3();axis.setComponent(axisIndex,1);
  const length=dimensions[axisIndex]*.94,diameter=Math.max(...dimensions.filter((_,index)=>index!==axisIndex));
  if(kind==="axle")return[{local:center,axis,kind,role:"shaft",diameter,length}];
  const studs=Math.max(2,Math.round(length)),offset=(studs-1)/2;
  return[-1,1].map(direction=>({local:center.clone().addScaledVector(axis,direction*offset),axis:axis.clone(),kind,role:"shaft" as const,diameter,length:length/2}));
}

export function hybridAxlePinConnectors(root:THREE.Object3D):MeshConnector[]{
  const ends=rodConnectors(root,"round");return[ends[0],{...ends[1],kind:"axle",length:ends[1].length,local:ends[1].local.clone(),axis:ends[1].axis.clone()}];
}

export type CollisionPrimitive={shape:"box"|"cylinder";center:THREE.Vector3;size?:THREE.Vector3;radius?:number;halfHeight?:number;rotation:THREE.Quaternion};

const canonicalDirection=(direction:THREE.Vector3)=>{const result=direction.clone().normalize();const values=[result.x,result.y,result.z],first=values.find(value=>Math.abs(value)>.001)??1;if(first<0)result.negate();return result};

export function approximateCollisionPrimitives(root:THREE.Object3D,name:string,connectors:MeshConnector[]):CollisionPrimitive[]{
  const bounds=objectLocalBounds(root),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),dimensions=[size.x,size.y,size.z],axisIndex=dimensions.indexOf(Math.max(...dimensions)),longAxis=new THREE.Vector3();longAxis.setComponent(axisIndex,1);
  if(/^Technic (Axle|Pin)/i.test(name)){
    const others=dimensions.filter((_,index)=>index!==axisIndex),radius=Math.max(.12,Math.max(...others)*.38),length=dimensions[axisIndex]*.92,rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),longAxis),result:CollisionPrimitive[]=[{shape:"cylinder",center:center.clone(),radius,halfHeight:length/2,rotation}];
    if(/stop|bush|flange/i.test(name)){const stopCenter=center.clone().addScaledVector(longAxis,length*.28);result.push({shape:"cylinder",center:stopCenter,radius:radius*1.35,halfHeight:Math.max(.08,length*.09),rotation:rotation.clone()})}
    return result;
  }
  if(/wheel|tyre|tire|gear|bush/i.test(name)){
    const wheelAxisIndex=dimensions.indexOf(Math.min(...dimensions)),wheelAxis=new THREE.Vector3();wheelAxis.setComponent(wheelAxisIndex,1);const others=dimensions.filter((_,index)=>index!==wheelAxisIndex);
    return[{shape:"cylinder",center,radius:Math.max(...others)*.46,halfHeight:dimensions[wheelAxisIndex]*.45,rotation:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),wheelAxis)}];
  }
  const sockets=connectors.filter(connector=>connector.role==="socket"),points=sockets.map(connector=>connector.local);
  if(/^Technic (Beam|Panel|Pin Connector)/i.test(name)&&points.length>=2){
    type Candidate={indices:number[];direction:THREE.Vector3;origin:THREE.Vector3;span:number};const candidates:Candidate[]=[];
    for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
      const delta=points[j].clone().sub(points[i]),distance=delta.length();if(distance<.45)continue;const direction=canonicalDirection(delta),indices=points.map((point,index)=>({index,distance:point.clone().sub(points[i]).cross(direction).length()})).filter(item=>item.distance<.16).map(item=>item.index);if(indices.length<2)continue;
      const key=indices.slice().sort((a,b)=>a-b).join(",");if(candidates.some(candidate=>candidate.indices.slice().sort((a,b)=>a-b).join(",")===key))continue;
      const projections=indices.map(index=>points[index].dot(direction)),minimum=Math.min(...projections),maximum=Math.max(...projections),origin=direction.clone().multiplyScalar((minimum+maximum)/2);const perpendicular=points[indices[0]].clone().addScaledVector(direction,-points[indices[0]].dot(direction));origin.add(perpendicular);candidates.push({indices,direction,origin,span:maximum-minimum});
    }
    candidates.sort((a,b)=>b.indices.length-a.indices.length||a.span-b.span);const chosen:Candidate[]=[],covered=new Set<number>();
    for(const candidate of candidates){if(candidate.indices.some(index=>!covered.has(index))||chosen.length===0){chosen.push(candidate);candidate.indices.forEach(index=>covered.add(index))}if(covered.size===points.length||chosen.length===6)break}
    if(chosen.length){
      const crossSection=Math.max(.42,Math.min(.72,[...dimensions].sort((a,b)=>a-b)[1]*.72)),result:CollisionPrimitive[]=[],keyIndices=new Set<number>();
      for(const line of chosen){const projections=line.indices.map(index=>({index,value:points[index].dot(line.direction)})).sort((a,b)=>a.value-b.value),first=projections[0],last=projections[projections.length-1];keyIndices.add(first.index);keyIndices.add(last.index);result.push({shape:"box",center:line.origin.clone(),size:new THREE.Vector3(line.span+crossSection*.35,crossSection,crossSection),rotation:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1,0,0),line.direction)})}
      for(let index=0;index<points.length;index++){const memberships=chosen.filter(line=>line.indices.includes(index));if(memberships.length>1)keyIndices.add(index)}
      for(const index of keyIndices){const connector=sockets[index],rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),connector.axis);result.push({shape:"cylinder",center:connector.local.clone(),radius:crossSection*.58,halfHeight:crossSection*.48,rotation})}
      return result;
    }
  }
  if(points.length===1){const connector=sockets[0],crossSection=Math.max(.42,Math.min(.72,[...dimensions].sort((a,b)=>a-b)[1]*.72));return[{shape:"box",center,size:size.clone().multiplyScalar(.82),rotation:new THREE.Quaternion()},{shape:"cylinder",center:connector.local.clone(),radius:crossSection*.58,halfHeight:crossSection*.48,rotation:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),connector.axis)}]}
  return[{shape:"box",center,size:size.clone().multiplyScalar(.88),rotation:new THREE.Quaternion()}];
}
