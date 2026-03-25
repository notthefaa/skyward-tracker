import { useState, useEffect } from "react";
import { 
  PlaneTakeoff, LayoutGrid, Home, Clock, Wrench, 
  AlertTriangle, FileText, Send, ShieldCheck, 
  ChevronRight, ChevronLeft, CheckCircle, X 
} from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

export default function TutorialModal({ session, role }: { session: any, role: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const[step, setStep] = useState(0);

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
      content: role === 'admin' 
        ? "Welcome to the Skyward Aircraft Manager. As an Administrator, you have full control over fleet configuration, pilot access, maintenance schedules, and database health. Let's take a quick tour of your tools."
        : "Welcome to the Skyward Fleet Tracker. This platform is designed to make logging flights, tracking maintenance, and reporting squawks seamless. Let's take a quick tour of your features."
    },
    {
      title: "Fleet Dashboard",
      icon: <LayoutGrid size={48} className="text-[#3AB0FF]" />,
      content: "The Fleet tab gives you a bird's-eye view of all aircraft assigned to you. The system automatically color-codes aircraft: Green (Airworthy), Orange (Open Issues), or pulsing Red (Grounded due to an AOG squawk or expired maintenance)."
    },
    {
      title: "Aircraft Summary",
      icon: <Home size={48} className="text-navy" />,
      content: "Selecting an aircraft takes you to its Summary Command Center. Here you can view vital statistics, current fuel states, and 1-tap contact buttons for the Primary and Maintenance contacts for that specific tail."
    },
    {
      title: "Flight Times",
      icon: <Clock size={48} className="text-[#3AB0FF]" />,
      content: role === 'admin'
        ? "Flight logs dynamically adapt to Piston or Turbine engines. The system validates all math to prevent backwards logging. As an Admin, you also have the unique ability to delete the most recent log, which will automatically roll the aircraft's master times back to the previous entry."
        : "Flight logs dynamically adapt to Piston or Turbine engines. The system validates your entries to ensure math is always perfectly accurate. You can also view historical flights and export them to a CSV file."
    },
    {
      title: "Maintenance Tracking",
      icon: <Wrench size={48} className="text-[#F08B46]" />,
      content: role === 'admin'
        ? "You can track items by Hours or Calendar Dates. You can configure global alert triggers in the Admin Center. If you check 'Automate MX Communication' on an item, the system will automatically email the mechanic requesting scheduling when the item nears expiration."
        : "View upcoming inspections and part replacements. Items will turn Orange when they are coming due soon, and Red if they have expired. Required items that expire will automatically ground the aircraft across the entire platform."
    },
    {
      title: "Squawks & Discrepancies",
      icon: <AlertTriangle size={48} className="text-[#CE3732]" />,
      content: role === 'admin'
        ? "When a pilot logs a squawk, you can resolve it, delete it, or legally defer it using the built-in digital signature pad. You can also export formal multi-page PDF reports with embedded photos, or email a secure web-link directly to your mechanic."
        : "Report issues directly from the ramp and attach photos from your phone. You can flag an issue as a standard 'Monitor' item, or flag it as 'Affects Airworthiness' to instantly ground the aircraft and warn other pilots."
    },
    {
      title: "Pilot Notes",
      icon: <FileText size={48} className="text-[#525659]" />,
      content: "Leave general chatter or passdown information for the next pilot. The system uses perpetual read-receipts, so any unread notes will trigger a red notification badge on your bottom navigation bar until you view them."
    },
    ...(role === 'admin' ?[{
      title: "The Admin Center",
      icon: <ShieldCheck size={48} className="text-navy" />,
      content: "Click the Shield icon in the top right to access the Admin Center. From here you can search the Global Fleet, invite new pilots, explicitly grant/revoke aircraft access, reset passwords, and run database health cleanup tools."
    }] :[]),
    {
      title: "The Companion App",
      icon: <Send size={48} className="text-[#3AB0FF]" />,
      content: "We also offer a hyper-fast, mobile-only app called 'Log It' designed exclusively for use on the ramp. Click the Paper Airplane icon in the top right menu to get instructions on how to install it directly to your phone's home screen."
    },
    {
      title: "Ready for Takeoff",
      icon: <CheckCircle size={48} className="text-success" />,
      content: "You are all set! You can access all of these tools from the navigation bar at the bottom of your screen. Fly safe!"
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

        <p className="text-sm text-gray-600 font-roboto mb-8 leading-relaxed min-h-[100px] flex items-center">
          {currentStepData.content}
        </p>

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
          
          <div className="flex-[2]">
            {step === tutorialSteps.length - 1 ? (
              <PrimaryButton onClick={dismissTutorial}>Get Started</PrimaryButton>
            ) : (
              <PrimaryButton onClick={nextStep}>Next <ChevronRight size={18} /></PrimaryButton>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}