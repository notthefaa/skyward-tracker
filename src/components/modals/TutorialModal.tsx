import { useState, useEffect } from "react";
import { 
  PlaneTakeoff, LayoutGrid, Clock, Wrench, AlertTriangle, Send, ShieldCheck, 
  ChevronRight, X, Calendar, Check
} from "lucide-react";

export default function TutorialModal({ session, role }: { session: any, role: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (session?.user?.id) {
      const hasSeen = localStorage.getItem(`aft_tutorial_v4_${session.user.id}`);
      if (!hasSeen) {
        setIsVisible(true);
      }
    }
  }, [session]);

  const dismissTutorial = () => {
    if (session?.user?.id) {
      localStorage.setItem(`aft_tutorial_v4_${session.user.id}`, 'true');
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

  const Bullet = ({ children }: { children: React.ReactNode }) => (
    <li className="flex items-start gap-2.5">
      <Check size={16} className="text-[#F5B05B] shrink-0 mt-0.5" />
      <span>{children}</span>
    </li>
  );

  const tutorialSteps = [
    {
      title: "Welcome to Skyward",
      icon: <PlaneTakeoff size={48} className="text-navy" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            {role === 'admin' 
              ? "Your entire fleet, in one place. The Skyward Aircraft Manager keeps your aircraft organized — from flight logs and maintenance tracking to mechanic coordination and squawk reporting."
              : "Your aircraft, simplified. The Skyward Aircraft Manager makes it easy to log flights, stay on top of maintenance, and keep your team in sync."}
          </p>
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            Let's take a quick look around.
          </p>
        </div>
      )
    },
    {
      title: "Your Fleet at a Glance",
      icon: <LayoutGrid size={48} className="text-[#3AB0FF]" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            The Fleet dashboard shows every aircraft and its current status at a glance. Tap any aircraft to dive into its details.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet><strong className="text-success">Green</strong> means airworthy and ready to fly.</Bullet>
            <Bullet><strong className="text-[#F08B46]">Orange</strong> means open squawks worth monitoring.</Bullet>
            <Bullet><strong className="text-[#CE3732]">Red</strong> means grounded — expired MX or an AOG squawk.</Bullet>
          </ul>
        </div>
      )
    },
    {
      title: "Flight Logging",
      icon: <Clock size={48} className="text-[#3AB0FF]" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            Log flights in seconds. The system automatically adapts to your engine type so you always see the right fields.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet>Hobbs & Tach for piston, AFTT & FTT for turbine — plus fuel state, routing, and passengers.</Bullet>
            <Bullet>Built-in validation prevents backward entries so your logbook stays clean.</Bullet>
            <Bullet>Export your full flight history as a CSV anytime.</Bullet>
          </ul>
        </div>
      )
    },
    {
      title: "Maintenance That Thinks Ahead",
      icon: <Wrench size={48} className="text-[#F08B46]" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            Track maintenance by hours or calendar dates. The system learns from your flying patterns and projects when items will come due — so you're never caught off guard.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet>Predictive engine uses your flight history to estimate days until service is needed.</Bullet>
            {role === 'admin' 
              ? <Bullet>Enable automated scheduling and the system drafts work packages as items approach their thresholds.</Bullet>
              : <Bullet>Required items that expire will automatically ground the aircraft until completed.</Bullet>
            }
            <Bullet>Tap the <strong>Guide</strong> button on the Maintenance tab for a full walkthrough anytime.</Bullet>
          </ul>
        </div>
      )
    },
    {
      title: "Mechanic Coordination",
      icon: <Calendar size={48} className="text-[#F08B46]" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            No more phone tag. Bundle everything your mechanic needs into one work package and send it in a single professional email.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet>Combine MX items, squawks, and add-on services (wash, oil change, nav update, etc.).</Bullet>
            <Bullet>Your mechanic gets a secure portal to propose dates, track progress, and message you directly.</Bullet>
            <Bullet>When service is done, enter the logbook data and all tracking resets automatically.</Bullet>
          </ul>
        </div>
      )
    },
    {
      title: "Squawk Reporting",
      icon: <AlertTriangle size={48} className="text-[#CE3732]" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            Report discrepancies with photos right from the ramp. Your team and mechanic stay informed automatically.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet>Flag anything that affects airworthiness to ground the aircraft instantly across the fleet.</Bullet>
            <Bullet>Include squawks in service events — they auto-resolve when your mechanic completes the work.</Bullet>
            {role === 'admin' && <Bullet>Defer items with full MEL/CDL documentation, digital signatures, and exportable PDF reports.</Bullet>}
          </ul>
        </div>
      )
    },
    ...(role === 'admin' ? [{
      title: "Admin Tools",
      icon: <ShieldCheck size={48} className="text-navy" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            Tap the Shield icon in the top bar to access everything you need to manage the operation.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet>Invite pilots, reset passwords, and assign aircraft access per user.</Bullet>
            <Bullet>Configure global maintenance alert and scheduling thresholds.</Bullet>
            <Bullet>Run database health checks to clean orphaned files and monitor growth.</Bullet>
          </ul>
        </div>
      )
    }] : []),
    {
      title: "Take It With You",
      icon: <Send size={48} className="text-[#3AB0FF]" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            Need to log a flight or report a squawk from the ramp? Tap the Paper Airplane icon in the top menu to install <strong>Log It</strong> — a lightweight companion app built for speed on your phone.
          </p>
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            That's it — you're all set. Happy flying!
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

        <div className="w-full min-h-[180px] flex items-center justify-center mb-6">
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
