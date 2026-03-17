import { PlaneTakeoff, MapPin, User, Droplet, Clock } from "lucide-react";
import TicketField from "@/components/TicketField";

export default function SummaryTab({ aircraft }: { aircraft: any }) {
  if (!aircraft) return null;

  const isTurbine = aircraft.engine_type === 'Turbine';
  const weightPerGal = isTurbine ? 6.7 : 6.0;
  const fuelGals = aircraft.current_fuel_gallons || 0;
  const fuelLbs = Math.round(fuelGals * weightPerGal);

  return (
    <div className="flex flex-col gap-6">
      
      {/* HEADER CARD: Avatar & Details */}
      <div className="bg-cream shadow-lg rounded-sm overflow-hidden border-t-4 border-navy">
        
        {/* Avatar Image Wrapper */}
        <div className="relative h-56 bg-slateGray flex items-center justify-center">
          {aircraft.avatar_url ? (
            <img src={aircraft.avatar_url} alt="Aircraft Avatar" className="w-full h-full object-cover" />
          ) : (
            <PlaneTakeoff size={64} className="text-white/20" />
          )}
          
          {/* Dark Gradient Overlay for Text Readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col justify-end p-6">
            <h2 className="font-oswald text-4xl md:text-5xl font-bold text-white uppercase leading-none mb-1">
              {aircraft.tail_number}
            </h2>
            <p className="text-sm text-gray-200 font-bold uppercase tracking-widest">
              {aircraft.aircraft_type} • SN: {aircraft.serial_number || 'N/A'}
            </p>
          </div>
        </div>

        {/* Airport & Contact Strip */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-navy">
            <MapPin size={18} className="text-brandOrange" />
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">Home Base</span>
              <span className="font-roboto font-bold text-sm">{aircraft.home_airport || 'Not Assigned'}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-navy">
            <User size={18} className="text-brandOrange" />
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400">Main Contact</span>
              <span className="font-roboto font-bold text-sm">{aircraft.main_contact || 'Not Assigned'}</span>
            </div>
          </div>
        </div>

        {/* Times Grid */}
        <div className="p-6 grid grid-cols-2 gap-6 bg-cream">
          <TicketField label={isTurbine ? "Total Airframe" : "Current Hobbs"} value={`${isTurbine ? (aircraft.total_airframe_time || 0) : (aircraft.total_airframe_time || '-')} hrs`} emphasis />
          <TicketField label={isTurbine ? "Total Engine" : "Current Tach"} value={`${aircraft.total_engine_time || 0} hrs`} emphasis />
        </div>

      </div>

      {/* FUEL STATE CARD */}
      <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-[#F5B05B] flex flex-col">
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