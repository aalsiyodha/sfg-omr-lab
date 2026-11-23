/**
 * v2.5.2 JEPA-style masked latent predictor, trained on each scanned sheet.
 *
 * No external pretrained weights. Fixed teacher encoder, trainable small
 * student predictor: surrounding UNUSED/blank bubble descriptors predict a
 * held-out bubble's 4D latent embedding, not its pixel values.
 *
 * Trained using unlabeled printed-template regions; must not be called a
 * fully trained I-JEPA/V-JEPA model. Diagnostic only, no score authority.
 */
import type { QuestionResult, BubbleMeasurement } from '../types';
export type LatentReport={
  trained:boolean;examples:number;heldOut:number;
  heldOutMse:number|null;trainingMse:number|null;
  anomalies:{question:number;option:string;error:number}[];
  model:'online-masked-latent-linear-v1';scoringPermission:false;
};
type V=[number,number,number,number];
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
export function embedTemplate(m:BubbleMeasurement):V{
  const x=clamp((m.localPaperBrightness??230)/255);
  const y=clamp((m.inkThreshold??160)/255);
  const z=clamp((m.radialOuter??0)/100);
  const a=clamp(m.fillPercent/100);
  // A small, bounded fixed teacher projection. No image reconstruction.
  return [(x+y)/2,(x-y+1)/2,(z+a)/2,(z-a+1)/2];
}
type Example={question:number;option:string;input:V;target:V};
function mean(xs:V[]):V{
  return [0,1,2,3].map(i=>xs.reduce((s,x)=>s+x[i],0)/xs.length) as V;
}
export function fitMaskedLatentPredictor(
  rows:QuestionResult[],epochs=40
):LatentReport{
  const empty:LatentReport={trained:false,examples:0,heldOut:0,
    trainingMse:null,heldOutMse:null,anomalies:[],
    model:'online-masked-latent-linear-v1',scoringPermission:false};
  const blank=new Map<string,BubbleMeasurement>();
  for(const row of rows)for(const m of row.measurements)
    if(m.fillPercent<=12&&!m.hatchLike&&!m.strokeLike&&
      m.localPaperBrightness!==undefined&&m.inkThreshold!==undefined)
      blank.set(row.question+':'+m.option,m);
  const examples:Example[]=[];
  for(const target of blank.values()){
    const question=target.question,option=target.option;
    const nearby:V[]=[];
    for(const dq of [-1,1]){
      const other=question+dq;
      if(other<1||other>50||(question<=25)!==(other<=25))continue;
      const m=blank.get(other+':'+option);
      if(m)nearby.push(embedTemplate(m));
    }
    // Context uses adjacent bubbles of the same question as backup.
    if(nearby.length<2){
      for(const opt of ['A','B','C','D']){
        if(opt===option)continue;
        const m=blank.get(question+':'+opt);
        if(m)nearby.push(embedTemplate(m));
      }
    }
    if(nearby.length<2)continue;
    examples.push({question,option,input:mean(nearby),
      target:embedTemplate(target)});
  }
  if(examples.length<25)return {...empty,examples:examples.length};
  const train=examples.filter(e=>e.question%5!==0);
  const held=examples.filter(e=>e.question%5===0);
  if(train.length<18||held.length<4)return {...empty,examples:examples.length};
  // 4x4 online-trained student predictor initialized as identity.
  const weights:number[][]=Array.from({length:4},(_,i)=>
    Array.from({length:4},(_,j)=>i===j?1:0));
  const bias=[0,0,0,0],rate=.08;
  const predict=(x:V)=>weights.map((w,i)=>
    bias[i]+w.reduce((sum,a,j)=>sum+a*x[j],0)) as V;
  for(let epoch=0;epoch<Math.max(1,Math.min(80,epochs));epoch++){
    for(const e of train){
      const y=predict(e.input);
      for(let i=0;i<4;i++){
        const err=y[i]-e.target[i];
        for(let j=0;j<4;j++)
          weights[i][j]-=rate*(err*e.input[j]+0.0001*(weights[i][j]-(i===j?1:0)));
        bias[i]-=rate*err;
      }
    }
  }
  const loss=(e:Example)=>{
    const y=predict(e.input);
    return y.reduce((s,a,i)=>s+(a-e.target[i])**2,0)/4;
  };
  const mse=(set:Example[])=>set.reduce((s,e)=>s+loss(e),0)/set.length;
  const errors=held.map(e=>({...e,error:loss(e)}));
  const heldOutMse=mse(held);
  return {trained:true,examples:examples.length,heldOut:held.length,
    trainingMse:Number(mse(train).toFixed(6)),
    heldOutMse:Number(heldOutMse.toFixed(6)),
    anomalies:errors.filter(e=>e.error>Math.max(.002,heldOutMse*4))
      .map(e=>({question:e.question,option:e.option,
        error:Number(e.error.toFixed(4))})).slice(0,12),
    model:'online-masked-latent-linear-v1',scoringPermission:false};
}
