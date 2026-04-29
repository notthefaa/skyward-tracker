"use client";

import { forwardRef, useEffect, useState } from "react";
import type ReactSignatureCanvas from "react-signature-canvas";

type SignaturePadProps = React.ComponentProps<typeof ReactSignatureCanvas>;

// react-signature-canvas (~13 KB) is only needed when a pilot signs a
// deferred squawk — load the module on mount of this wrapper rather
// than at SquawksTab boot time.
let CachedSignatureCanvas: typeof ReactSignatureCanvas | null = null;

const SignaturePad = forwardRef<ReactSignatureCanvas, SignaturePadProps>(
  function SignaturePad(props, ref) {
    const [Component, setComponent] = useState<typeof ReactSignatureCanvas | null>(
      CachedSignatureCanvas
    );

    useEffect(() => {
      if (CachedSignatureCanvas) return;
      let cancelled = false;
      import("react-signature-canvas").then((mod) => {
        if (cancelled) return;
        CachedSignatureCanvas = mod.default;
        setComponent(() => mod.default);
      });
      return () => { cancelled = true; };
    }, []);

    if (!Component) return null;
    return <Component ref={ref} {...props} />;
  }
);

export default SignaturePad;
