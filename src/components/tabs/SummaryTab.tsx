import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PlaneTakeoff, MapPin, Droplet, Phone, Mail, Wrench, AlertTriangle, FileText, Clock, X } from "lucide-react";

export default function SummaryTab({ 
  aircraft, 
  setActiveTab 
}: { 
  aircraft: any, 
  setActiveTab: (tab: 'summary' | 'times' | 'mx' | 'squawks' | 'notes') => void 
}) {
  const [nextMx, setNextMx] = useState<any>(null);
  const[activeSquawks, setActiveSquawks] = useState<any[]>([]);
  const [latestNote, setLatestNote] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showNoteModal, setShowNoteModal] = useState(false);

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

  const isGrounded = nextMx?.isExpired || activeSquawks.some(sq => sq.affects_airworthiness);
  const hasIssues = activeSquawks.length > 0;
  const statusBorderColor = isGrounded ? 'border-[#CE3732]' : hasIssues ? 'border-[#F08B46]' : 'border-success';
  const statusIconColor = isGrounded ? 'text-[#CE3732]' : hasIssues ? 'text-[#F08B46]' : 'text-success';

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      
      {/* 1. HEADER CARD: Avatar & Details */}
      <div className="bg-white shadow-lg rounded-sm overflow-hidden">
        
        <div className="relative h-40 md:h-56 bg-slateGray flex items-center justify-center">
          {aircraft.avatar_url ? (
            <img src={aircraft.avatar_url} alt="Aircraft Avatar" className="w-full h-full object-cover" />
          ) : (
            <PlaneTakeoff size={64} className="text-white/20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col justify-end p-4 md:p-6">
            <h2 className="font-oswald text-4xl md:text-5xl font-bold text-white uppercase leading-none mb-1">
              {aircraft.tail_number}
            </h2>
            <p className="text-xs md:text-sm text-gray-200 font-bold uppercase tracking-widest">
              {aircraft.aircraft_type} • SN: {aircraft.serial_number || 'N/A'}
            </p>
          </div>
        </div>

        {/* COMPACT CONTACT GRID */}
        <div className="bg-cream px-4 py-3 flex flex-col gap-3">
          
          <div className="flex items-center justify-between border-b border-gray-200 pb-3">
            <div className="flex items-center gap-3 text-navy">
              <MapPin size={18} className="text-brandOrange shrink-0" />
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">Home Base</span>
                <span className="font-roboto font-bold text-sm uppercase">{aircraft.home_airport || 'NOT ASSIGNED'}</span>
              </div>
            </div>
            {aircraft.home_airport && (
              <a href={`https://www.airnav.com/airport/${aircraft.home_airport}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-brandOrange hover:text-orange-600 bg-orange-50 border border-orange-200 px-3 py-1.5 rounded transition-colors active:scale-95">
                AirNav
              </a>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col text-navy overflow-hidden">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">Main Contact</span>
              <span className="font-roboto font-bold text-xs block mb-1 truncate">{aircraft.main_contact || 'None'}</span>
              <div className="flex gap-2 mt-1">
                {aircraft.main_contact_phone && (
                  <a href={`tel:${aircraft.main_contact_phone}`} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-brandOrange hover:text-orange-600 bg-orange-50 border border-orange-200 px-2 py-1 rounded transition-colors active:scale-95">
                    <Phone size={12} /> Call
                  </a>
                )}
                {aircraft.main_contact_email && (
                  <a href={`mailto:${aircraft.main_contact_email}`} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy hover:text-blue-800 bg-blue-50 border border-blue-200 px-2 py-1 rounded transition-colors active:scale-95">
                    <Mail size={12} /> Email
                  </a>
                )}
              </div>
            </div>

            <div className="flex flex-col text-navy overflow-hidden border-l border-gray-200 pl-4">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">MX Contact</span>
              <span className="font-roboto font-bold text-xs block mb-1 truncate">{aircraft.mx_contact || 'None'}</span>
              <div className="flex gap-2 mt-1">
                {aircraft.mx_contact_phone && (
                  <a href={`tel:${aircraft.mx_contact_phone}`} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-brandOrange hover:text-orange-600 bg-orange-50 border border-orange-200 px-2 py-1 rounded transition-colors active:scale-95">
                    <Phone size={12} /> Call
                  </a>
                )}
                {aircraft.mx_contact_email && (
                  <a href={`mailto:${aircraft.mx_contact_email}`} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy hover:text-blue-800 bg-blue-50 border border-blue-200 px-2 py-1 rounded transition-colors active:scale-95">
                    <Mail size={12} /> Email
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. FLIGHT TIMES CARD */}
      <div className={`bg-white shadow-lg rounded-sm p-4 border-t-4 ${statusBorderColor} flex flex-col`}>
        <div className="flex justify-between items-center mb-3 border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <Clock size={20} className={statusIconColor} />
            <h3 className="font-oswald text-xl font-bold uppercase text-navy m-0 leading-none">Flight Times</h3>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest bg-gray-100 px-2 py-1 rounded text-gray-600">
            {isTurbine ? 'TURBINE' : 'PISTON'}
          </span>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">
              {isTurbine ? "Total Airframe" : "Current Hobbs"}
            </span>
            <p className="text-3xl font-roboto font-bold text-navy">
              {isTurbine ? (aircraft.total_airframe_time?.toFixed(1) || 0) : (aircraft.total_airframe_time?.toFixed(1) || '-')} <span className="text-sm text-gray-400">hrs</span>
            </p>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">
              {isTurbine ? "Total Engine" : "Current Tach"}
            </span>
            <p className="text-3xl font-roboto font-bold text-navy">
              {aircraft.total_engine_time?.toFixed(1) || 0} <span className="text-sm text-gray-400">hrs</span>
            </p>
          </div>
        </div>
      </div>

      {/* 3. FUEL STATE CARD (Updated Timestamp Location) */}
      <div className="bg-white shadow-lg rounded-sm p-4 border-t-4 border-blue-500 flex flex-col">
        <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Droplet size={20} className="text-blue-500" />
              <h3 className="font-oswald text-xl font-bold uppercase text-navy m-0 leading-none">Current Fuel</h3>
            </div>
            {/* Timestamp moved securely under the title! */}
            {aircraft.fuel_last_updated && (
              <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-1">
                Updated: {new Date(aircraft.fuel_last_updated).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-widest bg-gray-100 px-2 py-1 rounded text-gray-600 block">
              {isTurbine ? 'Jet-A (6.7 lbs/gal)' : 'AvGas (6.0 lbs/gal)'}
            </span>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">Quantity</span>
            <p className="text-3xl font-roboto font-bold text-navy">
              {fuelGals.toFixed(1)} <span className="text-sm text-gray-400">Gal</span>
            </p>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">Weight</span>
            <p className="text-3xl font-roboto font-bold text-navy">
              {fuelLbs.toLocaleString()} <span className="text-sm text-gray-400">Lbs</span>
            </p>
          </div>
        </div>
      </div>

      {/* 4. QUICK GLANCE DASHBOARD */}
      {!isLoading && (
        <div className="grid grid-cols-1 gap-3 mb-6">
          
          <div 
            onClick={() => setActiveTab('mx')}
            className={`bg-white border shadow-sm rounded-sm p-4 flex gap-4 items-center transition-colors cursor-pointer active:scale-[0.98] ${nextMx ? 'border-gray-200 hover:bg-orange-50' : 'border-gray-200 opacity-70 hover:bg-gray-50'}`}
          >
            <div className={`p-3 rounded-full shrink-0 ${nextMx ? 'bg-orange-50 text-[#F08B46]' : 'bg-gray-100 text-gray-400'}`}>
              <Wrench size={20}/>
            </div>
            <div className="flex-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Next Mx Due</span>
              {nextMx ? (
                <>
                  <p className="text-sm font-bold text-navy leading-tight">{nextMx.item_name}</p>
                  <p className={`text-xs font-bold mt-0.5 ${nextMx.isExpired ? 'text-[#CE3732]' : 'text-[#F08B46]'}`}>{nextMx.dueText}</p>
                </>
              ) : (
                <p className="text-sm font-bold text-gray-500 leading-tight">No Maintenance Tracked</p>
              )}
            </div>
          </div>

          <div 
            onClick={() => setActiveTab('squawks')}
            className={`bg-white border shadow-sm rounded-sm p-4 flex gap-4 items-center transition-colors cursor-pointer active:scale-[0.98] ${activeSquawks.length > 0 ? 'border-red-200 hover:bg-red-50' : 'border-gray-200 opacity-70 hover:bg-gray-50'}`}
          >
            <div className={`p-3 rounded-full shrink-0 ${activeSquawks.length > 0 ? 'bg-red-50 text-[#CE3732]' : 'bg-gray-100 text-gray-400'}`}>
              <AlertTriangle size={20}/>
            </div>
            <div className="flex-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Active Squawks</span>
              {activeSquawks.length > 0 ? (
                <>
                  <p className="text-sm font-bold text-navy leading-tight">{activeSquawks.length} Open Issue{activeSquawks.length > 1 ? 's' : ''}</p>
                  {activeSquawks.some(sq => sq.affects_airworthiness) && <p className="text-xs font-bold text-[#CE3732] mt-0.5">Aircraft Grounded</p>}
                </>
              ) : (
                <p className="text-sm font-bold text-gray-500 leading-tight">No Active Squawks</p>
              )}
            </div>
          </div>

          {latestNote && (
            <>
              <div 
                onClick={() => setShowNoteModal(true)}
                className="bg-white border border-gray-200 shadow-sm rounded-sm p-4 flex gap-4 items-center cursor-pointer hover:bg-blue-50 transition-colors active:scale-[0.98]"
              >
                <div className="bg-blue-50 p-3 rounded-full text-navy shrink-0"><FileText size={20}/></div>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Latest Note</span>
                    <span className="text-[10px] text-gray-400 font-bold">{new Date(latestNote.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}</span>
                  </div>
                  <p className="text-sm font-bold text-navy leading-tight line-clamp-2">{latestNote.content}</p>
                </div>
              </div>

              {showNoteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-fade-in" onClick={() => setShowNoteModal(false)}>
                  <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-navy animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setShowNoteModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500">
                      <X size={20}/>
                    </button>
                    <div className="mb-4">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-navy block">{latestNote.author_email || 'Pilot'}</span>
                      <span className="text-[10px] uppercase text-gray-400 font-bold">{new Date(latestNote.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-navy font-roboto whitespace-pre-wrap leading-relaxed">{latestNote.content}</p>
                  </div>
                </div>
              )}
            </>
          )}

        </div>
      )}
    </div>
  );
}