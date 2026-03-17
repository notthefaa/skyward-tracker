import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PlaneTakeoff, MapPin, User, Droplet, Phone, Mail, Wrench, AlertTriangle, FileText } from "lucide-react";
import TicketField from "@/components/TicketField";

export default function SummaryTab({ aircraft }: { aircraft: any }) {
  const [nextMx, setNextMx] = useState<any>(null);
  const[activeSquawks, setActiveSquawks] = useState<any[]>([]);
  const [latestNote, setLatestNote] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (aircraft) fetchSummaryData();
  }, [aircraft]);

  const fetchSummaryData = async () => {
    setIsLoading(true);
    
    // 1. FETCH & CALCULATE NEXT MAINTENANCE
    const { data: mxData } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft.id);
    if (mxData && mxData.length > 0) {
      const currentEngineTime = aircraft.total_engine_time || 0;
      
      const processedMx = mxData.map(item => {
        let remaining = 0;
        let isExpired = false;
        let dueText = "";

        if (item.tracking_type === 'time') {
          remaining = item.due_time - currentEngineTime;
          isExpired = remaining <= 0;
          dueText = isExpired ? `Expired by ${Math.abs(remaining).toFixed(1)} hrs` : `Due in ${remaining.toFixed(1)} hrs (@ ${item.due_time})`;
        } else {
          const diffTime = new Date(item.due_date + 'T00:00:00').getTime() - new Date(new Date().setHours(0,0,0,0)).getTime();
          remaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          isExpired = remaining < 0;
          dueText = isExpired ? `Expired ${Math.abs(remaining)} days ago` : `Due in ${remaining} days (${item.due_date})`;
        }
        return { ...item, remaining, isExpired, dueText };
      });

      processedMx.sort((a, b) => a.remaining - b.remaining);
      setNextMx(processedMx[0]);
    } else {
      setNextMx(null);
    }

    // 2. FETCH ACTIVE SQUAWKS
    const { data: sqData } = await supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft.id).eq('status', 'open').order('created_at', { ascending: false });
    setActiveSquawks(sqData ||[]);

    // 3. FETCH LATEST NOTE
    const { data: noteData } = await supabase.from('aft_notes').select('*').eq('aircraft_id', aircraft.id).order('created_at', { ascending: false }).limit(1);
    setLatestNote(noteData?.[0] || null);

    setIsLoading(false);
  };

  if (!aircraft) return null;

  const isTurbine = aircraft.engine_type === 'Turbine';
  const weightPerGal = isTurbine ? 6.7 : 6.0;
  const fuelGals = aircraft.current_fuel_gallons || 0;
  const fuelLbs = Math.round(fuelGals * weightPerGal);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      
      {/* HEADER CARD: Avatar & Details */}
      <div className="bg-cream shadow-lg rounded-sm overflow-hidden border-t-4 border-navy">
        
        <div className="relative h-56 bg-slateGray flex items-center justify-center">
          {aircraft.avatar_url ? (
            <img src={aircraft.avatar_url} alt="Aircraft Avatar" className="w-full h-full object-cover" />
          ) : (
            <PlaneTakeoff size={64} className="text-white/20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col justify-end p-6">
            <h2 className="font-oswald text-4xl md:text-5xl font-bold text-white uppercase leading-none mb-1">
              {aircraft.tail_number}
            </h2>
            <p className="text-sm text-gray-200 font-bold uppercase tracking-widest">
              {aircraft.aircraft_type} • SN: {aircraft.serial_number || 'N/A'}
            </p>
          </div>
        </div>

        {/* 3-COLUMN CONTACT GRID */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-6">
          
          <div className="flex items-start gap-3 text-navy">
            <MapPin size={18} className="text-brandOrange mt-1 shrink-0" />
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">Home Base</span>
              <span className="font-roboto font-bold text-sm">{aircraft.home_airport || 'Not Assigned'}</span>
            </div>
          </div>
          
          <div className="flex items-start gap-3 text-navy">
            <User size={18} className="text-brandOrange mt-1 shrink-0" />
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">Main Contact</span>
              <span className="font-roboto font-bold text-sm block mb-2">{aircraft.main_contact || 'Not Assigned'}</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {aircraft.main_contact_phone && (
                  <a href={`tel:${aircraft.main_contact_phone}`} className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-brandOrange hover:text-orange-600 bg-orange-50 border border-orange-200 px-2 py-1 rounded transition-colors active:scale-95">
                    <Phone size={12} /> Call
                  </a>
                )}
                {aircraft.main_contact_email && (
                  <a href={`mailto:${aircraft.main_contact_email}`} className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-navy hover:text-blue-800 bg-blue-50 border border-blue-200 px-2 py-1 rounded transition-colors active:scale-95">
                    <Mail size={12} /> Email
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 text-navy">
            <Wrench size={18} className="text-brandOrange mt-1 shrink-0" />
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">MX Contact</span>
              <span className="font-roboto font-bold text-sm block mb-2">{aircraft.mx_contact || 'Not Assigned'}</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {aircraft.mx_contact_phone && (
                  <a href={`tel:${aircraft.mx_contact_phone}`} className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-brandOrange hover:text-orange-600 bg-orange-50 border border-orange-200 px-2 py-1 rounded transition-colors active:scale-95">
                    <Phone size={12} /> Call
                  </a>
                )}
                {aircraft.mx_contact_email && (
                  <a href={`mailto:${aircraft.mx_contact_email}`} className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-navy hover:text-blue-800 bg-blue-50 border border-blue-200 px-2 py-1 rounded transition-colors active:scale-95">
                    <Mail size={12} /> Email
                  </a>
                )}
              </div>
            </div>
          </div>

        </div>

        <div className="p-6 grid grid-cols-2 gap-6 bg-cream">
          <TicketField label={isTurbine ? "Total Airframe" : "Current Hobbs"} value={`${isTurbine ? (aircraft.total_airframe_time || 0) : (aircraft.total_airframe_time || '-')} hrs`} emphasis />
          <TicketField label={isTurbine ? "Total Engine" : "Current Tach"} value={`${aircraft.total_engine_time || 0} hrs`} emphasis />
        </div>
      </div>

      {/* QUICK GLANCE DASHBOARD */}
      {!isLoading && (
        <div className="grid grid-cols-1 gap-3">
          
          {nextMx ? (
            <div className="bg-white border border-gray-200 shadow-sm rounded-sm p-4 flex gap-4 items-center">
              <div className="bg-orange-50 p-3 rounded-full text-[#F08B46] shrink-0"><Wrench size={20}/></div>
              <div className="flex-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Next Mx Due</span>
                <p className="text-sm font-bold text-navy leading-tight">{nextMx.item_name}</p>
                <p className={`text-xs font-bold mt-0.5 ${nextMx.isExpired ? 'text-[#CE3732]' : 'text-[#F08B46]'}`}>{nextMx.dueText}</p>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 shadow-sm rounded-sm p-4 flex gap-4 items-center opacity-70">
              <div className="bg-gray-100 p-3 rounded-full text-gray-400 shrink-0"><Wrench size={20}/></div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Next Mx Due</span>
                <p className="text-sm font-bold text-gray-500 leading-tight">No Maintenance Tracked</p>
              </div>
            </div>
          )}

          {activeSquawks.length > 0 ? (
            <div className="bg-white border border-red-200 shadow-sm rounded-sm p-4 flex gap-4 items-center">
              <div className="bg-red-50 p-3 rounded-full text-[#CE3732] shrink-0"><AlertTriangle size={20}/></div>
              <div className="flex-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Active Squawks</span>
                <p className="text-sm font-bold text-navy leading-tight">{activeSquawks.length} Open Issue{activeSquawks.length > 1 ? 's' : ''}</p>
                {activeSquawks.some(sq => sq.affects_airworthiness) && (
                  <p className="text-xs font-bold text-[#CE3732] mt-0.5">Aircraft Grounded</p>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 shadow-sm rounded-sm p-4 flex gap-4 items-center opacity-70">
              <div className="bg-gray-100 p-3 rounded-full text-gray-400 shrink-0"><AlertTriangle size={20}/></div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Active Squawks</span>
                <p className="text-sm font-bold text-gray-500 leading-tight">No Active Squawks</p>
              </div>
            </div>
          )}

          {latestNote ? (
            <div className="bg-white border border-gray-200 shadow-sm rounded-sm p-4 flex gap-4 items-center">
              <div className="bg-blue-50 p-3 rounded-full text-navy shrink-0"><FileText size={20}/></div>
              <div className="flex-1">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Latest Note</span>
                  <span className="text-[10px] text-gray-400 font-bold">{new Date(latestNote.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-sm font-bold text-navy leading-tight line-clamp-2">{latestNote.content}</p>
              </div>
            </div>
          ) : null}

        </div>
      )}

      {/* FUEL STATE CARD */}
      <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-[#F5B05B] flex flex-col mb-6">
        <div className="flex justify-between items-start mb-4 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-2">
            <Droplet size={24} className="text-[#F5B05B]" />
            <h3 className="font-oswald text-2xl font-bold uppercase text-navy m-0 leading-none">Current Fuel</h3>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest bg-gray-100 px-2 py-1 rounded text-gray-600">
            {isTurbine ? 'Jet-A (6.7 lbs/gal)' : 'AvGas (6.0 lbs/gal)'}
          </span>
        </div>
        
        <div className="grid grid-cols-2 gap-6">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">Volume</span>
            <p className="text-4xl font-roboto font-bold text-navy">
              {fuelGals.toFixed(1)} <span className="text-lg text-gray-400">Gal</span>
            </p>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">Weight</span>
            <p className="text-4xl font-roboto font-bold text-navy">
              {fuelLbs.toLocaleString()} <span className="text-lg text-gray-400">Lbs</span>
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}