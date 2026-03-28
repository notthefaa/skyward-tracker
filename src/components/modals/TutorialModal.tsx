import { useState, useEffect } from "react";
import { 
  PlaneTakeoff, LayoutGrid, Clock, Wrench, AlertTriangle, Send, ShieldCheck, 
  ChevronRight, CheckCircle, X, Check, Activity, Bell, PenTool, Share, Download, 
  Settings, Users, Database, RefreshCw, Camera, Calendar, MessageSquare, 
  ExternalLink, Sparkles, Plane, XCircle, TrendingUp
} from "lucide-react";

export default function TutorialModal({ session, role }: { session: any, role: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (session?.user?.id) {
      const hasSeen = localStorage.getItem(`aft_tutorial_v2_${session.user.id}`);
      if (!hasSeen) {
        setIsVisible(true);
      }
    }
  }, [session]);

  const dismissTutorial = () => {
    if (session?.user?.id) {
      localStorage.setItem(`aft_tutorial_v2_${session.user.id}`, 'true');
    }
    setIsVisible(false);
  };

  const nextStep = () => {
    if (step < tutorialSteps.length - 1) setStep(step + 1);
    else dismissTutorial();
  };

  const prevStep = () => {
    if (step > 0) setStep(step - 1);
  };

  if (!isVisible) return null;

  const tutorialSteps = [
    {
      title: "Welcome to Skyward",
      icon: <PlaneTakeoff size={48} className="text-navy" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            {role === 'admin' 
              ? "Welcome to the Skyward Aircraft Manager. As an Administrator, you have full control over fleet configuration, pilot access, maintenance scheduling, mechanic coordination, and database health."
              : "Welcome to the Skyward Fleet Manager. This platform is designed to make logging flights, tracking maintenance, coordinating with your mechanic, and reporting squawks seamless."}
          </p>
        </div>
      )
    },
    {
      title: "Fleet Dashboard",
      icon: <LayoutGrid size={48} className="text-[#3AB0FF]" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center mb-4">
            The Fleet tab gives you a bird's-eye view of all aircraft. Tap any aircraft to jump to its summary. Status is color-coded automatically:
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-3 pl-2">
            <li className="flex items-center gap-3"><CheckCircle size={20} className="text-success shrink-0" /> <strong>Green:</strong> Airworthy & Ready</li>
            <li className="flex items-center gap-3"><Activity size={20} className="text-[#F08B46] shrink-0" /> <strong>Orange:</strong> Open Monitor Issues</li>
            <li className="flex items-center gap-3"><AlertTriangle size={20} className="text-[#CE3732] shrink-0" /> <strong>Red:</strong> Grounded (AOG or Expired MX)</li>
          </ul>
        </div>
      )
    },
    {
      title: "Flight Times",
      icon: <Clock size={48} className="text-[#3AB0FF]" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <ul className="text-sm text-gray-600 font-roboto space-y-4 pl-2">
            <li className="flex items-start gap-3"><Check size={18} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span>Tracks adapt to your engine type — Hobbs/Tach for Piston or AFTT/FTT for Turbine.</span></li>
            <li className="flex items-start gap-3"><Check size={18} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span>Log departure/arrival airports, fuel state, passengers, and trip reason codes.</span></li>
            <li className="flex items-start gap-3"><Check size={18} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span>Strict math validation prevents backward logging errors.</span></li>
            {role === 'admin' && (
              <li className="flex items-start gap-3"><RefreshCw size={18} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Rollbacks:</strong> Delete the newest log to automatically roll aircraft master times back to the previous entry.</span></li>
            )}
            <li className="flex items-start gap-3"><Download size={18} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span>Export the complete flight log as CSV.</span></li>
          </ul>
        </div>
      )
    },
    {
      title: "Maintenance Tracking",
      icon: <Wrench size={48} className="text-[#F08B46]" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <ul className="text-sm text-gray-600 font-roboto space-y-4 pl-2">
            <li className="flex items-start gap-3"><Clock size={18} className="text-[#F08B46] shrink-0 mt-0.5" /> <span>Track items by Engine Hours or Calendar Dates with automatic interval recalculation.</span></li>
            <li className="flex items-start gap-3"><TrendingUp size={18} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Predictive Engine:</strong> Uses 180 days of flight data to project when MX will come due, with a confidence score based on flying consistency.</span></li>
            {role === 'admin' && (
              <>
                <li className="flex items-start gap-3"><Bell size={18} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Automated Alerts:</strong> System emails pilots and admins at configurable thresholds (e.g., 30/15/5 days or hours remaining).</span></li>
                <li className="flex items-start gap-3"><Send size={18} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Auto-Scheduling:</strong> Enable "Automate MX" to have the system create draft work packages when items approach their due thresholds.</span></li>
              </>
            )}
            <li className="flex items-start gap-3"><AlertTriangle size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span>Required items that expire will automatically ground the aircraft until completed.</span></li>
          </ul>
        </div>
      )
    },
    {
      title: "Service Events",
      icon: <Calendar size={48} className="text-[#F08B46]" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center mb-4">
            Coordinate maintenance with your mechanic through a complete work package workflow:
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-3 pl-2">
            <li className="flex items-start gap-3"><Sparkles size={18} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Build a Work Package:</strong> Bundle MX items, open squawks, and add-on services (wash, oil change, nav update, etc.) into one package.</span></li>
            <li className="flex items-start gap-3"><Send size={18} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Send to Mechanic:</strong> Preview the email, propose a date, then send. Your mechanic gets a professional email with a secure portal link.</span></li>
            <li className="flex items-start gap-3"><MessageSquare size={18} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Negotiate Dates:</strong> Propose, confirm, or counter dates back and forth until both sides agree. All messages are logged.</span></li>
            <li className="flex items-start gap-3"><Plane size={18} className="text-success shrink-0 mt-0.5" /> <span><strong>Track to Completion:</strong> Monitor line item progress, receive "Aircraft Ready" notifications, then enter logbook data to reset tracking.</span></li>
            <li className="flex items-start gap-3"><XCircle size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>Cancel or Decline:</strong> Either side can cancel or decline with a reason. The other party is notified by email.</span></li>
          </ul>
        </div>
      )
    },
    {
      title: "Mechanic Portal",
      icon: <ExternalLink size={48} className="text-[#091F3C]" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center mb-4">
            Your mechanic accesses a secure portal via a link in their email — no login required.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-3 pl-2">
            <li className="flex items-start gap-3"><Check size={18} className="text-navy shrink-0 mt-0.5" /> <span>View the full work package with aircraft details and current times.</span></li>
            <li className="flex items-start gap-3"><Check size={18} className="text-navy shrink-0 mt-0.5" /> <span>View squawk photos in full resolution directly in the portal.</span></li>
            <li className="flex items-start gap-3"><Check size={18} className="text-navy shrink-0 mt-0.5" /> <span>Propose or confirm service dates with shop availability notes.</span></li>
            <li className="flex items-start gap-3"><Check size={18} className="text-navy shrink-0 mt-0.5" /> <span>Update line item statuses (pending → in progress → complete → deferred).</span></li>
            <li className="flex items-start gap-3"><Check size={18} className="text-navy shrink-0 mt-0.5" /> <span>Suggest additional work discovered during service.</span></li>
            <li className="flex items-start gap-3"><Check size={18} className="text-navy shrink-0 mt-0.5" /> <span>Mark the aircraft ready for pickup when all work is done.</span></li>
          </ul>
        </div>
      )
    },
    {
      title: "Squawks",
      icon: <AlertTriangle size={48} className="text-[#CE3732]" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <ul className="text-sm text-gray-600 font-roboto space-y-4 pl-2">
            <li className="flex items-start gap-3"><Camera size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span>Report discrepancies with photos, location, and a detailed description.</span></li>
            <li className="flex items-start gap-3"><AlertTriangle size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span>Flag as "Affects Airworthiness" to instantly ground the aircraft fleet-wide.</span></li>
            <li className="flex items-start gap-3"><Calendar size={18} className="text-[#F08B46] shrink-0 mt-0.5" /> <span>Include squawks in service event work packages — they auto-resolve when the mechanic marks them complete.</span></li>
            {role === 'admin' && (
              <>
                <li className="flex items-start gap-3"><PenTool size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>Deferrals:</strong> Document MEL/CDL/NEF/MDL deferrals with digital signature capture (turbine aircraft).</span></li>
                <li className="flex items-start gap-3"><Share size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>Secure Viewer:</strong> Email your mechanic a direct link to view squawk details and high-res photos.</span></li>
                <li className="flex items-start gap-3"><Download size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>PDF Export:</strong> Generate formal squawk reports with photos for maintenance visits.</span></li>
              </>
            )}
          </ul>
        </div>
      )
    },
    ...(role === 'admin' ? [{
      title: "Admin Center",
      icon: <ShieldCheck size={48} className="text-navy" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <p className="text-sm text-gray-600 font-roboto text-center mb-4">Tap the Shield icon in the top bar to access global settings.</p>
          <ul className="text-sm text-gray-600 font-roboto space-y-4 pl-2">
            <li className="flex items-center gap-3"><Users size={18} className="text-navy shrink-0" /> Invite pilots, reset passwords, and delete users.</li>
            <li className="flex items-center gap-3"><PlaneTakeoff size={18} className="text-navy shrink-0" /> Assign aircraft access per user.</li>
            <li className="flex items-center gap-3"><Settings size={18} className="text-navy shrink-0" /> Configure global maintenance alert and scheduling thresholds.</li>
            <li className="flex items-center gap-3"><Database size={18} className="text-navy shrink-0" /> Run database health checks — cleans orphaned images, old records, and reports table sizes.</li>
          </ul>
        </div>
      )
    }] : []),
    {
      title: "Companion App",
      icon: <Send size={48} className="text-[#3AB0FF]" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            We also offer <strong>Log It</strong>, a hyper-fast mobile app designed exclusively for use on the ramp. Tap the Paper Airplane icon in the top menu to get installation instructions for your phone's home screen.
          </p>
        </div>
      )
    }
  ];

  const currentStepData = tutorialSteps[step];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 animate-fade-in">
      <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 md:p-8 border-t-8 border-navy animate-slide-up relative flex flex-col items-center text-center">
        
        <button onClick={dismissTutorial} className="absolute top-4 right-4 text-gray-400 hover:text-[#CE3732] transition-colors">
          <X size={24}/>
        </button>

        <div className="bg-gray-50 p-6 rounded-full border border-gray-200 mb-6 shadow-inner">
          {currentStepData.icon}
        </div>

        <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase tracking-widest text-navy mb-4">
          {currentStepData.title}
        </h2>

        <div className="w-full min-h-[240px] flex items-center justify-center mb-6">
          {currentStepData.content}
        </div>

        {/* Dots Indicator */}
        <div className="flex gap-2 mb-8">
          {tutorialSteps.map((_, i) => (
            <div key={i} className={`h-2 rounded-full transition-all ${i === step ? 'w-6 bg-navy' : 'w-2 bg-gray-300'}`} />
          ))}
        </div>

        <div className="flex w-full gap-4">
          {step > 0 && (
            <button 
              onClick={prevStep} 
              className="flex-1 border-2 border-gray-200 text-gray-600 font-oswald text-lg font-bold uppercase tracking-widest py-3 rounded hover:bg-gray-50 active:scale-95 transition-all"
            >
              Back
            </button>
          )}
          
          <button 
            onClick={step === tutorialSteps.length - 1 ? dismissTutorial : nextStep}
            className="flex-[2] bg-navy border-2 border-navy text-white font-oswald text-lg font-bold uppercase tracking-widest py-3 rounded hover:bg-opacity-90 active:scale-95 transition-all flex justify-center items-center gap-2 shadow-md"
          >
            {step === tutorialSteps.length - 1 ? "Get Started" : <>Next <ChevronRight size={20} /></>}
          </button>
        </div>

      </div>
    </div>
  );
}
