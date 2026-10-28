const icons:Record<string,[string,string]>={
 warehouse:['📦','blue'],carrier:['🚚','amber'],customer:['↩️','purple'],
 wrong_product:['🔀','purple'],missing_product:['📦','amber'],wrong_quantity:['🔢','blue'],order_crossing:['🔄','purple'],wrong_packaging:['📦','amber'],
 delivery_delay:['⏱️','amber'],late_delivery_rejected:['↩️','amber'],damage:['💥','red'],lost:['🔍','red'],delivered_not_received:['📭','amber'],return_to_origin:['↩️','purple'],
 withdrawal:['↩️','purple'],wrong_purchase:['🛒','blue'],incompatible_product:['🧩','amber'],warranty:['🛡️','green']
};
export function ChoiceIcon({value}:{value:string}){
 const [icon,tone]=icons[value]||( /refund/.test(value)?['💶','green']:/recover|collect|return|wait_resend|cross_wait/.test(value)?['↩️','purple']:/resend|missing/.test(value)?['🚚','blue']:/investigat|wait|diagnos|warranty/.test(value)?['🔍','amber']:/exchange/.test(value)?['🔄','purple']:['✅','green']);
 return <span className={`w-choice-icon tone-${tone}`} aria-hidden="true">{icon}</span>;
}
