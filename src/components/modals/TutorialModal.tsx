import { useState, useEffect } from "react";
import { 
  PlaneTakeoff, LayoutGrid, Clock, Wrench, AlertTriangle, Send, ShieldCheck, 
  ChevronRight, CheckCircle, X, Check, Activity, Bell, PenTool, Share, Download, Settings, Users, Database, RefreshCw, Camera
} from "lucide-react";

export default function TutorialModal({ session, role }: { session: any, role: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (session?.user?.id) {
      const hasSeen = localStorage.getItem(`aft_tutorial_${session.user.id}`);
      if (!hasSeen) {
        setIsVisible(true);
      }
    }
  }, [session]);

  const dismissTutorial = () => {
    if (session?.user?.id) {
      localStorage.setItem(`aft_tutorial_${session.user.id}`, 'true');
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

  // Dynamic Content Generation based on Role
  const tutorialSteps =[
    {
      title: "Welcome to Skyward",
      icon: <PlaneTakeoff size={48} className="text-navy" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            {role === 'admin' 
              ? "Welcome to the Skyward Aircraft Manager. As an Administrator, you have full control over fleet configuration, pilot access, maintenance schedules, and database health. You will also have the ability to log flights, track maintenance, and report squawks."
              : "Welcome to the Skyward Fleet Manager. This platform is designed to make logging flights, tracking maintenance, and reporting squawks seamless."}
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
            The Fleet tab gives you a bird's-eye view of all of your aircraft. Clicking an aircraft on this page takes you directly to that aircraft's summary. The system automatically color-codes statuses:
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
            <li className="flex items-start gap-3"><Check size={18} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span>The flight time tracking dynamically adapts to Piston (Tach) or Turbine (AFTT/Cycles) depending on aircraft setup.</span></li>
            <li className="flex items-start gap-3"><Check size={18} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span>Strict math validation prevents backward logging.</span></li>
            {role === 'admin' && (
              <li className="flex items-start gap-3"><RefreshCw size={18} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Rollbacks:</strong> Safely delete the newest log to automatically roll aircraft master times backward.</span></li>
            )}
            <li className="flex items-start gap-3"><Download size={18} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span>Export complete CSV logs instantly.</span></li>
          </ul>
        </div>
      )
    },
    {
      title: "Maintenance",
      icon: <Wrench size={48} className="text-[#F08B46]" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <ul className="text-sm text-gray-600 font-roboto space-y-4 pl-2">
            <li className="flex items-start gap-3"><Clock size={18} className="text-[#F08B46] shrink-0 mt-0.5" /> <span>Track items by Hours or Calendar Dates.</span></li>
            {role === 'admin' && (
              <>
                <li className="flex items-start gap-3"><Bell size={18} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Automated Alerts:</strong> System emails Admins/Pilots at global thresholds (e.g., 30/15/5 limits) when items are coming due.</span></li>
                <li className="flex items-start gap-3"><Send size={18} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Auto-Scheduling:</strong> Click 'Automate MX' to have the system automatically email your mechanic (with you in cc) requesting schedule time when a maintenace item is approaching.</span></li>
              </>
            )}
            {role !== 'admin' && (
              <li className="flex items-start gap-3"><AlertTriangle size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span>Required items that expire will automatically ground the aircraft.</span></li>
            )}
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
            <li className="flex items-start gap-3"><Camera size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span>Track squawks in detail with photos.</span></li>
            {role === 'admin' && (
              <>
                <li className="flex items-start gap-3"><PenTool size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>Document Deferrals:</strong> Process MEL/CDL deferrals when appropriate and keep everyone in the loop.</span></li>
                <li className="flex items-start gap-3"><Share size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>Mechanic Portal:</strong> Email a secure link directly to your mechanic to view squawks with high-res photos.</span></li>
                <li className="flex items-start gap-3"><Download size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>Export Summaries:</strong> Generate PDF reports outlining active squawks with photos to aid maintenance visits.</span></li>
              </>
            )}
            {role !== 'admin' && (
              <li className="flex items-start gap-3"><AlertTriangle size={18} className="text-[#CE3732] shrink-0 mt-0.5" /> <span>Flag an issue as 'Affects Airworthiness' to instantly ground the aircraft.</span></li>
            )}
          </ul>
        </div>
      )
    },
    ...(role === 'admin' ?[{
      title: "Admin Center",
      icon: <ShieldCheck size={48} className="text-navy" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <p className="text-sm text-gray-600 font-roboto text-center mb-4">Click the Shield icon (top right) to access global settings.</p>
          <ul className="text-sm text-gray-600 font-roboto space-y-4 pl-2">
            <li className="flex items-center gap-3"><Users size={18} className="text-navy shrink-0" /> Manage pilot invites & aircraft access</li>
            <li className="flex items-center gap-3"><Settings size={18} className="text-navy shrink-0" /> Configure Global Maintenance Alert Triggers</li>
            <li className="flex items-center gap-3"><Database size={18} className="text-navy shrink-0" /> Run Database Health & Photo Cleanup</li>
          </ul>
        </div>
      )
    }] :[]),
    {
      title: "Companion App",
      icon: <Send size={48} className="text-[#3AB0FF]" />,
      content: (
        <div className="space-y-4 text-left w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            We also offer a hyper-fast, mobile app called <strong>Log It</strong> designed exclusively for use on the ramp. Click the Paper Airplane icon in the top right menu to get instructions on how to install it directly to your phone's home screen.
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

        {/* Min-height ensures the buttons don't jump around wildly between slides */}
        <div className="w-full min-h-[240px] flex items-center justify-center mb-6">
          {currentStepData.content}
        </div>

        {/* Dots Indicator */}
        <div className="flex gap-2 mb-8">
          {tutorialSteps.map((_, i) => (
            <div key={i} className={`h-2 rounded-full transition-all ${i === step ? 'w-6 bg-navy' : 'w-2 bg-gray-300'}`} />
          ))}
        </div>

        {/* Perfectly Aligned Custom Buttons */}
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