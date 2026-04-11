import { useState, useEffect } from "react";
import { 
  PlaneTakeoff, LayoutGrid, Clock, Wrench, AlertTriangle, Send, ShieldCheck, 
  ChevronRight, X, Calendar, Check, FileText, Bell, UserPlus, Settings
} from "lucide-react";

export default function TutorialModal({ session, role }: { session: any, role: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (session?.user?.id) {
      const hasSeen = localStorage.getItem(`aft_tutorial_v5_${session.user.id}`);
      if (!hasSeen) {
        setIsVisible(true);
      }
    }
  }, [session]);

  const dismissTutorial = () => {
    if (session?.user?.id) {
      localStorage.setItem(`aft_tutorial_v5_${session.user.id}`, 'true');
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
              ? "Your entire fleet, in one place. The Skyward Aircraft Manager keeps your aircraft organized — from flight logs and maintenance tracking to mechanic coordination, shared scheduling, and squawk reporting."
              : "Your aircraft, simplified. The Skyward Aircraft Manager makes it easy to log flights, book the plane, stay on top of maintenance, and keep your team in sync."}
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
            Every aircraft and its current status, right where you need it. Tap any card to dive into the details.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet><strong className="text-success">Green</strong> means airworthy and ready to fly.</Bullet>
            <Bullet><strong className="text-[#F08B46]">Orange</strong> means open squawks worth monitoring.</Bullet>
            <Bullet><strong className="text-[#CE3732]">Red</strong> means grounded — expired MX or an AOG squawk.</Bullet>
            <Bullet>Flip to <strong>Fleet Schedule</strong> from the header to see every aircraft's bookings on one shared calendar.</Bullet>
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
      title: "Never Double-Book Again",
      icon: <Calendar size={48} className="text-[#56B94A]" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            One shared calendar, zero scheduling headaches. Book the plane, see who has it, and know at a glance how many days are open this month — all from the Calendar tab.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet>Reserve with a tap — add your times, purpose, and route of flight.</Bullet>
            <Bullet>Set it to repeat weekly, biweekly, or on a custom schedule that fits your training or travel rhythm.</Bullet>
            <Bullet>Overlapping bookings are blocked automatically. No conflicts, no surprises.</Bullet>
            <Bullet>Maintenance events block the calendar so nobody books during service.</Bullet>
            {role === 'admin' && <Bullet>Book on behalf of any pilot assigned to the aircraft when you need to hold time for them.</Bullet>}
            <Bullet>Your team gets notified whenever a reservation is created or cancelled.</Bullet>
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
            <Bullet>Maintenance and Squawks live together under the <strong>MX</strong> tab — tap it and pick which view you need.</Bullet>
            <Bullet>Hit the <strong>Guide</strong> button anytime for a full walkthrough of how it all works.</Bullet>
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
            <Bullet>Find squawks under the <strong>MX</strong> tab — just tap and choose <strong>Squawks</strong>.</Bullet>
          </ul>
        </div>
      )
    },
    {
      title: "Mechanic Coordination",
      icon: <Send size={48} className="text-[#F08B46]" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            No more phone tag. Bundle everything your mechanic needs into one work package and send it in a single professional email.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet>Combine MX items, squawks, and add-on services (wash, oil change, nav update, etc.).</Bullet>
            <Bullet>Your mechanic gets a secure portal to propose dates, track progress, upload photos, and message you — no account needed.</Bullet>
            <Bullet>Once a date is confirmed, any overlapping reservations are cleared automatically and affected pilots are notified.</Bullet>
            <Bullet>When service is done, enter the logbook data and all tracking resets automatically.</Bullet>
          </ul>
        </div>
      )
    },
    {
      title: "Talk to the Next Pilot",
      icon: <FileText size={48} className="text-navy" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            Fuel state, parking spot, a heads-up about weather — leave a note with photos and your whole team sees it instantly. Think of it as a shared crew whiteboard.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet>Post from the <strong>Notes</strong> tab with optional photo attachments.</Bullet>
            <Bullet>Every assigned pilot gets an email when a new note goes up.</Bullet>
            <Bullet>Unread notes light up with a badge so nothing slips through the cracks.</Bullet>
            <Bullet>The latest note also shows on the aircraft's Home screen for quick reference.</Bullet>
          </ul>
        </div>
      )
    },
    ...(role === 'admin' ? [{
      title: "Build Your Crew",
      icon: <UserPlus size={48} className="text-[#3AB0FF]" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            Invite pilots, set their permissions, and let them hit the ground running. Everyone gets exactly the access they need — nothing more, nothing less.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet>Tap the blue invite button on any aircraft's Home screen to add a pilot in seconds.</Bullet>
            <Bullet><strong>Aircraft Admins</strong> can edit the aircraft, schedule service, manage work packages, and invite others.</Bullet>
            <Bullet><strong>Aircraft Pilots</strong> can fly, log, report squawks, post notes, and manage their own reservations.</Bullet>
            <Bullet>New users get an email invitation and are ready to go the moment they set their password.</Bullet>
          </ul>
        </div>
      )
    }] : [{
      title: "You're Part of the Team",
      icon: <UserPlus size={48} className="text-[#3AB0FF]" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            You've been added to one or more aircraft. Everything you need to fly, log, and stay in the loop is already at your fingertips.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet>Log flights, report squawks, post notes, and reserve the plane.</Bullet>
            <Bullet>See maintenance status and upcoming service at a glance.</Bullet>
            <Bullet>Create and cancel your own reservations from the Calendar tab.</Bullet>
            <Bullet>If you're made an <strong>Aircraft Admin</strong>, you'll also be able to edit the aircraft, schedule service, and invite other pilots.</Bullet>
          </ul>
        </div>
      )
    }]),
    ...(role === 'admin' ? [{
      title: "Admin Tools",
      icon: <ShieldCheck size={48} className="text-navy" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            Tap the Shield icon in the top bar to access everything you need to manage the operation.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet><strong>Global Fleet:</strong> View and jump to any aircraft in the system.</Bullet>
            <Bullet><strong>Invite User:</strong> Invite pilots or admins and assign aircraft access.</Bullet>
            <Bullet><strong>Aircraft Access:</strong> Manage who can see which aircraft, reset passwords, or remove users.</Bullet>
            <Bullet><strong>System Tools:</strong> Configure maintenance alert thresholds, preview automated emails, and run database health checks.</Bullet>
          </ul>
        </div>
      )
    }] : []),
    {
      title: "Make It Yours",
      icon: <Settings size={48} className="text-gray-500" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            Tap the gear icon in the top bar to dial in your preferences. Control which email notifications you receive, reset your password, or manage your account — all in one place.
          </p>
          <ul className="text-sm text-gray-600 font-roboto space-y-2.5 pl-1">
            <Bullet>Toggle notifications on or off for reservations, squawks, notes, and service updates.</Bullet>
            <Bullet>Send yourself a secure password reset link anytime.</Bullet>
            <Bullet>View your account details or delete your account if you ever need to.</Bullet>
          </ul>
        </div>
      )
    },
    {
      title: "You're All Set",
      icon: <PlaneTakeoff size={48} className="text-navy" />,
      content: (
        <div className="space-y-4 w-full">
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            Need to log a flight or report a squawk from the ramp? Tap the <strong>Log It</strong> icon in the top menu to install a lightweight companion app built for speed on your phone.
          </p>
          <p className="text-sm text-gray-600 font-roboto leading-relaxed text-center">
            That's it — happy flying!
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
