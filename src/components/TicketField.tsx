export default function TicketField({ 
  label, 
  value, 
  emphasis = false 
}: { 
  label: string, 
  value: string | number, 
  emphasis?: boolean 
}) {
  return (
    <div className="flex flex-col mb-4">
      <span className="text-[10px] font-bold uppercase tracking-widest text-brandOrange mb-[2px]">
        {label}
      </span>
      <span className={`font-roboto text-navy ${emphasis ? 'text-lg font-bold' : 'text-xs font-medium'}`}>
        {value}
      </span>
    </div>
  );
}