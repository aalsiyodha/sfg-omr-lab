/**
 * This institute-platform snapshot deliberately omits the opt-in OpenCV 5
 * benchmark. It does not run during normal OMR scoring in v2.7.1.
 * The production scanner at the repo root is unchanged.
 */
export interface SimdProbeResult {
 available:boolean; engine:string;loadMs:number;grayscaleMs:number;
 width:number;height:number;sampleMean:number|null;reason:string;
 inputExtractionMs?:number;legacyGrayMs?:number;maxSampleDifference?:number;
}
export async function measureOpenCv5Simd(canvas:HTMLCanvasElement):Promise<SimdProbeResult>{
 return {available:false,engine:'Opt-in experimental OpenCV 5 SIMD benchmark disabled in institute preview',
 loadMs:0,grayscaleMs:0,width:canvas.width,height:canvas.height,sampleMean:null,
 reason:'Optional benchmark excluded; the v2.7.1 scoring engine remains unchanged'};
}
