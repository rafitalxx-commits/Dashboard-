import {Warehouse,Truck,UserRound,Clock3,LoaderCircle,UserRoundCheck,CheckCircle2,Sparkles,LockKeyhole,Workflow} from 'lucide-react';
export function IncidentListIcon({kind,value,label}:{kind:'origin'|'client'|'internal';value:string;label:string}){
 const icons:Partial<Record<string,typeof Truck>>=kind==='origin'?{warehouse:Warehouse,carrier:Truck,customer:UserRound}:kind==='client'?{'Pendiente':Clock3,'En gestión':LoaderCircle,'Esperando cliente':UserRoundCheck,'Solucionado':CheckCircle2}:{'Nueva':Sparkles,'En gestión':Workflow,'Esperando':Clock3,'Reenvío enviado':Truck,'Resuelta':CheckCircle2,'Cerrada':LockKeyhole};
 const Icon=icons[value]||Clock3;const tone=kind==='origin'?(value==='warehouse'?'blue':value==='carrier'?'amber':'violet'):['Solucionado','Resuelta','Reenvío enviado'].includes(value)?'green':value==='Cerrada'?'slate':value.startsWith('Esperando')||value==='Pendiente'?'amber':'blue';
 return <span className={`inc-list-icon inc-icon-${tone}`} title={label} role="img" aria-label={label}><Icon size={17} strokeWidth={1.8}/></span>;
}
