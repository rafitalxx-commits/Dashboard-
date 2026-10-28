export type CarrierRule={id?:string;carrier:string;hours:number;enabled:boolean;suggestion:string;observations?:string};
export const defaultCarrierRules:CarrierRule[]=[{id:'carrier:mrw',carrier:'MRW',hours:72,enabled:true,suggestion:'Sugerir compensación / cupón y abrir reclamación por retraso',observations:''}];
